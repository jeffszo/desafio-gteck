import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { IngestionService } from "./ingestion.service";
import { testPrisma } from "../test/prisma-test-client";
import { toUtcDateOnly } from "../common/date.util";


const CAMPAIGN_PREFIX = "vitest-ingestion";
const SITE_CODE_PREFIX = "VITEST_INGESTION";

describe("IngestionService#processMetrics", () => {
  const service = new IngestionService(testPrisma);

  beforeAll(async () => {
    await testPrisma.$connect();
  });

  afterAll(async () => {
    await testPrisma.facebookAdMetric.deleteMany({
      where: { externalCampaignId: { startsWith: CAMPAIGN_PREFIX } },
    });
    await testPrisma.gamAdMetric.deleteMany({
      where: { siteCode: { startsWith: SITE_CODE_PREFIX } },
    });
    await testPrisma.$disconnect();
  });

  it("persiste uma linha nova de facebook e uma de gam", async () => {
    await service.processMetrics(
      [
        {
          externalCampaignId: `${CAMPAIGN_PREFIX}-basic`,
          campaignName: "Vitest Basic",
          siteRef: "vitest-site-basic",
          localDate: "2030-02-01",
          accountTimezone: "America/Sao_Paulo",
          accountCurrency: "BRL",
          spend: 100,
          impressions: 1000,
          clicks: 50,
        },
      ],
      [
        {
          networkCode: "vitest-network",
          siteCode: `${SITE_CODE_PREFIX}_BASIC`,
          utcDate: "2030-02-01",
          currencyCode: "USD",
          adRevenue: 40,
          impressions: 900,
          adRequests: 1200,
        },
      ],
    );

    const fbRow = await testPrisma.facebookAdMetric.findUnique({
      where: {
        facebookMetricNaturalKey: {
          externalCampaignId: `${CAMPAIGN_PREFIX}-basic`,
          localDate: toUtcDateOnly("2030-02-01"),
        },
      },
    });
    const gamRow = await testPrisma.gamAdMetric.findUnique({
      where: {
        gamMetricNaturalKey: {
          siteCode: `${SITE_CODE_PREFIX}_BASIC`,
          utcDate: toUtcDateOnly("2030-02-01"),
        },
      },
    });

    expect(fbRow?.spend.toNumber()).toBe(100);
    expect(gamRow?.adRevenue.toNumber()).toBe(40);
  });

  it("reenviar o mesmo payload do facebook duas vezes não duplica a linha", async () => {
    const payload = {
      externalCampaignId: `${CAMPAIGN_PREFIX}-resend`,
      campaignName: "Vitest Resend",
      siteRef: "vitest-site-resend",
      localDate: "2030-02-02",
      accountTimezone: "America/Sao_Paulo",
      accountCurrency: "BRL",
      spend: 200,
      impressions: 2000,
      clicks: 100,
    };


    await service.processMetrics([payload], []);
    await service.processMetrics([payload], []);

    const rows = await testPrisma.facebookAdMetric.findMany({
      where: { externalCampaignId: `${CAMPAIGN_PREFIX}-resend` },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].spend.toNumber()).toBe(200);
  });

  it("reenvio com valor diferente atualiza a linha (last-write-wins), sem criar uma segunda", async () => {
    const base = {
      externalCampaignId: `${CAMPAIGN_PREFIX}-update`,
      campaignName: "Vitest Update",
      siteRef: "vitest-site-update",
      localDate: "2030-02-03",
      accountTimezone: "America/Sao_Paulo",
      accountCurrency: "BRL",
      impressions: 1000,
      clicks: 50,
    };

    await service.processMetrics([{ ...base, spend: 100 }], []);
    await service.processMetrics([{ ...base, spend: 150 }], []); // "correção" da rede de anúncios

    const rows = await testPrisma.facebookAdMetric.findMany({
      where: { externalCampaignId: `${CAMPAIGN_PREFIX}-update` },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].spend.toNumber()).toBe(150);
  });

  it("a mesma idempotência vale pro GAM, pela chave siteCode + utcDate", async () => {
    const payload = {
      networkCode: "vitest-network",
      siteCode: `${SITE_CODE_PREFIX}_GAM_RESEND`,
      utcDate: "2030-02-04",
      currencyCode: "USD",
      adRevenue: 30,
      impressions: 500,
      adRequests: 700,
    };

    await service.processMetrics([], [payload]);
    await service.processMetrics([], [payload]);

    const rows = await testPrisma.gamAdMetric.findMany({
      where: { siteCode: `${SITE_CODE_PREFIX}_GAM_RESEND` },
    });

    expect(rows).toHaveLength(1);
  });

  it("array vazio de uma fonte não apaga nem altera o que já existe da outra", async () => {
    await service.processMetrics(
      [],
      [
        {
          networkCode: "vitest-network",
          siteCode: `${SITE_CODE_PREFIX}_UNTOUCHED`,
          utcDate: "2030-02-05",
          currencyCode: "USD",
          adRevenue: 77,
          impressions: 300,
          adRequests: 400,
        },
      ],
    );

    await service.processMetrics([], []);

    const gamRow = await testPrisma.gamAdMetric.findUnique({
      where: {
        gamMetricNaturalKey: {
          siteCode: `${SITE_CODE_PREFIX}_UNTOUCHED`,
          utcDate: toUtcDateOnly("2030-02-05"),
        },
      },
    });

    expect(gamRow?.adRevenue.toNumber()).toBe(77);
  });

  it("payload com os dois arrays vazios não lança erro (é um no-op de verdade)", async () => {
    await expect(service.processMetrics([], [])).resolves.toBeUndefined();
  });

  it("loga um aviso quando o reenvio chega com valor diferente do já persistido", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    const base = {
      externalCampaignId: `${CAMPAIGN_PREFIX}-divergence`,
      campaignName: "Vitest Divergence",
      siteRef: "vitest-site-divergence",
      localDate: "2030-02-06",
      accountTimezone: "America/Sao_Paulo",
      accountCurrency: "BRL",
      impressions: 1000,
      clicks: 50,
    };

    await service.processMetrics([{ ...base, spend: 100 }], []);
    warnSpy.mockClear(); // a primeira inserção não é reenvio, não deveria logar nada

    await service.processMetrics([{ ...base, spend: 999 }], []);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("valor diferente"));

    warnSpy.mockRestore();
  });
});
