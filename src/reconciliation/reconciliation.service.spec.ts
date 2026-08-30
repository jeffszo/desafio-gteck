import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ReconciliationService } from "./reconciliation.service";
import { testPrisma } from "../test/prisma-test-client";
import { toUtcDateOnly } from "../common/date.util";
import { MetricSource } from "./reconciliation.types";

const SITE_REF = "vitest-recon-site";
const SITE_CODE = "VITEST_RECON_SITE";


const FB_DATES = ["2030-03-01", "2030-03-02", "2030-03-04", "2030-03-05"];
const GAM_DATES = ["2030-03-01", "2030-03-03", "2030-03-05"];

describe("ReconciliationService#findGaps", () => {
  const service = new ReconciliationService(testPrisma);

  beforeAll(async () => {
    await testPrisma.$connect();

    await testPrisma.siteMapping.upsert({
      where: { facebookSiteRef: SITE_REF },
      create: {
        facebookSiteRef: SITE_REF,
        gamSiteCode: SITE_CODE,
        displayName: "Vitest Reconciliation Site",
        revSharePct: 0.3,
        taxOnRevenuePct: 0.05,
        taxOnMediaCostPct: 0.02,
      },
      update: {},
    });

    for (const date of FB_DATES) {
      await testPrisma.facebookAdMetric.upsert({
        where: { facebookMetricNaturalKey: { externalCampaignId: `vitest-recon-camp-${date}`, localDate: toUtcDateOnly(date) } },
        create: {
          externalCampaignId: `vitest-recon-camp-${date}`,
          campaignName: "Vitest Recon Campaign",
          siteRef: SITE_REF,
          localDate: toUtcDateOnly(date),
          accountTimezone: "America/Sao_Paulo",
          accountCurrency: "BRL",
          spend: 100,
          impressions: 1000,
          clicks: 50,
        },
        update: {},
      });
    }

    for (const date of GAM_DATES) {
      await testPrisma.gamAdMetric.upsert({
        where: { gamMetricNaturalKey: { siteCode: SITE_CODE, utcDate: toUtcDateOnly(date) } },
        create: {
          networkCode: "vitest-network",
          siteCode: SITE_CODE,
          utcDate: toUtcDateOnly(date),
          currencyCode: "USD",
          adRevenue: 40,
          impressions: 900,
          adRequests: 1100,
        },
        update: {},
      });
    }
  });

  afterAll(async () => {
    await testPrisma.facebookAdMetric.deleteMany({ where: { siteRef: SITE_REF } });
    await testPrisma.gamAdMetric.deleteMany({ where: { siteCode: SITE_CODE } });
    await testPrisma.siteMapping.deleteMany({ where: { facebookSiteRef: SITE_REF } });
    await testPrisma.$disconnect();
  });

  it("acha exatamente os gaps esperados, um item por (fonte, dia), sem falso positivo", async () => {
    const gaps = await service.findGaps("2030-03-01", "2030-03-05");


    const fbGaps = gaps.filter((gap) => gap.source === MetricSource.Facebook && gap.site === SITE_REF);
    const gamGaps = gaps
      .filter((gap) => gap.source === MetricSource.Gam && gap.site === SITE_CODE)
      .sort((a, b) => a.date.localeCompare(b.date));

    expect(fbGaps).toEqual([{ source: MetricSource.Facebook, site: SITE_REF, date: "2030-03-03" }]);
    expect(gamGaps).toEqual([
      { source: MetricSource.Gam, site: SITE_CODE, date: "2030-03-02" },
      { source: MetricSource.Gam, site: SITE_CODE, date: "2030-03-04" },
    ]);
  });

  it("um site com as duas fontes completas no período não aparece como gap", async () => {
    const gaps = await service.findGaps("2030-03-01", "2030-03-01");
    const myGaps = gaps.filter((gap) => gap.site === SITE_REF || gap.site === SITE_CODE);

    expect(myGaps).toEqual([]);
  });

  it("sem nenhum site em SiteMapping, devolve [] sem consultar as tabelas de métrica", async () => {
    const findManySpy = vi.spyOn(testPrisma.siteMapping, "findMany").mockResolvedValueOnce([]);
    const groupBySpy = vi.spyOn(testPrisma.facebookAdMetric, "groupBy");

    const gaps = await service.findGaps("2030-03-01", "2030-03-05");

    expect(gaps).toEqual([]);
    expect(groupBySpy).not.toHaveBeenCalled();

    findManySpy.mockRestore();
    groupBySpy.mockRestore();
  });
});
