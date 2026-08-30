# Proposta técnica — Relatório consolidado de tráfego pago

> Documento de alinhamento antes de qualquer implementação. Cobre: entendimento
> do desafio, inconsistências reais encontradas no seed, arquitetura proposta
> por peça, e considerações de performance/escala. Nenhum código foi alterado
> ainda — isso é a base pra conversarmos antes de eu tocar em `.ts`.

## 1. O que o desafio pede, em uma frase

Um backend NestJS + Prisma/Postgres que recebe métricas de Facebook Ads e
Google Ad Manager via webhook, casa os dois por site (`SiteMapping`),
converte receita bruta em lucro/ROAS respeitando revShare → tributo →
câmbio → tributo sobre mídia, e sinaliza dias sem dado (gaps). Escopo
completo: **Ingestão**, **Relatório consolidado**, **Módulo de dinheiro**,
**Reconciliação de gaps**. O contrato real é só a nível de rota (payload de
entrada/saída dos três endpoints); tudo o resto — services, DTOs internos,
schema — é livre pra reestruturar.

Estado atual: as 4 rotas já existem (controllers, DTOs, wiring de módulo),
mas os 4 métodos de negócio (`MoneyService#calculate`,
`IngestionService#processMetrics`, `ReportsService#getReport`,
`ReconciliationService#findGaps`) são só `throw new Error("not implemented")`.
Repositório limpo, um commit só ("projeto inicial"), nada implementado ainda.

## 2. Inconsistências reais encontradas no seed (`prisma/seed.sql`)

Analisei o `seed.sql` diretamente (121 linhas de `FacebookAdMetric`, 145 de
`GamAdMetric`, 4 `SiteMapping`, 29 `FxRate`) pra saber com o que o código
precisa lidar de fato, não só em teoria:

1. **Duplicata exata simulando webhook reenviado.** `site-nutrihealth`,
   `2026-07-11` aparece duas vezes com **os mesmos valores** (`spend=237.6`,
   `impressions=8370`, `clicks=176`), ids `seed-fb-15` e `seed-fb-dup-125`.
   É o teste de idempotência: reprocessar isso não pode virar 2 linhas.
2. **`FxRate` faltando um dia.** `2026-07-21` não tem cotação USD→BRL, os
   outros 29 dias de julho têm. Isso importa pra `site-nutrihealth` e
   `site-fitpro` (BRL) especificamente nesse dia — não dá pra converter a
   receita GAM (sempre USD) pra local sem alguma decisão explícita.
3. **`GamAdMetric` com gap real de 5 dias.** `FITPRO_MAIN` tem só 25 linhas
   (dias 07-01 a 07-30, faltando 07-15 a 07-19), enquanto o Facebook do
   mesmo site (`site-fitpro`) tem os 30 dias completos. Ou seja: teve custo
   de mídia nesses 5 dias, mas nenhuma receita GAM registrada — não é um
   dia "sem dado nenhum", é um dia com Facebook e sem GAM.
4. **`GamAdMetric` com site órfão.** `PROMOSAUDE_MAIN` tem 30 linhas de GAM
   mas **não existe** em `SiteMapping` (nem como `gamSiteCode`, nem
   indiretamente). Sem `revSharePct`/`taxOnRevenuePct`/moeda, essa receita
   não tem como virar uma linha de relatório — é dado de uma fonte que a
   gente nem sabe a que site pertence de verdade.
5. Confirmando o que o README já avisa: moeda é constante por site ao longo
   do tempo (`site-nutrihealth`/`site-fitpro` sempre BRL,
   `site-vidaativa`/`site-bemestar` sempre USD), `GamAdMetric.currencyCode`
   é sempre `USD` nas 145 linhas, sem duplicatas em `GamAdMetric`, sem
   `clicks > impressions`, sem valores negativos. Ou seja, as pegadinhas
   são pontuais e propositais (os 4 itens acima), não ruído genérico.

Essas 4 são as que eu documentaria explicitamente no `DECISIONS.md` (seção
2), com a decisão de tratamento de cada uma — ver como cada peça da
arquitetura abaixo propõe lidar com elas.

## 3. Módulo de dinheiro (`MoneyService`)

**Representação numérica:** usar `Prisma.Decimal` (já é dependência
transitiva do `@prisma/client`, é o mesmo tipo que já vem dos campos
`Decimal` do banco — evita converter `Decimal` do Prisma → `number` →
outra lib de decimal e reintroduzir erro de ponto flutuante nessa borda).
Toda a cadeia de operações (`revShare → tributo → câmbio → tributo sobre
mídia → lucro/ROAS`) roda em `Decimal`, arredondamento só acontece uma vez,
no fim, ao converter pro `number` que a interface `MoneyResult` exige (2
casas decimais pra valores monetários; ROAS pode ficar com mais casas já
que é um índice, não dinheiro — ex. o `1.5441` do exemplo do README sugere
4 casas).

**Ordem de operações:** implementada exatamente como o README especifica,
sem atalho algébrico. Vale a pena registrar no `DECISIONS.md` *por que* a
ordem importa mesmo sendo matematicamente "a mesma coisa" se fosse tudo
multiplicação simples: ela não é comutativa aqui porque **arredondamento
intermediário existe na prática** (ex. se o câmbio fosse aplicado antes do
tributo sobre receita, o tributo incidiria sobre um valor já convertido e
arredondado, mudando o resultado na 2ª/3ª casa) — e porque semanticamente
"tributo sobre receita" e "tributo sobre custo de mídia" incidem sobre
bases diferentes (receita líquida vs. custo de mídia), não dá pra
comutar mesmo em teoria.

**Casos de borda a cobrir em teste:** `clicks = 0` (cpa não pode ser
`Infinity`/`NaN` silencioso — decidir se retorna `0`, `null` ou omite o
campo, e documentar), `mediaCostWithTaxLocal = 0` (mesmo problema pro
ROAS), site USD (`fxRate = 1`, sem conversão real), `revSharePct`/`taxOn*`
zerados (casos `vida-ativa`/`bem-estar` no seed, que têm tributos zerados
— bom teste de que a fórmula não quebra com zero).

## 4. Ingestão via webhook (`IngestionService#processMetrics`)

**Chave natural de idempotência**, direto do que o README define pra cada
tabela ("uma linha por campanha/dia" no Facebook, "uma linha por site/dia"
no GAM):

- `FacebookAdMetric`: `(externalCampaignId, localDate)`
- `GamAdMetric`: `(siteCode, utcDate)`

Proponho **elevar isso a constraint no banco** (nova migration, permitido
pelo desafio — "não altere os dados históricos já seedados", e isso não
altera, só adiciona `@@unique`), não só checagem na aplicação: garante
idempotência mesmo sob concorrência (dois webhooks do mesmo payload
chegando quase ao mesmo tempo), o que uma checagem "select depois insert"
na aplicação não garante sozinha.

Com a constraint em mãos, `processMetrics` vira um `upsert` por linha
(ou um `INSERT ... ON CONFLICT DO UPDATE` via `$transaction` de upserts do
Prisma) — reenviar o mesmo payload com os mesmos valores é a
`seed-fb-dup-125` do item 2.1: um no-op de fato (o upsert atualiza pro
mesmo valor, sem gerar linha nova). Isso também resolve o caso mais
realista de reenvio com **valor diferente** (rede de anúncios corrige um
número de um dia já reportado, cenário comum em ad-tech: o número do dia D
é "estimado" e depois "final") — decisão que registraria no
`DECISIONS.md`: trato como *last-write-wins* (upsert atualiza), porque não
tenho como distinguir "correção legítima" de "dado pior" sem um campo de
versão/timestamp de origem que o payload não manda; a alternativa
(ignorar reenvios com valor diferente) esconderia correções reais.

**Arrays vazios:** `facebook: []` ou `gam: []` significa "sem operação
nessa fonte" — o loop de upsert simplesmente não roda pra essa fonte
naquele request, não é um sinal pra apagar/zerar dado já persistido.
Confirmar com teste explícito (`{facebook: [], gam: [...]}` não deve
afetar nenhuma linha de `FacebookAdMetric` existente).

**Performance:** um único `$transaction` com todos os upserts do payload
(evita estado parcial se uma linha falhar no meio) em vez de `await` um a
um fora de transação.

## 5. Relatório consolidado (`ReportsService#getReport`)

**Passo a passo proposto:**

1. Resolver o conjunto de sites: `SiteMapping` filtrado por `siteRef` se
   informado (se não bater nenhum, retorna `[]` direto — sem tocar nas
   outras tabelas).
2. 3 queries agregadas no banco (não por site, uma vez só pro período
   inteiro): `FacebookAdMetric` `groupBy siteRef, localDate` somando
   `spend/impressions/clicks`; `GamAdMetric` `groupBy siteCode, utcDate`
   somando `adRevenue`; `FxRate` do período inteiro (`usdBrl` por `date`).
   Isso evita N+1 (uma query por site ou por dia).
3. Para cada site, iterar dia a dia no período: montar o `MoneyInput`
   daquele dia (`mediaCostLocal` = soma do dia no FB daquele site,
   `grossRevenueUsd` = soma do dia no GAM daquele site — **0 se não
   existir linha**, é o caso do `FITPRO_MAIN` nos dias 07-15 a 07-19: o
   spend do Facebook continua contando, a receita daquele dia entra como
   zero, o que é o reflexo correto de "gastou mídia, não teve receita GAM
   registrada", não um dia a ignorar), `fxRate` = 1 se o site é USD, senão
   a linha de `FxRate` do dia.
4. **FX faltando num dia que precisa dele** (o caso do 07-21): decisão
   proposta — usar a **última cotação conhecida anterior** (carry-forward,
   prática padrão em série temporal financeira) e logar um aviso; se não
   houver cotação anterior nenhuma no dataset, excluir a conversão daquele
   dia específico (não o site inteiro) e sinalizar. Alternativa mais
   simples e defensável também: falhar alto (erro 4xx) só pra aquele
   período — mas isso quebra o relatório inteiro por causa de 1 dia em 1
   moeda, prefiro carry-forward + log.
5. Chamar `MoneyService#calculate` uma vez por dia (por site) com esse
   input, acumular os resultados do dia em `Decimal` (não em `number`) nos
   totais do site: soma de `mediaCostLocal`, `mediaCostWithTaxLocal`,
   `grossRevenueUsd`, `netRevenueLocal`. `profitLocal` do período é linear
   (soma de `profitLocal` diário = igual a `netRevenueLocal total -
   mediaCostWithTaxLocal total`), mas **`roas` do período não é a média
   dos `roas` diários** — é recalculado no fim como `netRevenueLocal total
   / mediaCostWithTaxLocal total` (README também implica isso: "some os
   valores... antes de consolidar"). Mesmo raciocínio pra `ctr`/`cpa`:
   somam-se impressions/clicks/custo do período inteiro e divide uma vez,
   não é média de razões diárias.
6. `GamAdMetric` de `PROMOSAUDE_MAIN` nunca entra nesse fluxo porque o
   passo 1 parte de `SiteMapping` — ele fica de fora do relatório
   naturalmente, e eu sinalizaria essa exclusão no `DECISIONS.md` (dado
   real, mas sem site mapeado, não é "erro silencioso", é o comportamento
   esperado dado o modelo).

## 6. Reconciliação de gaps (`ReconciliationService#findGaps`)

Abordagem: gerar a série de dias `[from, to]` uma vez, e para cada fonte
buscar **o conjunto de (site, dia) que já têm dado** com uma query só (não
uma query por dia por site — isso é O(dias × sites) round-trips, o que não
escala). Em Postgres, a forma mais direta de fazer isso sem trazer todas as
linhas pra memória é `generate_series(from, to, '1 day')` cruzado com
`SiteMapping`, `LEFT JOIN` na tabela de métricas, filtrando `WHERE
metric.id IS NULL` — o próprio banco devolve só os gaps, uma query por
fonte (2 no total), independente de quantas linhas de métrica existem.
Alternativa mais simples em cima do Prisma (sem SQL cru): puxar
`groupBy siteRef` (ou `siteCode`) as datas distintas presentes no período
num `Set` por site, e diferenciar contra a série de dias gerada em memória
— mais simples de ler, mas escala pior (traz todas as datas distintas pra
memória; ok no volume atual, não ok a 100x). Provavelmente começo pela
versão Prisma simples e documento a versão SQL como o que eu faria se o
volume justificasse.

## 7. Performance / o que mudaria a 100x volume de dados

- **Relatório e reconciliação já nascem sem N+1** (agregação em SQL, uma
  query por fonte, não por site/dia) — o que muda a 100x é trocar os
  `groupBy` do Prisma por SQL cru com `generate_series` + `LEFT JOIN`
  pros gaps (item 6) e considerar paginar `GET /reports` por site em vez
  de devolver o array inteiro de uma vez se o número de sites crescer
  muito (hoje são 4 sites, 100x ainda é pouco pra isso importar, mas
  centenas/milhares de sites já justificam).
- **Ingestão**: o `$transaction` de upserts por payload é ok pro tamanho
  de payload de um webhook (algumas linhas). Se um payload viesse com
  milhares de linhas de uma vez, trocaria por `INSERT ... ON CONFLICT DO
  UPDATE` em lote única (`$executeRaw` com múltiplos `VALUES`) em vez de N
  upserts sequenciais — throughput de escrita, não de leitura.
- **Índices**: já existem `(siteRef, localDate)` e `(siteCode, utcDate)`
  no schema atual; as constraints `@@unique` que a idempotência precisa
  (item 4) cobrem exatamente os mesmos pares de colunas, então não
  duplicam índice, só promovem o índice existente a `unique`.
- **Se o relatório virar hot-path** (consultado toda hora pelo mesmo
  período fechado, ex. "mês passado"): os números de dias já fechados não
  mudam mais, então uma tabela de agregado diário pré-calculado
  (`SiteDailyAggregate`, atualizada por um job ou no próprio `processMetrics`)
  evitaria recalcular `MoneyService#calculate` dia a dia toda vez que
  `GET /reports` é chamado — troca-se leitura pesada recorrente por
  escrita incremental na ingestão. Não implementaria isso agora (volume
  atual não justifica a complexidade), mas é a resposta natural pra
  pergunta 7 do `DECISIONS.md`.

## 8. Estrutura de módulos — o que eu mudaria vs. o que eu manteria

**Mantenho:** a divisão por domínio que já existe
(`ingestion`/`money`/`reports`/`reconciliation`/`prisma`), é a divisão
certa pro tamanho do problema — cada uma tem uma responsabilidade e um
service só, não vejo motivo pra fragmentar mais.

**Acrescentaria:**
- Um pequeno helper de datas (`toDateOnlyUTC`, `enumerateDays(from, to)`)
  compartilhado — `reports` e `reconciliation` precisam da mesma lógica de
  "lista de dias entre from/to inclusive" e eu não duplicaria isso.
- Um `SiteMappingRepository`/método utilitário simples pra resolver
  "site(s) alvo do request" (filtrado ou todos) — usado por `reports` e,
  se eu fizer a versão SQL de `reconciliation`, por ele também.
- Nenhum módulo novo de "sites" — não há lógica de negócio suficiente ali
  pra justificar, `SiteMapping` é só uma tabela de referência.

## 9. Testes que eu priorizaria (além do caminho feliz)

Money: ordem de operações com o exemplo do README (bate exatamente com os
números dados), `clicks=0`, `mediaCostWithTaxLocal=0`, site USD (`fxRate=1`).
Ingestão: reenvio idêntico ao `seed-fb-dup-125` (não duplica), reenvio com
valor diferente (atualiza), payload com um array vazio (não apaga o outro).
Reports: site com gap de GAM (`FITPRO_MAIN`) conta spend e zera receita
nos dias faltantes, dia sem `FxRate` (07-21) não quebra o request, site
sem `siteRef` correspondente devolve `[]`, `PROMOSAUDE_MAIN` nunca aparece.
Reconciliação: os 5 dias de gap do `FITPRO_MAIN` aparecem exatamente,
nenhum falso positivo pros outros sites completos.

## 10. Decisões que eu gostaria de confirmar com você antes de codar

1. **FX faltando (07-21):** carry-forward da última cotação vs. falhar o
   request vs. outra ideia sua?
2. **Reenvio com valor diferente na ingestão:** upsert (last-write-wins)
   é aceitável, ou você quer preservar o primeiro valor recebido e só
   logar divergência?
3. **Arredondamento final:** 2 casas pra valores monetários e 4 pra ROAS
   está de acordo, ou prefere outro padrão?
4. **Reconciliação:** começo pela versão Prisma simples (`groupBy` +
   diff em memória) e documento a versão SQL/`generate_series` como
   "o que eu faria a escala maior", ou você já quer a versão SQL crua
   desde já?

Se esse plano fizer sentido, meu próximo passo seria: (a) migration
adicionando as `@@unique`, (b) `MoneyService`, (c) `IngestionService`,
(d) `ReportsService`, (e) `ReconciliationService`, (f) testes, (g)
`DECISIONS.md` — nessa ordem, porque cada peça depende da anterior
(reports depende de money; reconciliação é independente e pode vir em
paralelo).
