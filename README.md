# Desafio técnico — Relatório consolidado de tráfego pago

## Contexto

Você está entrando no time que constrói a plataforma interna de gestão de
tráfego pago do escritório. Essa plataforma agrega dados de múltiplas fontes
de anúncios para os parceiros, calcula ROAS/lucro em cima disso, e mantém
esses números atualizados continuamente. Neste repositório você tem uma fatia
real desse problema: duas fontes de métricas com formatos diferentes entre si
(como acontece de fato entre Facebook Ads e Google Ad Manager), uma rotina de
ingestão que precisa lidar com reenvios e dados incompletos, e dinheiro em
mais de uma moeda.

Você vai construir quatro peças, uma por seção abaixo: **Ingestão**,
**Relatório consolidado**, **Módulo de dinheiro** e **Reconciliação de
gaps**. Cada seção traz o contrato (o que já está pronto) e o que falta
implementar.

## Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

A API sobe em `http://localhost:3000`. `GET /health` confirma que está no ar.

## Os dados

Estes modelos já existem em `prisma/schema.prisma`, populados por
`prisma/seed.sql`:

- **`FacebookAdMetric`**: uma linha por campanha/dia. `localDate` é o dia
  civil na timezone do anunciante (`accountTimezone`), não UTC. `spend` está
  na moeda da conta (`accountCurrency`, BRL ou USD), a moeda de um site é
  constante ao longo do tempo, não muda de um dia pro outro.
- **`GamAdMetric`**: uma linha por site/dia. `utcDate` é sempre UTC.
  `adRevenue` está sempre em USD (`currencyCode`).
- **`SiteMapping`**: liga o `siteRef` do Facebook ao `siteCode` do GAM para
  os sites conhecidos, e carrega os parâmetros financeiros de cada site:
  `revSharePct` (quanto a rede de anúncios retém da receita bruta do GAM
  antes de repassar ao site), `taxOnRevenuePct` (tributo sobre a receita
  líquida) e `taxOnMediaCostPct` (tributo/taxa sobre o custo de mídia). Nem
  todo `siteCode` que aparece em `GamAdMetric` tem uma linha aqui. Não tem
  campo de moeda, a moeda de cada site vem de `FacebookAdMetric.accountCurrency`.
- **`FxRate`**: cotação USD→BRL por dia. Só é necessária para sites em BRL
  (para converter a receita do GAM, que é sempre em USD). Nem todo dia do
  período tem uma linha aqui.

Os dados foram seedados com inconsistências propositais, do jeito que dados
reais de integrações costumam chegar. Parte do desafio é encontrá-las e
decidir o que fazer com cada uma — trate-as de forma explícita e
documentada no `DECISIONS.md`, não silenciosamente.

## Ingestão via webhook

Em vez de puxar dado de uma API externa, este desafio simula o cenário
inverso: a rede de anúncios empurra os dados pra você via webhook.
`POST /ingestion/webhook` recebe:

```json
{
  "facebook": [
    {
      "externalCampaignId": "fb-site-nutrihealth-camp-1",
      "campaignName": "Nutri Health - Prospecting",
      "siteRef": "site-nutrihealth",
      "localDate": "2026-08-05",
      "accountTimezone": "America/Sao_Paulo",
      "accountCurrency": "BRL",
      "spend": 259.2,
      "impressions": 9110,
      "clicks": 191
    }
  ],
  "gam": [
    {
      "networkCode": "network-001",
      "siteCode": "NUTRIHEALTH_MAIN",
      "utcDate": "2026-08-05",
      "currencyCode": "USD",
      "adRevenue": 37.08,
      "impressions": 8830,
      "adRequests": 10154
    }
  ]
}
```

Os arrays `facebook`/`gam` podem vir vazios (`[]`), significa que a fonte
não tinha dado nenhum para aquele dia, não é um erro. Reenviar o mesmo
payload (o mesmo webhook entregue duas vezes, cenário comum em integrações
reais) não pode duplicar linha nem piorar um dado que já estava bom. Se
processado com sucesso, a rota responde `200` sem corpo.

**O que já está pronto:** a rota (`POST /ingestion/webhook`,
`src/ingestion/ingestion.controller.ts`) e a validação do payload
(`IngestMetricsInputDto`).

**O que falta implementar:** `IngestionService#processMetrics`, persistir
`facebook` em `FacebookAdMetric` e `gam` em `GamAdMetric`.

## Relatório consolidado

`GET /reports?from=<data>&to=<data>&siteRef=<opcional>` devolve um array
com uma entrada por site no período, neste formato (valores abaixo são só
ilustrativos, não os do seed real):

```json
[
  {
    "siteRef": "string",
    "siteCode": "string",
    "displayName": "string",
    "currency": "BRL | USD",
    "impressions": 0,
    "clicks": 0,
    "ctr": 0,
    "cpa": 0,
    "mediaCostLocal": 0,
    "mediaCostWithTaxLocal": 0,
    "grossRevenueUsd": 0,
    "netRevenueLocal": 0,
    "profitLocal": 0,
    "roas": 0
  }
]
```

`siteRef` é opcional: com `?from=<data>&to=<data>&siteRef=site-x`, o array
vem com uma única entrada (a de `site-x`); com `?from=<data>&to=<data>`
(sem `siteRef`), o array vem com uma entrada por site do período. Se
`siteRef` não corresponder a nenhum site conhecido, devolva um array vazio
(não é erro).

O câmbio (`FxRate`) varia por dia dentro do período, some/agregue os
valores em dinheiro dia a dia (chamando `MoneyService#calculate` uma vez
por dia, com o `fxRate` daquele dia) antes de consolidar a linha do site
pro período inteiro. Não existe uma precisão de casas decimais exigida
para `ctr`/`cpa`, arredonde do jeito que fizer sentido pra você; o que é
avaliado é a ausência de ponto flutuante binário no caminho do dinheiro
(`mediaCostLocal`, `mediaCostWithTaxLocal`, `grossRevenueUsd`,
`netRevenueLocal`, `profitLocal`, `roas`), não a precisão de `ctr`/`cpa`.

**O que já está pronto:** a rota, o DTO de filtros (`ReportQueryInputDto`,
já validado) e o shape de resposta (`SiteReportOutputDto`) em
`src/reports/`.

**O que falta implementar:** `ReportsService#getReport`, unir as duas
fontes por site (via `SiteMapping`), calcular as métricas derivadas
(chamando `MoneyService#calculate`) e aplicar os filtros de período e,
opcionalmente, de site.

## Módulo de dinheiro

A conversão de receita bruta em lucro segue uma ordem de operações
específica: revShare → tributo sobre receita → câmbio → tributo sobre
custo de mídia → lucro/ROAS. Inverter essa ordem muda o resultado, e a
diferença costuma aparecer só na segunda ou terceira casa decimal, onde é
mais difícil de notar:

```
netRevenueUsd         = grossRevenueUsd × (1 − revSharePct)
netRevenueAfterTaxUsd  = netRevenueUsd × (1 − taxOnRevenuePct)
netRevenueLocal        = netRevenueAfterTaxUsd × fxRate   // 1:1 se o site já é USD
mediaCostWithTaxLocal  = mediaCostLocal × (1 + taxOnMediaCostPct)
profitLocal            = netRevenueLocal − mediaCostWithTaxLocal
roas                   = netRevenueLocal / mediaCostWithTaxLocal
```

`MoneyService#calculate` recebe um `fxRate` escalar — ele calcula o
resultado de **um dia** (ou de qualquer janela onde o câmbio já é um valor
só). Como o câmbio muda dia a dia, quem soma vários dias num período (o
relatório) é responsável por chamar `calculate` uma vez por dia e agregar
os resultados depois, `calculate` em si não sabe nada sobre período.

O schema não tem campo de conversão/ação, só `impressions`/`clicks`. Por
isso, `cpa` (custo por ação) é definido explicitamente neste desafio como
custo por clique:

```
cpa = mediaCostWithTaxLocal / clicks
```

Exemplo (números redondos, não são de nenhum site real do seed, só pra
deixar a ordem de operações inequívoca):

```json
// entrada (MoneyInput)
{
  "grossRevenueUsd": 100,
  "revSharePct": 0.30,
  "taxOnRevenuePct": 0.10,
  "fxRate": 5.00,
  "mediaCostLocal": 200,
  "taxOnMediaCostPct": 0.02
}
```

```json
// saída (MoneyResult)
{
  "netRevenueUsd": 70,
  "netRevenueAfterTaxUsd": 63,
  "netRevenueLocal": 315,
  "mediaCostWithTaxLocal": 204,
  "profitLocal": 111,
  "roas": 1.5441
}
```

**O que já está pronto:** o service (`MoneyService`) e os tipos de
entrada/saída (`MoneyInput`/`MoneyResult`, em `src/money/money.types.ts`).

**O que falta implementar:** `MoneyService#calculate`. Qual representação
numérica usar (`number`, `Decimal`, Value Object, outra lib) é sua escolha
— e faz parte do que é avaliado; ponto flutuante binário não é adequado
para dinheiro em nenhum ponto do caminho.

## Reconciliação de gaps

Como a ingestão agora é passiva (o webhook só grava o que chega), nada
detecta sozinho um dia que devia ter tido dado e não teve.
`GET /reconciliation/gaps?from=<data>&to=<data>` devolve um array com um
item por (fonte, site, dia) sem dado no período, neste formato:

```json
[
  { "source": "facebook | gam", "site": "string", "date": "YYYY-MM-DD" }
]
```

Sem gaps no período, devolve `[]`.

**O que já está pronto:** a rota e a validação do período
(`GapReportQueryInputDto`) em `src/reconciliation/`.

**O que falta implementar:** `ReconciliationService#findGaps` — uma
varredura de série temporal: para cada site em `SiteMapping`, no período
`[from, to]` informado, encontre dias sem nenhuma linha em
`FacebookAdMetric`/`GamAdMetric`.

## Escopo

**Essencial** (é o que avaliamos primeiro):
- **módulo de dinheiro** seguindo a ordem de operações acima, sem ponto
  flutuante binário no caminho do dinheiro;
- **ingestão via webhook** (`POST /ingestion/webhook`), idempotente sob
  reprocessamento e resiliente a arrays vazios (sem sobrescrever dado bom);
- **relatório consolidado** (`GET /reports`), unindo as duas fontes por site
  (via `SiteMapping`) e agregando o câmbio dia a dia;
- **reconciliação de gaps** (`GET /reconciliation/gaps?from=&to=`) que
  detecta dias sem dado no período informado, por site e por fonte.

Não precisa entregar tudo perfeito. Preferimos ver **suas decisões e seu
raciocínio** (no `DECISIONS.md`) do que completude: quem implementa menos,
mas justifica bem, pontua melhor do que quem faz tudo no piloto automático.

**Diferencial (opcional, só se sobrar tempo):**
- testes automatizados além do caminho feliz (idempotência, payload vazio,
  ROAS, gaps);
- tratamento de erros e observabilidade (logs estruturados);
- uma rotina que sinalize ativamente os gaps encontrados, além de reportá-los
  na resposta.

## O que você pode mudar, o que precisa preservar

Nosso contrato com você é só a nível de endpoint, nada no código interno é
fixo.

**Preserve** (é o único contrato real, o que a avaliação chama de fora):
- `POST /ingestion/webhook` aceitando `{ facebook: [...], gam: [...] }` no
  formato documentado acima e respondendo `200` quando processado com
  sucesso.
- `GET /reports` aceitando `from`/`to`/`siteRef` como query params e
  respondendo com um array no formato de `SiteReportOutputDto` (mesmos
  nomes de campo documentados em `src/reports/dto/report.output.dto.ts`).
- `GET /reconciliation/gaps` aceitando `from`/`to` como query params e
  respondendo com um array no formato de `GapReportOutputDto`
  (`source`/`site`/`date`).

**Livre pra decidir** (o resto é implementação sua, sem restrição nossa):
- Nomes de classes/métodos, quantos services/repositórios você cria, como
  organiza os arquivos, os DTOs, controllers e services que vieram prontos
  são só um ponto de partida, não uma obrigação. Pode apagar, renomear ou
  reestruturar o que quiser, contanto que as três rotas acima continuem
  funcionando como documentado.
- Qual representação numérica usar no cálculo monetário (`number`,
  `Decimal`, Value Object, outra lib), justifique a escolha no
  `DECISIONS.md`.
- Qual chave natural usar pra idempotência da ingestão, e se ela vira uma
  constraint no banco ou uma checagem na aplicação.
- Mudanças no schema Prisma além do que já existe (novas tabelas,
  constraints, etc.) só não altere os dados históricos já seedados.
- Estrutura e nomenclatura dos seus testes automatizados (não veio nenhum
  esqueleto de teste de propósito).
- Os itens de "Diferencial", implemente os que achar que valem seu tempo,
  ou nenhum.

## Entrega

Além do código, inclua na raiz um `DECISIONS.md` (use `DECISIONS.template.md`
como ponto de partida) respondendo às perguntas ali indicadas.
