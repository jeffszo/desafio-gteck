import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReportsService } from "./reports.service";
import { MoneyService } from "../money/money.service";
import { testPrisma } from "../test/prisma-test-client";
import { toUtcDateOnly } from "../common/date.util";

const SITE_REF = "vitest-reports-site";
const SITE_CODE = "VITEST_REPORTS_SITE";
const ORPHAN_SITE_CODE = "VITEST_REPORTS_ORPHAN";


const DAYS = [
  { date: "2030-01-01", spend: 100, adRevenue: 40, fx: 5.0 },
  { date: "2030-01-02", spend: 110, adRevenue: 45, fx: 5.1 },
  { date: "2030-01-03", spend: 120, adRevenue: null, fx: 5.2 }, 
  { date: "2030-01-04", spend: 130, adRevenue: 50, fx: null }, 
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

  it("agrega o período inteiro batendo com a conta feita à mão", async () => {
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
