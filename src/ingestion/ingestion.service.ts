import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { formatUtcDateOnly, toUtcDateOnly } from "../common/date.util";
import type { FacebookMetricInput, GamMetricInput } from "./ingestion.types";

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  
  async processMetrics(
    facebook: FacebookMetricInput[],
    gam: GamMetricInput[],
  ): Promise<void> {
 
    await this.logDivergentResends(facebook, gam);

    const operations = [
      ...facebook.map((row) => this.upsertFacebookRow(row)),
      ...gam.map((row) => this.upsertGamRow(row)),
    ];

    if (operations.length === 0) {
      return;
    }

 
    await this.prisma.$transaction(operations);
  }

  private async logDivergentResends(
    facebook: FacebookMetricInput[],
    gam: GamMetricInput[],
  ): Promise<void> {
    if (facebook.length > 0) {
      const existingRows = await this.prisma.facebookAdMetric.findMany({
        where: {
          OR: facebook.map((row) => ({
            externalCampaignId: row.externalCampaignId,
            localDate: toUtcDateOnly(row.localDate),
          })),
        },
      });
      const existingByKey = new Map(
        existingRows.map((existing) => [
          `${existing.externalCampaignId}|${formatUtcDateOnly(existing.localDate)}`,
          existing,
        ]),
      );

      for (const row of facebook) {
        const key = `${row.externalCampaignId}|${formatUtcDateOnly(toUtcDateOnly(row.localDate))}`;
        const previous = existingByKey.get(key);
        const spendChanged = previous && previous.spend.toNumber() !== row.spend;
        const impressionsChanged = previous && previous.impressions !== row.impressions;
        const clicksChanged = previous && previous.clicks !== row.clicks;

        if (previous && (spendChanged || impressionsChanged || clicksChanged)) {
          this.logger.warn(
            `Reenvio de ${row.externalCampaignId} em ${key.split("|")[1]} chegou com valor diferente do já ` +
              `persistido -- aplicando last-write-wins. spend: ${previous.spend.toNumber()} -> ${row.spend}, ` +
              `impressions: ${previous.impressions} -> ${row.impressions}, clicks: ${previous.clicks} -> ${row.clicks}`,
          );
        }
      }
    }

    if (gam.length > 0) {
      const existingRows = await this.prisma.gamAdMetric.findMany({
        where: {
          OR: gam.map((row) => ({
            siteCode: row.siteCode,
            utcDate: toUtcDateOnly(row.utcDate),
          })),
        },
      });
      const existingByKey = new Map(
        existingRows.map((existing) => [
          `${existing.siteCode}|${formatUtcDateOnly(existing.utcDate)}`,
          existing,
        ]),
      );

      for (const row of gam) {
        const key = `${row.siteCode}|${formatUtcDateOnly(toUtcDateOnly(row.utcDate))}`;
        const previous = existingByKey.get(key);
        const revenueChanged = previous && previous.adRevenue.toNumber() !== row.adRevenue;
        const impressionsChanged = previous && previous.impressions !== row.impressions;

        if (previous && (revenueChanged || impressionsChanged)) {
          this.logger.warn(
            `Reenvio de ${row.siteCode} em ${key.split("|")[1]} chegou com valor diferente do já persistido ` +
              `-- aplicando last-write-wins. adRevenue: ${previous.adRevenue.toNumber()} -> ${row.adRevenue}, ` +
              `impressions: ${previous.impressions} -> ${row.impressions}`,
          );
        }
      }
    }
  }

  private upsertFacebookRow(row: FacebookMetricInput) {
    const localDate = toUtcDateOnly(row.localDate);

    return this.prisma.facebookAdMetric.upsert({
      where: {
        facebookMetricNaturalKey: {
          externalCampaignId: row.externalCampaignId,
          localDate,
        },
      },
      create: {
        externalCampaignId: row.externalCampaignId,
        campaignName: row.campaignName,
        siteRef: row.siteRef,
        localDate,
        accountTimezone: row.accountTimezone,
        accountCurrency: row.accountCurrency,
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
      },
      update: {
        campaignName: row.campaignName,
        siteRef: row.siteRef,
        accountTimezone: row.accountTimezone,
        accountCurrency: row.accountCurrency,
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
      },
    });
  }

  private upsertGamRow(row: GamMetricInput) {
    const utcDate = toUtcDateOnly(row.utcDate);

    return this.prisma.gamAdMetric.upsert({
      where: {
        gamMetricNaturalKey: {
          siteCode: row.siteCode,
          utcDate,
        },
      },
      create: {
        networkCode: row.networkCode,
        siteCode: row.siteCode,
        utcDate,
        currencyCode: row.currencyCode,
        adRevenue: row.adRevenue,
        impressions: row.impressions,
        adRequests: row.adRequests,
      },
      update: {
        networkCode: row.networkCode,
        currencyCode: row.currencyCode,
        adRevenue: row.adRevenue,
        impressions: row.impressions,
        adRequests: row.adRequests,
      },
    });
  }
}
