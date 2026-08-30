import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { formatUtcDateOnly, toUtcDateOnly } from "../common/date.util";
import type { FacebookMetricInput, GamMetricInput } from "./ingestion.types";

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // facebook/gam vazios ([]) não fazem nada com a outra fonte -- o loop
  // abaixo simplesmente não gera operação nenhuma pra fonte que veio
  // vazia, então uma linha já persistida nunca é tocada por um payload
  // que não fala dela.
  //
  // Idempotência: upsert pela chave natural de cada tabela
  // (externalCampaignId+localDate no Facebook, siteCode+utcDate no GAM,
  // ambas agora @@unique no schema -- ver a migration
  // 20260830140000_ingestion_idempotency_keys). Reenviar o mesmo payload
  // vira upsert com os mesmos valores, ou seja, um no-op de fato. Um
  // reenvio com valor diferente do já persistido é tratado como
  // last-write-wins (a linha é atualizada) -- não tem no payload nenhum
  // jeito de distinguir "correção legítima da rede de anúncios" de "dado
  // pior", e ignorar reenvios divergentes esconderia correções reais. Ver
  // DECISIONS.md, seção 3.
  async processMetrics(
    facebook: FacebookMetricInput[],
    gam: GamMetricInput[],
  ): Promise<void> {
    // Log de observabilidade, não afeta o que é persistido: antes de
    // escrever, compara contra o que já existe e avisa quando um reenvio
    // muda um valor que já estava salvo. É a decisão da seção 3 do
    // DECISIONS.md ficando visível em produção, não só documentada.
    await this.logDivergentResends(facebook, gam);

    const operations = [
      ...facebook.map((row) => this.upsertFacebookRow(row)),
      ...gam.map((row) => this.upsertGamRow(row)),
    ];

    if (operations.length === 0) {
      return;
    }

    // Um único payload vira uma única transação: se uma linha falhar no
    // meio, nenhuma linha desse webhook fica meio-persistida.
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
