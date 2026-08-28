export interface MoneyInput {
  grossRevenueUsd: number;
  revSharePct: number;
  taxOnRevenuePct: number;
  fxRate: number; // 1 se o site já é USD
  mediaCostLocal: number;
  taxOnMediaCostPct: number;
}

export interface MoneyResult {
  netRevenueUsd: number;
  netRevenueAfterTaxUsd: number;
  netRevenueLocal: number;
  mediaCostWithTaxLocal: number;
  profitLocal: number;
  roas: number;
}
