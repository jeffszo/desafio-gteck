# Checklist de entrega — Desafio técnico (escopo completo)

> Escopo confirmado: **versão completa** (4 peças + `DECISIONS.md` completo),
> não a versão enxuta. Lista tratando o projeto como zero implementado —
> hoje os 4 services de negócio são só `throw new Error("not implemented")`.

## 0. Ambiente (pré-requisito, nada disso existe rodando ainda)

- [ ] `cp .env.example .env`
- [ ] `docker compose up -d` (sobe o Postgres)
- [ ] `npm install`
- [ ] `npm run prisma:migrate` (aplica a migration inicial que já existe)
- [ ] `npm run prisma:seed` (popula com o `seed.sql`)
- [ ] `npm run start:dev` e confirmar `GET /health` respondendo
- [ ] Rodar `npm run test` uma vez no estado inicial só pra confirmar que o
      projeto builda/roda antes de mexer em qualquer service

## 1. Schema Prisma — antes de implementar os services

- [ ] Decidir e criar a migration com as constraints de idempotência:
      `@@unique([externalCampaignId, localDate])` em `FacebookAdMetric` e
      `@@unique([siteCode, utcDate])` em `GamAdMetric` (não altera dado
      existente, só adiciona constraint — permitido pelo enunciado)
- [ ] `npx prisma migrate dev` gerando a nova migration e regenerando o
      client (`src/generated/prisma-client`)
- [ ] Confirmar que o seed ainda aplica limpo depois da nova migration

## 2. Módulo de dinheiro — `MoneyService#calculate` (ESSENCIAL)

- [ ] Escolher e justificar a representação numérica (`Decimal` do Prisma,
      `decimal.js`, Value Object, etc. — nenhuma binária no caminho do
      dinheiro)
- [ ] Implementar a cadeia exata: `netRevenueUsd` → `netRevenueAfterTaxUsd`
      → `netRevenueLocal` → `mediaCostWithTaxLocal` → `profitLocal` → `roas`
- [ ] Bater o resultado contra o exemplo numérico do README (
      `grossRevenueUsd=100, revSharePct=0.30, taxOnRevenuePct=0.10,
      fxRate=5.00, mediaCostLocal=200, taxOnMediaCostPct=0.02` deve dar
      `roas=1.5441`)
- [ ] Definir e implementar o arredondamento final (quantas casas em cada
      campo de saída) — decisão a documentar no `DECISIONS.md`
- [ ] Tratar `mediaCostWithTaxLocal = 0` no denominador do `roas` sem
      `Infinity`/`NaN` silencioso
- [ ] Cobrir com teste: site USD (`fxRate=1`), `revSharePct`/`taxOn*`
      zerados (casos `vida-ativa`/`bem-estar` no seed)

## 3. Ingestão via webhook — `IngestionService#processMetrics` (ESSENCIAL)

- [ ] Implementar persistência de `facebook[]` em `FacebookAdMetric` via
      `upsert` pela chave natural `(externalCampaignId, localDate)`
- [ ] Implementar persistência de `gam[]` em `GamAdMetric` via `upsert`
      pela chave natural `(siteCode, utcDate)`
- [ ] Envolver os upserts do mesmo payload numa `$transaction`
- [ ] Garantir que `facebook: []` ou `gam: []` é no-op pra aquela fonte
      (não apaga/zera dado já persistido)
- [ ] Testar reprocessamento do payload idêntico (equivalente ao
      `seed-fb-dup-125`/`seed-fb-15` do seed: mesmo `siteRef`+`localDate`,
      mesmos valores) e confirmar que não duplica linha
- [ ] Decidir e documentar o comportamento quando o reenvio traz valor
      **diferente** do já persistido (upsert/last-write-wins vs. preservar
      o primeiro e logar divergência)
- [ ] Teste de payload com um array vazio não afeta a outra fonte

## 4. Relatório consolidado — `ReportsService#getReport` (ESSENCIAL)

- [ ] Resolver o(s) site(s) alvo a partir de `SiteMapping` (filtrado por
      `siteRef` se informado; `siteRef` desconhecido devolve `[]` sem tocar
      nas outras tabelas)
- [ ] Buscar `FacebookAdMetric` agregado por `(siteRef, localDate)` no
      período, `GamAdMetric` agregado por `(siteCode, utcDate)` no
      período, e `FxRate` do período — sem N+1 (queries agregadas, não
      uma por site/dia)
- [ ] Iterar dia a dia por site, montando o `MoneyInput` do dia (receita
      GAM ausente naquele dia = `0`, não é dia a pular — cobre o gap real
      de 5 dias do `FITPRO_MAIN` no seed) e chamando
      `MoneyService#calculate` uma vez por dia com o `fxRate` daquele dia
      (`1` se o site é USD)
- [ ] Decidir e implementar o comportamento quando falta `FxRate` num dia
      que precisa dele (o gap real de `2026-07-21` no seed): carry-forward
      da última cotação, falha pontual daquele dia, ou outra escolha —
      documentar
- [ ] Agregar os resultados diários em `Decimal` nos totais do site;
      recalcular `roas` do período como `netRevenueLocal total /
      mediaCostWithTaxLocal total` (não como média dos `roas` diários);
      mesmo raciocínio pra `ctr`/`cpa` do período
- [ ] Confirmar que `GamAdMetric` de site órfão (`PROMOSAUDE_MAIN` no seed,
      sem entrada em `SiteMapping`) nunca aparece no relatório
- [ ] Aplicar filtro de período (`from`/`to`) e `siteRef` opcional
      corretamente

## 5. Reconciliação de gaps — `ReconciliationService#findGaps` (ESSENCIAL)

- [ ] Gerar a série de dias `[from, to]` uma vez
- [ ] Pra cada site em `SiteMapping`, identificar dias sem nenhuma linha em
      `FacebookAdMetric` (por `siteRef`) e sem nenhuma em `GamAdMetric`
      (por `siteCode`) — sem 1 query por dia por site
- [ ] Confirmar que os 5 dias de gap reais do `FITPRO_MAIN`
      (`2026-07-15` a `2026-07-19`) aparecem no resultado
- [ ] Confirmar que sites com dado completo no período não geram falso
      positivo
- [ ] Sem gaps no período → devolve `[]`

## 6. `DECISIONS.md` (ESSENCIAL — entrega exige isso na raiz)

- [ ] Copiar `DECISIONS.template.md` → `DECISIONS.md`
- [ ] 1. Modelagem e arquitetura: o que foi criado/mudado além do que veio
      pronto, e por quê
- [ ] 2. Inconsistências encontradas: a duplicata do Facebook, o dia sem
      `FxRate`, o gap de 5 dias do GAM em `FITPRO_MAIN`, o site GAM órfão
      `PROMOSAUDE_MAIN` — pra cada uma, ignorou/corrigiu/sinalizou e por quê
- [ ] 3. Idempotência e resiliência: qual chave natural, o que acontece com
      arrays vazios
- [ ] 4. Módulo de dinheiro: representação numérica escolhida, por que a
      ordem de operações importa
- [ ] 5. Reconciliação de gaps: o que a implementação faz ao achar um gap
- [ ] 6. Trade-offs: o que ficou de fora por tempo, o que faria diferente
      com mais tempo
- [ ] 7. Escala: o que mudaria com 100x mais dados

## 7. Contrato de rota — não pode quebrar (validar no fim, não implementar)

- [ ] `POST /ingestion/webhook` aceita `{facebook, gam}` no formato
      documentado e responde `200` sem corpo
- [ ] `GET /reports` aceita `from`/`to`/`siteRef`, responde no formato de
      `SiteReportOutputDto`
- [ ] `GET /reconciliation/gaps` aceita `from`/`to`, responde no formato de
      `GapReportOutputDto`

## 8. Diferencial (OPCIONAL — só se sobrar tempo, nessa ordem de valor)

- [ ] Testes automatizados além do caminho feliz (idempotência, payload
      vazio, ROAS com os casos de borda, gaps)
- [ ] Tratamento de erros e observabilidade (logs estruturados)
- [ ] Rotina que sinalize ativamente os gaps encontrados (além de
      reportá-los na resposta do `GET /reconciliation/gaps`)

## 9. Antes de entregar

- [ ] Rodar as 3 rotas manualmente (curl/Postman) contra o seed real e
      conferir os números batem com o que o `MoneyService` calcularia à mão
      pra pelo menos 1 site
- [ ] `npm run test` passando
- [ ] Revisar se nada do "contrato" (seção 7 acima) foi alterado
- [ ] `DECISIONS.md` na raiz, respondido
