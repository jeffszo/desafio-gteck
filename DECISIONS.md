# DECISIONS.md

## 1. Modelagem e arquitetura

Mantive a divisão que já veio pronta (`ingestion` / `money` / `reports` /
`reconciliation` / `prisma`) — pra esse tamanho de problema, cada módulo já
tem uma responsabilidade clara e um service só, não vi motivo pra
fragmentar mais nem pra juntar nada.

O que eu acrescentei foi um `src/common/date.util.ts` com duas funções:
`toUtcDateOnly` (normaliza qualquer string de data pra meia-noite UTC do
mesmo dia civil) e `enumerateDays` (lista os dias entre `from`/`to`).
Ingestão, relatório e reconciliação precisavam exatamente da mesma lógica
de "que dia é esse, de verdade" — sem isso, cada um ia parsear data do seu
jeito e a chance de um bug de fronteira de dia (a data mudar dependendo do
timezone configurado no processo Node) ia ficar batendo em produção sem
ninguém perceber em dev.

Não criei nenhum módulo novo de "sites": `SiteMapping` é só uma tabela de
referência, não tem lógica de negócio própria que justifique isolar isso.
`ReportsService` e `ReconciliationService` continuam lendo `SiteMapping`
direto via `PrismaService`.

## 2. Inconsistências encontradas

Achei as quatro que o enunciado avisa que existem, e resolvi confirmar
cada uma lendo o `seed.sql` linha a linha (com um script em vez de
confiar na leitura visual) antes de decidir o que fazer com elas:

**Duplicata do Facebook.** `seed-fb-15` e `seed-fb-dup-125` são a mesma
linha duas vezes — `fb-site-nutrihealth-camp-1`, `2026-07-11`, mesmo
`spend`, `impressions` e `clicks`, bit a bit. Essa é a única que eu de
fato **corrigi** em vez de só sinalizar. Dois motivos pra isso não ser só
um capricho: primeiro, com as duas linhas em pé o `GET /reports` soma o
`spend` de `site-nutrihealth` em 2026-07-11 em dobro, o que estraga a
conta de ROAS daquele dia; segundo, não dá pra criar um índice único
sobre uma coluna que já tem duplicata — o Postgres recusa. Fiquei em
dúvida se isso contraria o "não altere os dados históricos já seedados"
do enunciado, mas entendo essa regra como "não reescreva um fato
observado", e apagar uma cópia idêntica não muda fato nenhum, só remove
uma redundância.

Minha primeira tentativa foi só apagar a `seed-fb-dup-125` dentro da
própria migration que cria a constraint (um `DELETE` antes do `CREATE
UNIQUE INDEX`). Rodei o setup de verdade e isso não resolveu: `npm run
prisma:seed` recarrega o `seed.sql` inteiro do zero toda vez que roda
(é pra isso que o script existe), e o arquivo original ainda tinha o
`INSERT` da `seed-fb-dup-125` — então, com a constraint já existindo no
banco (a migration roda antes do seed, na ordem que o setup pede), o
próprio carregamento do seed passou a falhar com "duplicate key value
violates unique constraint", derrubando a transação inteira. A correção
de verdade precisava estar no arquivo que gera o dado, não só no banco:
tirei o `INSERT` da `seed-fb-dup-125` do `prisma/seed.sql` (deixando um
comentário no lugar, explicando por quê) e mantive o `DELETE` na
migration só como rede de segurança, pra quem porventura já tiver essa
duplicata carregada de uma execução antiga. Acho importante deixar
registrado que essa foi uma correção em duas voltas — a primeira ideia
parecia certa no papel e só quebrou quando rodei o fluxo de setup de
ponta a ponta.

**Dia sem `FxRate` (2026-07-21).** Os outros 29 dias de julho têm cotação,
esse não tem. Decidi por carry-forward: uso a última cotação conhecida
antes do dia (no caso, a de 07-20) e registro um aviso no log. Se não
houver cotação anterior nenhuma no período (não acontece nesse seed, mas
pode acontecer se alguém pedir um relatório que comece antes da primeira
`FxRate` existente), a conversão daquele dia específico fica zerada e o
`ReportsService` loga isso — não derrubo o relatório inteiro por causa de
1 dia numa moeda.

**Gap real de 5 dias no GAM do FITPRO_MAIN** (07-15 a 07-19, o Facebook do
mesmo site tem os 30 dias completos). Não tratei isso como erro nem como
dia pra pular: o `spend` do Facebook continua contando normal nesses
dias, a receita do GAM entra como zero. É o reflexo correto de "gastou
mídia, não teve receita GAM registrada" — e é também exatamente o cenário
que o `GET /reconciliation/gaps` deveria apontar.

**GAM órfão (`PROMOSAUDE_MAIN`).** Tem 30 linhas de receita no
`GamAdMetric`, mas não existe em `SiteMapping` (nem como `gamSiteCode`,
nem indiretamente). Sem `revSharePct`/`taxOnRevenuePct`/moeda, essa
receita não tem como virar uma linha de relatório de verdade. Decidi
sinalizar por omissão: o `ReportsService` parte de `SiteMapping`, então
esse site nunca é alcançado — não é um filtro escondido, é consequência
direta de como a query é montada. Não escrevi nada que detecte e reporte
esse órfão ativamente porque isso não é pedido em nenhuma das rotas (nem
`/reports`, nem `/reconciliation/gaps` fala de "site sem mapeamento");
acho que caberia como melhoria futura, ver seção 6.

## 3. Idempotência e resiliência da ingestão

Chave natural: `(externalCampaignId, localDate)` no Facebook,
`(siteCode, utcDate)` no GAM — virou `@@unique` no schema, com
`upsert` do Prisma em cima. Preferi constraint no banco a checagem na
aplicação porque, sob concorrência (dois webhooks do mesmo payload
chegando quase juntos), um "select, depois decide se insere ou atualiza"
feito na aplicação tem uma janela de corrida real; o banco resolvendo
isso via índice único não tem.

Vale registrar por que usei `externalCampaignId` e não simplesmente
`siteRef` pro Facebook: no seed atual cada site só tem uma campanha
(`site-nutrihealth` sempre usa `fb-site-nutrihealth-camp-1`, por exemplo),
então `(siteRef, localDate)` passaria nos mesmos testes hoje. Mas o
próprio README chama `FacebookAdMetric` de "uma linha por campanha/dia" —
uma conta de anúncios real roda mais de uma campanha ao mesmo tempo no
mesmo site, e se eu tivesse usado `siteRef` como chave, duas campanhas
diferentes do mesmo site no mesmo dia colapsariam numa linha só na
próxima vez que chegasse um webhook. É um bug que o seed de hoje não
pegaria, mas que apareceria no primeiro dia com duas campanhas de verdade.

Arrays vazios (`facebook: []` ou `gam: []`) não geram nenhuma operação
pra aquela fonte — o `processMetrics` monta a lista de upserts a partir
do que veio no array, então uma fonte vazia simplesmente não contribui
com nada, sem tocar em nenhuma linha já persistida da outra fonte.

Reenvio com o mesmo valor: upsert atualiza pra o mesmo valor, na prática
um no-op. Reenvio com valor **diferente** do que já está salvo: decidi
por last-write-wins (o upsert atualiza pra o novo valor). Não tem no
payload nenhum jeito de saber se isso é uma correção legítima da rede de
anúncios (cenário comum: número do dia D sai como "estimado" e depois
volta "final") ou um dado pior chegando por engano — sem um campo de
versão/timestamp de origem, ignorar reenvios divergentes esconderia
correções reais, que me parece pior do que aceitar todas.

Todos os upserts de um mesmo payload rodam dentro de um único
`$transaction` — se uma linha falhar no meio, nenhuma fica
meio-persistida.

Uma coisa que eu tinha deixado só documentada aqui, sem estar visível em
lugar nenhum do sistema: quando um reenvio muda um valor, `processMetrics`
agora compara contra o que já está salvo (uma consulta antes dos upserts,
fora da transação de escrita) e loga um aviso — `spend: 237.6 -> 260.0`,
por exemplo — antes de aplicar o last-write-wins. Isso não muda o
comportamento, só torna essa decisão auditável: hoje quem operasse esse
sistema não teria como saber, sem abrir o banco, que um dia teve o
número corrigido por baixo dos panos.

## 4. Módulo de dinheiro

Usei `Prisma.Decimal` (`import { Prisma } from "@prisma-client"`) pra toda
a conta dentro de `MoneyService#calculate`. Não é uma dependência nova —
conferi no client gerado que `Decimal` já vem junto do `@prisma/client`,
é o mesmo tipo que os campos `Decimal` do schema já usam, então não tem
conversão extra entre "o tipo que vem do banco" e "o tipo que eu calculo
com" nessa borda.

A cadeia é a do README, na ordem exata, sem atalho algébrico:
`netRevenueUsd` → `netRevenueAfterTaxUsd` → `netRevenueLocal` →
`mediaCostWithTaxLocal` → `profitLocal` → `roas`. Isso importa mesmo
sendo "matematicamente a mesma coisa" se fosse só multiplicação simples,
por dois motivos: `taxOnRevenuePct` incide sobre a receita líquida (depois
do revShare) e `taxOnMediaCostPct` incide sobre o custo de mídia — são
bases diferentes, não dá pra comutar essas duas operações nem em teoria.
E, na prática, arredondamento intermediário existe: se o câmbio fosse
aplicado antes do tributo sobre receita, por exemplo, o tributo incidiria
sobre um valor já convertido pra outra moeda, e a diferença aparece na
2ª/3ª casa decimal exatamente como o README avisa.

`MoneyInput`/`MoneyResult` são `number` — isso já veio pronto e não mudei,
porque só criaria fricção sem ganho real (o valor já sai do banco como
`Decimal` de no máximo 2-4 casas, então virar `number` na entrada e voltar
pra `Decimal` dentro do `calculate` não perde nada). O que eu fiz questão
de garantir é que nenhuma conta de fato acontece em cima desse `number`:
ele só existe como formato de entrada/saída da função, tudo no meio é
`Prisma.Decimal`, e o arredondamento final (2 casas pra tudo que é
dinheiro, 4 pra `roas`, porque é um índice e o exemplo do README só bate
com 4 casas) acontece uma vez só, no fim.

`mediaCostWithTaxLocal = 0` faria o `roas` estourar numa divisão por
zero. Decidi que isso retorna `0`, documentado — sem custo, não tem uma
razão significativa pra reportar, e `0` é mais seguro pra quem consome
essa API do que `Infinity`. Mesma lógica pro `cpa` no `ReportsService`
quando `clicks = 0`.

## 5. Reconciliação de gaps

`findGaps` gera a lista de dias do período uma vez, e busca com uma query
por fonte (não uma por site nem por dia) quais pares (site, dia) já têm
dado, usando `groupBy`. O que sobra depois de comparar contra a lista de
dias esperada por site é o gap. Não fiz nada além de reportar isso na
resposta — sem log adicional, sem tabela de alerta — porque nenhuma das
duas rotas essenciais pede isso; deixei uma rotina que sinalize gaps
ativamente como item de diferencial não implementado (seção 6).

Um detalhe que só percebi lendo o DTO com calma: o campo `site` de um gap
usa `facebookSiteRef` quando a fonte é Facebook e `gamSiteCode` quando é
GAM — não é o mesmo espaço de identificador entre as duas fontes. Achei
importante deixar isso explícito aqui porque é o tipo de coisa fácil de
implementar errado (usar sempre `facebookSiteRef`, por exemplo) sem o
teste automatizado pegar se você não tiver casos dos dois lados.

## 6. Trade-offs e o que ficou de fora

Os testes (`vitest`) cobrem os quatro services: `MoneyService` é teste
unitário puro (sem banco), batendo exato com o exemplo do README, o caso
de site USD com tributos zerados, `mediaCostWithTaxLocal = 0` dando `roas
= 0`, e um caso de entrada com muitas casas decimais cujo resultado eu
conferi à parte em Python com `Decimal` (não confiei só no meu próprio
código pra validar meu próprio código). Os outros três — `Ingestion`,
`Reports`, `Reconciliation` — são testes de integração de verdade, contra
o mesmo Postgres do `docker compose` (esse projeto não tem uma base de
teste separada), cada um usando um prefixo próprio de id/site/data (tudo
em 2030) pra nunca encostar no que o `seed.sql` já colocou lá nem nos
dados de outro spec. Reenvio idêntico e reenvio com valor diferente na
ingestão são testados chamando `processMetrics` duas vezes de verdade
(não só inspecionando se o Prisma foi chamado certo); o relatório testa
um cenário com os dois tipos de gap do seed real (spend sem receita GAM,
dia sem `FxRate`) montado à mão, com o resultado esperado calculado à
parte; a reconciliação confere que o `site` de cada gap usa o
identificador certo por fonte.

`npm test` rodou de verdade (17/17 passando) depois do `prisma:migrate` +
`prisma:seed`, e além disso as 3 rotas foram batidas manualmente contra a
API rodando de verdade (via Insomnia): idempotência do webhook enviando o
mesmo payload duas vezes seguidas e conferindo que o relatório não muda,
`GET /reports` pro mês inteiro contra os 4 sites e `GET
/reconciliation/gaps` contra os 5 dias reais de gap do `FITPRO_MAIN` —
todos batendo exatamente com os números que eu tinha calculado à parte em
Python antes de rodar. O teste novo do log de divergência (descrito no parágrafo
abaixo) foi escrito depois dessa rodada e ainda não foi confirmado rodando —
deveria passar, mas não tive como validar isso da minha parte.

Do diferencial, implementei o log de divergência na ingestão (`spend:
237.6 -> 260.0`, avisando quando um reenvio muda um valor já persistido)
e já tinha o log de aviso de câmbio faltando em `ReportsService`. Não
implementei uma rotina ativa que rode `findGaps` periodicamente e
notifique sozinha — com mais tempo, seria o próximo item, porque hoje
alguém só descobre um gap se pensar em chamar a rota.

Também não tratei o `PROMOSAUDE_MAIN` (o site órfão do GAM) de nenhuma
forma além de deixá-lo de fora do relatório por consequência da query.
Se isso fosse um sistema de verdade, eu preferiria um alerta separado
tipo "existe receita GAM chegando de um site que ninguém mapeou ainda",
porque isso normalmente significa dinheiro sendo perdido de vista, não
só um dado quebrado.

## 7. Escala

Relatório e reconciliação já nascem sem N+1 — agregação em `groupBy`, uma
query por fonte, não por site nem por dia. A 100x eu trocaria a
reconciliação pela versão com `generate_series` + `LEFT JOIN` em SQL cru
(o Postgres devolve só os gaps direto, sem trazer as linhas de métrica
pra memória) e cogitaria paginar o `GET /reports` por site se o número de
sites crescesse de verdade (hoje são 4, isso só importa na casa das
centenas/milhares).

Na ingestão, o `$transaction` de upserts por payload é ok pro tamanho de
um webhook normal (algumas linhas). Se um payload viesse com milhares de
linhas de uma vez, trocaria por um `INSERT ... ON CONFLICT DO UPDATE` em
lote (`$executeRaw` com múltiplos `VALUES`) em vez de N upserts
sequenciais.

Se o relatório virasse hot-path (o mesmo período fechado sendo consultado
toda hora, tipo "mês passado"), os dias já fechados não mudam mais — daria
pra ter uma tabela de agregado diário pré-calculado, atualizada na própria
ingestão, trocando leitura pesada recorrente por escrita incremental. Não
fiz isso agora porque o volume atual não justifica a complexidade.
