# DECISIONS.md

## 1. Modelagem e arquitetura

Mantive a estrutura que já veio no projeto, separando `ingestion`, `money`, `reports`, `reconciliation` e `prisma`. Para o tamanho do desafio, achei que essa divisão já deixava bem claro o papel de cada parte, então não vi necessidade de criar mais camadas.

Adicionei `src/common/date.util.ts` para centralizar a normalização de datas e a geração dos dias de um período. Essas regras são usadas em diferentes partes da aplicação e, mantendo tudo em um único lugar, evito comportamentos diferentes de timezone entre ingestão, relatórios e reconciliação.

Também coloquei o tratamento global de exceções e os logs estruturados em `src/common`, já que são responsabilidades compartilhadas pela aplicação e não de um domínio específico.

Não criei um módulo separado para `SiteMapping` porque ele funciona basicamente como uma tabela de referência. Como não existe uma regra de negócio própria ali, achei desnecessário criar mais uma camada.

## 2. Inconsistências encontradas

### Duplicata do Facebook

Encontrei uma duplicata para `fb-site-nutrihealth-camp-1` em `2026-07-11`. As duas linhas tinham os mesmos valores e fariam o `spend` daquele dia ser somado duas vezes no relatório.

Minha primeira tentativa foi só apagar a duplicata dentro da própria migration, com um `DELETE` antes de criar a constraint. Rodando o setup completo, isso não resolveu: `prisma:seed` recarrega o `seed.sql` inteiro do zero toda vez que roda, então a duplicata voltava e quebrava a constraint que a migration acabara de criar. A correção de verdade precisava estar no `seed.sql`, não só no banco — removi a duplicata do seed  e mantive o `DELETE` na migration só como rede de segurança, pra quem já tiver esse registro carregado de uma execução anterior.

### Dia sem `FxRate`

O dia `2026-07-21` não possui cotação. Nesse caso, utilizo a última cotação disponível antes do dia (carry-forward) e registro um aviso no log. Se não existir nenhuma cotação anterior, prefiro não inventar uma taxa. Nesse cenário, a receita local fica `0` e o caso é registrado no log.

Em um sistema de produção, eu trataria esse caso de forma mais explícita, diferenciando um valor realmente igual a zero de um valor que não pôde ser calculado.

### Gaps e dados órfãos

O `FITPRO_MAIN` possui cinco dias sem dados no GAM. Mantive esses dias como ausência de receita e deixei a inconsistência disponível na rota de reconciliação.

Também encontrei o `PROMOSAUDE_MAIN` no GAM sem um registro correspondente em `SiteMapping`. Como faltam informações como `revShare`, imposto e moeda, não há dados suficientes para incluí-lo no relatório consolidado. Mantive os dados originais e deixei esse caso como uma possível melhoria futura.

## 3. Idempotência e ingestão

Para o Facebook, utilizo `(externalCampaignId, localDate)` como chave natural.

Para o GAM, utilizo `(siteCode, utcDate)`.

Essas chaves possuem `@@unique` no banco e são utilizadas pelo `upsert`, evitando duplicidades quando o mesmo payload é processado novamente.

Escolhi `externalCampaignId` no Facebook porque um mesmo site pode ter mais de uma campanha no mesmo dia. Usar apenas `siteRef` poderia fazer campanhas diferentes serem tratadas como a mesma linha. Quando `facebook` ou `gam` chegam como `[]`, nenhuma operação é realizada para aquela fonte. Dessa forma, um payload vazio não apaga nem altera dados que já estejam persistidos.

No caso de um reenvio idêntico, nada é alterado. Se os valores forem diferentes, aplico `last-write-wins` e registro um aviso no log para deixar essa alteração visível. Os upserts do payload são executados dentro de uma transaction para evitar que apenas parte dos dados seja persistida caso alguma operação falhe.

## 4. Módulo de dinheiro

Utilizei `Prisma.Decimal` nas operações financeiras do `MoneyService` para evitar cálculos com ponto flutuante.

O cálculo segue a ordem definida no README:

`netRevenueUsd` → `netRevenueAfterTaxUsd` → `netRevenueLocal` → `mediaCostWithTaxLocal` → `profitLocal` → `roas`

A ordem importa porque cada imposto possui uma base diferente. Alterar essa sequência pode mudar o resultado final de receita, custo, lucro e ROAS.

Mantive `MoneyInput` e `MoneyResult` como `number`, pois esse já era o contrato definido pelo desafio. Internamente, os valores são convertidos para `Decimal` antes dos cálculos e só voltam para `number` na saída, depois do arredondamento.

Quando o custo de mídia é zero, retorno `roas = 0` em vez de `Infinity`. O mesmo cuidado é aplicado ao `cpa` quando não existem cliques.

## 5. Reconciliação

O `findGaps` primeiro gera os dias esperados para o período e depois consulta os dados existentes de cada fonte utilizando `groupBy`.

Com isso, consigo comparar os dias esperados com os dias encontrados sem fazer uma query para cada site ou para cada dia.

Os gaps são apenas reportados pela API. Não implementei um alerta automático porque isso não fazia parte do fluxo essencial do desafio.

Também mantenho os identificadores específicos de cada fonte: `facebookSiteRef` para Facebook e `gamSiteCode` para GAM.

## 6. Testes e trade-offs

Os testes cobrem o cálculo financeiro, ingestão, idempotência, payload vazio, divergências, relatórios e reconciliação.

O `MoneyService` e o `AllExceptionsFilter` possuem testes unitários. Ingestão, relatórios e reconciliação possuem testes de integração utilizando PostgreSQL.

Além dos testes automatizados (`npm test`: 22/22 passando, migrate + seed rodados de verdade), validei manualmente as três rotas principais na mão via Insomnia contra a API rodando: idempotência do webhook (mesmo payload duas vezes, relatório não muda), `GET /reports` do mês inteiro contra os 4 sites, e `GET /reconciliation/gaps` contra os 5 dias reais do FITPRO_MAIN — tudo batendo com número calculado à parte em Python.

Por questão de tempo, não implementei uma rotina automática para alertar sobre gaps. Hoje a inconsistência pode ser consultada pela API. Com mais tempo, eu adicionaria um processo agendado para identificar e notificar esses casos.

## 7. Escala

A implementação atual evita N+1 nos relatórios e na reconciliação, utilizando agregações diretamente no banco.

Com um volume 100x maior, eu reduziria ainda mais os dados processados em memória, utilizando consultas SQL mais específicas, índices adequados e paginação nos relatórios.

Na ingestão, payloads muito grandes poderiam ser processados com operações de upsert em lote em vez de vários upserts individuais.

Se os relatórios fossem consultados com muita frequência sobre períodos já fechados, também consideraria agregações diárias pré-calculadas ou cache.
