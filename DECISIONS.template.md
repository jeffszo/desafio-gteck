# DECISIONS.md

> Copie este arquivo para `DECISIONS.md` na raiz do projeto e responda antes
> de entregar. Não há tamanho mínimo ou máximo, queremos seu raciocínio, não
> um texto longo.

## 1. Modelagem e arquitetura

- Que classes/services/camadas você criou ou mudou além do que já veio
  pronto (controllers, DTOs, module)?
- Por que essa divisão e não outra?

## 2. Inconsistências encontradas

- Quais inconsistências você encontrou nos dados seedados
  (`FacebookAdMetric`, `GamAdMetric`, `SiteMapping`, `FxRate`)?
- Para cada uma: você ignorou (com justificativa), corrigiu ou sinalizou?
  Por quê?

## 3. Idempotência e resiliência da ingestão

- Qual chave natural você usa em `processMetrics` pra não duplicar uma
  linha ao reprocessar o mesmo payload?
- O que acontece especificamente quando `facebook`/`gam` chegam vazios
  (`[]`)?

## 4. Módulo de dinheiro

- Qual representação numérica você escolheu pra `MoneyService#calculate`
  (`number`, `Decimal`, Value Object, outra lib)? Por quê?
- Por que a ordem de operações (revShare → tributo sobre receita → câmbio
  → tributo sobre custo de mídia) importa? O que mudaria no resultado se
  fosse diferente?

## 5. Reconciliação de gaps

- Ao encontrar um gap, o que sua implementação faz com essa informação
  (só reporta na resposta, loga, outra coisa)?

## 6. Trade-offs e o que ficou de fora

- O que você deixou de lado por tempo?
- O que faria diferente com mais tempo disponível?

## 7. Escala

- Se o volume de dados fosse 100x maior, o que mudaria na sua abordagem?
