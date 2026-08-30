import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReportsService } from "./reports.service";
import { MoneyService } from "../money/money.service";
import { testPrisma } from "../test/prisma-test-client";
import { toUtcDateOnly } from "../common/date.util";

const SITE_REF = "vitest-reports-site";
const SITE_CODE = "VITEST_REPORTS_SITE";
const ORPHAN_SITE_CODE = "VITEST_REPORTS_ORPHAN";

// Cinco dias com um gap de receita GAM (03) e um gap de câmbio (04) de
// propósito -- os mesmos dois tipos de inconsistência do seed real
// (FITPRO_MAIN e o FxRate de 21/07), só que num intervalo isolado (2030)
// onde eu controlo os números e sei de cabeça o resultado esperado.
const DAYS = [
  { date: "2030-01-01", spend: 100, adRevenue: 40, fx: 5.0 },
  { date: "2030-01-02", spend: 110, adRevenue: 45, fx: 5.1 },
  { date: "2030-01-03", spend: 120, adRevenue: null, fx: 5.2 }, // gastou mídia, GAM não registrou receita
  { date: "2030-01-04", spend: 130, adRevenue: 50, fx: null }, // sem cotação -- espera carry-forward do dia 03 (5.2)
  { date: "2030-01-05", spend: 140, adRevenue: 55, fx: 5.4 },
] as const;

describe("ReportsService#getReport", () => {
  const service = new ReportsService(testPrisma, new MoneyService());

  beforeAll(async () => {
    await testPrisma.$connect();

    await testPrisma.siteMapping.upsert({
      where: { facebookSiteRef: SITE_REF },
      create: {
        facebookSiteRef: SITE_REF,
        gamSiteCode: SITE_CODE,
        displayName: "Vitest Reports Site",
        revSharePct: 0.3,
        taxOnRevenuePct: 0.05,
        taxOnMediaCostPct: 0.02,
      },
      update: {},
    });

    for (const day of DAYS) {
      await testPrisma.facebookAdMetric.upsert({
        where: {
          facebookMetricNaturalKey: {
            externalCampaignId: `vitest-reports-camp-${day.date}`,
            localDate: toUtcDateOnly(day.date),
          },
        },
        create: {
          externalCampaignId: `vitest-reports-camp-${day.date}`,
          campaignName: "Vitest Reports Campaign",
          siteRef: SITE_REF,
          localDate: toUtcDateOnly(day.date),
          accountTimezone: "America/Sao_Paulo",
          accountCurrency: "BRL",
          spend: day.spend,
          impressions: 1000,
          clicks: 50,
        },
        update: { spend: day.spend },
      });

      if (day.adRevenue !== null) {
        await testPrisma.gamAdMetric.upsert({
          where: {
            gamMetricNaturalKey: { siteCode: SITE_CODE, utcDate: toUtcDateOnly(day.date) },
          },
          create: {
            networkCode: "vitest-network",
            siteCode: SITE_CODE,
            utcDate: toUtcDateOnly(day.date),
            currencyCode: "USD",
            adRevenue: day.adRevenue,
            impressions: 900,
            adRequests: 1100,
          },
          update: { adRevenue: day.adRevenue },
        });
      }

      if (day.fx !== null) {
        await testPrisma.fxRate.upsert({
          where: { date: toUtcDateOnly(day.date) },
          create: { date: toUtcDateOnly(day.date), usdBrl: day.fx },
          update: { usdBrl: day.fx },
        });
      }
    }

    // Receita que existe no GAM mas não tem SiteMapping nenhum -- não
    // pode aparecer em relatório de site nenhum.
    await testPrisma.gamAdMetric.upsert({
      where: {
        gamMetricNaturalKey: { siteCode: ORPHAN_SITE_CODE, utcDate: toUtcDateOnly("2030-01-01") },
      },
      create: {
        networkCode: "vitest-network",
        siteCode: ORPHAN_SITE_CODE,
        utcDate: toUtcDateOnly("2030-01-01"),
        currencyCode: "USD",
        adRevenue: 999,
        impressions: 100,
        adRequests: 150,
      },
      update: { adRevenue: 999 },
    });
  });

  afterAll(async () => {
    await testPrisma.facebookAdMetric.deleteMany({ where: { siteRef: SITE_REF } });
    await testPrisma.gamAdMetric.deleteMany({ where: { siteCode: { in: [SITE_CODE, ORPHAN_SITE_CODE] } } });
    await testPrisma.fxRate.deleteMany({
      where: { date: { in: DAYS.filter((d) => d.fx !== null).map((d) => toUtcDateOnly(d.date)) } },
    });
    await testPrisma.siteMapping.deleteMany({ where: { facebookSiteRef: SITE_REF } });
    await testPrisma.$disconnect();
  });

  it("agrega o período inteiro batendo com a conta feita à mão (Decimal em Python, à parte)", async () => {
    const [entry] = await service.getReport("2030-01-01", "2030-01-05", SITE_REF);

    expect(entry).toBeDefined();
    expect(entry.siteRef).toBe(SITE_REF);
    expect(entry.siteCode).toBe(SITE_CODE);
    expect(entry.displayName).toBe("Vitest Reports Site");
    expect(entry.currency).toBe("BRL");
    expect(entry.impressions).toBe(5000);
    expect(entry.clicks).toBe(250);
    expect(entry.ctr).toBeCloseTo(0.05, 6);
    expect(entry.mediaCostLocal).toBe(600);
    expect(entry.mediaCostWithTaxLocal).toBe(612);
    expect(entry.grossRevenueUsd).toBe(190);
    expect(entry.netRevenueLocal).toBe(656.03);
    expect(entry.profitLocal).toBe(44.03);
    expect(entry.cpa).toBe(2.45);
    // 1.0719 é o roas recalculado sobre os totais do período. A média dos
    // 5 roas diários dá 1.0702 -- um número diferente. Se esse teste
    // passar com 1.0702 em vez de 1.0719, é sinal de que a implementação
    // trocou pra média das razões diárias em vez de recalcular no total.
    expect(entry.roas).toBe(1.0719);
  });

  it("siteRef que não existe devolve array vazio", async () => {
    const result = await service.getReport("2030-01-01", "2030-01-05", "vitest-does-not-exist");
    expect(result).toEqual([]);
  });

  it("receita do GAM sem SiteMapping (site órfão) nunca aparece em nenhuma linha do relatório", async () => {
    const result = await service.getReport("2030-01-01", "2030-01-05");
    expect(result.some((r) => r.siteCode === ORPHAN_SITE_CODE)).toBe(false);
  });
});
