import { describe, expect, it } from "vitest";
import { MoneyService } from "./money.service";

describe("MoneyService#calculate", () => {
  const service = new MoneyService();

  it("bate exatamente com o exemplo numérico do README", () => {
    const result = service.calculate({
      grossRevenueUsd: 100,
      revSharePct: 0.3,
      taxOnRevenuePct: 0.1,
      fxRate: 5.0,
      mediaCostLocal: 200,
      taxOnMediaCostPct: 0.02,
    });

    expect(result).toEqual({
      netRevenueUsd: 70,
      netRevenueAfterTaxUsd: 63,
      netRevenueLocal: 315,
      mediaCostWithTaxLocal: 204,
      profitLocal: 111,
      roas: 1.5441,
    });
  });

  it("site em USD (fxRate = 1) não sofre conversão nenhuma", () => {
    // espelha vida-ativa/bem-estar do seed: tributos zerados, moeda já é USD
    const result = service.calculate({
      grossRevenueUsd: 1000,
      revSharePct: 0.3,
      taxOnRevenuePct: 0,
      fxRate: 1,
      mediaCostLocal: 400,
      taxOnMediaCostPct: 0,
    });

    expect(result).toEqual({
      netRevenueUsd: 700,
      netRevenueAfterTaxUsd: 700,
      netRevenueLocal: 700,
      mediaCostWithTaxLocal: 400,
      profitLocal: 300,
      roas: 1.75,
    });
  });

  it("custo de mídia zero dá roas 0, não Infinity nem NaN", () => {
    const result = service.calculate({
      grossRevenueUsd: 500,
      revSharePct: 0.2,
      taxOnRevenuePct: 0.05,
      fxRate: 1,
      mediaCostLocal: 0,
      taxOnMediaCostPct: 0.1,
    });

    expect(result.mediaCostWithTaxLocal).toBe(0);
    expect(result.roas).toBe(0);
    expect(Number.isFinite(result.roas)).toBe(true);
    expect(Number.isNaN(result.roas)).toBe(false);
  });

  it("arredonda em 2 casas os campos de dinheiro e em 4 o roas, mesmo com entradas de muitas casas decimais", () => {
    const result = service.calculate({
      grossRevenueUsd: 33.333,
      revSharePct: 0.3333,
      taxOnRevenuePct: 0.1111,
      fxRate: 5.5555,
      mediaCostLocal: 17.777,
      taxOnMediaCostPct: 0.0333,
    });

    // conferido à parte com decimal.Decimal em Python, arredondamento
    // meio-pra-cima -- se der um valor bem próximo mas não exatamente
    // esse, é sinal de ponto flutuante binário entrando na conta em
    // algum passo da cadeia.
    expect(result).toEqual({
      netRevenueUsd: 22.22,
      netRevenueAfterTaxUsd: 19.75,
      netRevenueLocal: 109.74,
      mediaCostWithTaxLocal: 18.37,
      profitLocal: 91.38,
      roas: 5.9744,
    });
  });

  it("devolve number puro em todos os campos (contrato de MoneyResult), nunca uma instância de Decimal", () => {
    const result = service.calculate({
      grossRevenueUsd: 10,
      revSharePct: 0,
      taxOnRevenuePct: 0,
      fxRate: 1,
      mediaCostLocal: 5,
      taxOnMediaCostPct: 0,
    });

    for (const [field, value] of Object.entries(result)) {
      expect(typeof value, `${field} deveria ser number`).toBe("number");
    }
  });
});
