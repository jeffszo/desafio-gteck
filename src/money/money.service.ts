import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma-client";
import type { MoneyInput, MoneyResult } from "./money.types";

// Casas decimais de arredondamento final. Dinheiro fecha em 2 (é o que o
// schema já usa pra spend/adRevenue, Decimal(12,2)); roas fica com mais
// casas porque é um índice, não um valor monetário -- o próprio exemplo
// do README (1.5441) só bate se ele não for arredondado pra 2 casas.
const MONEY_DECIMALS = 2;
const ROAS_DECIMALS = 4;

@Injectable()
export class MoneyService {
  // Ordem de operações do README, ao pé da letra: revShare -> tributo
  // sobre receita -> câmbio -> tributo sobre custo de mídia -> lucro/roas.
  // Ela não é só uma preferência de leitura -- inverter troca o resultado
  // de verdade, porque cada tributo incide sobre uma base diferente
  // (receita líquida vs. custo de mídia) e porque, na prática, cada etapa
  // arredondaria o valor de forma diferente se a ordem mudasse. Ver
  // DECISIONS.md, seção 4, pra essa conta completa.
  //
  // MoneyInput/MoneyResult são number (contrato já dado, não fixado por
  // nós), mas nenhuma conta acontece em number: tudo vira Prisma.Decimal
  // logo na entrada, a cadeia inteira roda em Decimal, e só no fim cada
  // campo de saída volta pra number. Como grossRevenueUsd/spend/etc já
  // vêm do banco com no máximo poucas casas decimais, essa ida e volta
  // number -> Decimal -> number não perde precisão -- o que importaria
  // perder é fazer conta em cima do number, e isso a gente nunca faz.
  public calculate(input: MoneyInput): MoneyResult {
    const grossRevenueUsd = new Prisma.Decimal(input.grossRevenueUsd);
    const revSharePct = new Prisma.Decimal(input.revSharePct);
    const taxOnRevenuePct = new Prisma.Decimal(input.taxOnRevenuePct);
    const fxRate = new Prisma.Decimal(input.fxRate);
    const mediaCostLocal = new Prisma.Decimal(input.mediaCostLocal);
    const taxOnMediaCostPct = new Prisma.Decimal(input.taxOnMediaCostPct);
    const one = new Prisma.Decimal(1);

    const netRevenueUsd = grossRevenueUsd.times(one.minus(revSharePct));
    const netRevenueAfterTaxUsd = netRevenueUsd.times(one.minus(taxOnRevenuePct));
    const netRevenueLocal = netRevenueAfterTaxUsd.times(fxRate);
    const mediaCostWithTaxLocal = mediaCostLocal.times(one.plus(taxOnMediaCostPct));
    const profitLocal = netRevenueLocal.minus(mediaCostWithTaxLocal);

    // Custo zero num dia/período (acontece com sites sem gasto de mídia
    // registrado) não pode virar Infinity/NaN. Documentando aqui: sem
    // custo, não tem uma razão de retorno significativa pra reportar,
    // então roas cai pra 0 em vez de estourar a divisão.
    const roas = mediaCostWithTaxLocal.isZero()
      ? new Prisma.Decimal(0)
      : netRevenueLocal.dividedBy(mediaCostWithTaxLocal);

    return {
      netRevenueUsd: this.toMoney(netRevenueUsd),
      netRevenueAfterTaxUsd: this.toMoney(netRevenueAfterTaxUsd),
      netRevenueLocal: this.toMoney(netRevenueLocal),
      mediaCostWithTaxLocal: this.toMoney(mediaCostWithTaxLocal),
      profitLocal: this.toMoney(profitLocal),
      roas: roas.toDecimalPlaces(ROAS_DECIMALS).toNumber(),
    };
  }

  private toMoney(value: Prisma.Decimal): number {
    return value.toDecimalPlaces(MONEY_DECIMALS).toNumber();
  }
}
