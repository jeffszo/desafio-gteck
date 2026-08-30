import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma-client";
import type { MoneyInput, MoneyResult } from "./money.types";


const MONEY_DECIMALS = 2;
const ROAS_DECIMALS = 4;

@Injectable()
export class MoneyService {
 
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
