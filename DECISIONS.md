# DECISIONS.md

## 1. Modelagem e arquitetura

Mantive a divisão que já veio pronta (`ingestion` / `money` / `reports` /
`reconciliation` / `prisma`) — pra esse tamanho de problema cada módulo já
tem responsabilidade clara, não fragmentei nem juntei nada.

Acrescentei `src/common/date.util.ts` (`toUtcDateOnly` e `enumerateDays`)
porque ingestão, relatório e reconciliação precisavam da mesma lógica de
"que dia é esse de verdade" — sem isso cada um ia parsear data do seu
jeito, e um bug de fronteira de dia (timezone do processo Node) ia
aparecer em produção sem ninguém notar em dev.

Também botei em `src/common/` um `AllExceptionsFilter` (pega qualquer
erro não tratado e devolve uma resposta consistente em vez de 500 cru) e
um `JsonLoggerService` (troca o logger padrão do Nest por log em JSON).
Ficaram fora dos módulos de domínio porque não são específicos de
nenhum — servem pra aplicação inteira.

Não criei módulo de "sites": `SiteMapping` é só tabela de referência, sem
lógica própria que justifique isolar. `ReportsService` e
`ReconciliationService` continuam lendo direto via `PrismaService`.

## 2. Inconsistências encontradas

**Duplicata do Facebook.** `seed-fb-15` e `seed-fb-dup-125` são a mesma
linha duas vezes — `fb-site-nutrihealth-camp-1`, 2026-07-11, mesmo
`spend`/`impressions`/`clicks`. Essa eu corrigi de verdade, não só
sinalizei: com as duas em pé o relatório soma o `spend` em dobro naquele
dia, e não dá pra criar índice único em cima de coluna já duplicada.
Entendi o "não altere dado histórico" do enunciado como "não reescreva um
fato observado" — apagar uma cópia idêntica não muda fato nenhum.

Primeira tentativa foi um `DELETE` na migration antes de criar a
constraint. Não resolveu: `prisma:seed` recarrega o `seed.sql` inteiro
toda vez que roda, e o `INSERT` da duplicata continuava lá — com a
constraint já criada, o próprio seed passou a quebrar com erro de chave
duplicada. A correção real era tirar o `INSERT` do `seed.sql` (troquei
por um comentário) e deixar o `DELETE` na migration só como rede de
segurança pra quem já tiver a duplicata carregada de antes. Foi correção
em duas voltas — a primeira parecia certa no papel e só quebrou rodando o
setup ponta a ponta de verdade.

**Dia sem `FxRate` (2026-07-21).** Uso a cotação anterior (carry-forward)
e loga aviso — é o que qualquer sistema financeiro faz quando falta a
cotação de um dia específico. Quando não existe cotação nenhuma antes do
dia (não acontece no seed, mas pode acontecer se o período pedido
começar antes da primeira `FxRate` existente), prefiro não inventar uma
taxa: zero a receita local daquele dia e loga o aviso, em vez de supor um
câmbio que não tenho como sustentar. Isso tem um limite que vale
reconhecer — `0` fica ambíguo entre "não teve receita" e "não deu pra
calcular". Pra esse desafio, zero mantém o contrato da API simples (o
campo continua `number`, sem precisar de um terceiro estado tipo `null`).
Numa API de produção eu não deixaria essa ambiguidade: sinalizaria esse
dia como dado incompleto de algum jeito, em vez de misturar com zero de
verdade.

**Gap de 5 dias no GAM do FITPRO_MAIN (07-15 a 07-19).** Não tratei como
erro nem pulei o dia: `spend` do Facebook conta normal, receita GAM entra
zero. É exatamente o que `/reconciliation/gaps` deveria pegar.

**GAM órfão (`PROMOSAUDE_MAIN`).** 30 linhas de receita sem entrada em
`SiteMapping` — sem `revShare`/tax/moeda não dá pra virar relatório.
Sinalizei por omissão: `ReportsService` parte de `SiteMapping`, esse site
nunca é alcançado. Não fiz alerta ativo porque nenhuma rota pede isso —
fica de melhoria futura (seção 6).

## 3. Idempotência e resiliência da ingestão

Chave natural: `(externalCampaignId, localDate)` no Facebook,
`(siteCode, utcDate)` no GAM — `@@unique` no schema + `upsert` do Prisma.
Constraint no banco em vez de checagem na aplicação porque, sob
concorrência, um "select, depois decide" feito na aplicação tem janela de
corrida real; índice único no banco não tem.

Usei `externalCampaignId` e não `siteRef` pro Facebook porque o README
chama `FacebookAdMetric` de "uma linha por campanha/dia" — uma conta real
roda mais de uma campanha ao mesmo tempo no mesmo site. Com `siteRef`
como chave, duas campanhas do mesmo site no mesmo dia colapsariam numa
linha só. O seed de hoje não pegaria esse bug (cada site só tem uma
campanha), mas ia aparecer no primeiro dia com duas campanhas de verdade.

Array vazio não gera operação pra aquela fonte — `processMetrics` monta a
lista de upserts a partir do que veio, fonte vazia não toca em nada da
outra.

Reenvio igual: o upsert vira um no-op na prática. Reenvio com valor
diferente: last-write-wins. Não tem no payload como saber se é correção
legítima (número "estimado" virando "final") ou dado pior chegando por
engano — ignorar reenvio divergente esconderia correção real, que é pior.

Upserts de um payload rodam num `$transaction` só — uma linha falhando no
meio não deixa nada meio-persistido.

`processMetrics` compara contra o que já está salvo antes de aplicar e
loga um aviso quando um reenvio muda valor (`spend: 237.6 -> 260.0`, por
exemplo). Não muda o comportamento, só deixa a correção auditável — sem
isso ninguém saberia que um número mudou sem abrir o banco.

## 4. Módulo de dinheiro

`Prisma.Decimal` pra toda a conta do `MoneyService#calculate`. Não é
dependência nova — já vem junto do `@prisma/client`, é o mesmo tipo que
os campos `Decimal` do schema usam.

Cadeia na ordem exata do README: `netRevenueUsd` → `netRevenueAfterTaxUsd`
→ `netRevenueLocal` → `mediaCostWithTaxLocal` → `profitLocal` → `roas`.
Importa porque `taxOnRevenuePct` incide sobre receita líquida (pós
revShare) e `taxOnMediaCostPct` incide sobre custo de mídia — bases
diferentes, não dá pra trocar a ordem nem em teoria. E arredondamento
intermediário muda o resultado na 2ª/3ª casa se você inverter, como o
README já avisa.

`MoneyInput`/`MoneyResult` continuam `number` — o contrato já veio
definido assim, não mudei. Isso é só o formato de entrada e saída da
função: nenhuma conta roda em cima desse `number`. Tudo que acontece
dentro do `calculate` é `Prisma.Decimal`, e ele só volta a virar `number`
no fim, depois do arredondamento (2 casas pra dinheiro, 4 pro `roas`,
porque o exemplo do README só bate com 4). Ponto flutuante binário nunca
entra na conta em si, só na borda de entrada e saída.

`mediaCostWithTaxLocal = 0` faria o `roas` dividir por zero — retorna `0`
em vez de `Infinity`, mais seguro pra quem consome a API. Mesma lógica
pro `cpa` no `ReportsService` quando `clicks = 0`.

## 5. Reconciliação de gaps

`findGaps` gera a lista de dias do período uma vez e busca, com
`groupBy` (uma query por fonte, não por site nem por dia), quais pares
(site, dia) já têm dado. O que sobra é o gap. Só reporto na resposta —
sem log, sem alerta — porque nenhuma rota essencial pede mais que isso;
rotina ativa de gap fica no diferencial (seção 6).

O campo `site` de um gap usa `facebookSiteRef` quando a fonte é Facebook
e `gamSiteCode` quando é GAM — não é o mesmo espaço de identificador
entre as duas. Vale registrar porque é fácil implementar errado (usar
sempre um dos dois) e o teste só pega isso se tiver caso dos dois lados.

## 6. Trade-offs e o que ficou de fora

Testes: `MoneyService` é unitário puro — bate com o exemplo do README, o
caso USD sem tributo, e custo zero dando `roas = 0`. `AllExceptionsFilter`
também é unitário, mockando `ArgumentsHost`, sem banco. `Ingestion`,
`Reports` e `Reconciliation` são integração de verdade contra o Postgres
do `docker compose`, cada um com prefixo próprio de id/site/data (2030)
pra não encostar no seed nem em outro spec. Reenvio idêntico e reenvio
divergente testam chamando `processMetrics` duas vezes de verdade; o
relatório testa os dois tipos de gap do seed real montados à mão, com
resultado calculado à parte; a reconciliação confere que o `site` usa o
identificador certo por fonte.

`npm test`: 22/22 passando, migrate + seed rodados de verdade — incluindo
o log de divergência aparecendo no output com WARN mostrando valor antigo
e novo. As 3 rotas também foram batidas na mão via Insomnia contra a API
rodando: idempotência do webhook (mesmo payload duas vezes, relatório não
muda), `GET /reports` do mês inteiro contra os 4 sites, `GET
/reconciliation/gaps` contra os 5 dias reais do FITPRO_MAIN — tudo
batendo com número calculado à parte em Python.

Do diferencial, fechei dois dos três. Testes além do caminho feliz: feito
(idempotência, payload vazio, roas zerado, gaps). Tratamento de erro e
observabilidade: feito — `AllExceptionsFilter` trata erro do Prisma como
409 em vez de 500 cru e loga tudo, `JsonLoggerService` bota isso (e os
logs de negócio que já existiam) em JSON. Ficou de fora a rotina ativa de
alerta de gap — hoje alguém só descobre um gap se pensar em chamar a
rota; seria o próximo passo com mais tempo.

Também não tratei o `PROMOSAUDE_MAIN` (site órfão) além de deixá-lo fora
do relatório por consequência da query. Num sistema de verdade eu
preferiria um alerta tipo "tem receita GAM chegando de site sem
mapeamento" — isso normalmente é dinheiro sendo perdido de vista, não só
dado quebrado.

## 7. Escala

Relatório e reconciliação já não têm N+1 — `groupBy`, uma query por
fonte. A 100x trocaria a reconciliação por `generate_series` + `LEFT
JOIN` em SQL cru (o Postgres devolve só o gap, sem trazer métrica pra
memória) e paginaria `GET /reports` por site se o número de sites
crescesse de verdade (hoje são 4).

Na ingestão, o `$transaction` de upserts é ok pro tamanho de um webhook
normal. Um payload com milhares de linhas eu trocaria por `INSERT ... ON
CONFLICT DO UPDATE` em lote em vez de N upserts sequenciais — evita
quebrar em produção.

Se o relatório virasse hot-path (mesmo período fechado consultado toda
hora), dia fechado não muda mais — daria pra ter um agregado diário
pré-calculado, atualizado na própria ingestão. Não fiz porque o volume
atual não justifica.
