import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma-client";
import { PrismaService } from "../prisma/prisma.service";
import { MoneyService } from "../money/money.service";
import { enumerateDays, formatUtcDateOnly, toUtcDateOnly } from "../common/date.util";
import type { SiteReportEntry } from "./reports.types";

interface DayTotals {
  impressions: number;
  clicks: number;
  mediaCostLocal: Prisma.Decimal;
  mediaCostWithTaxLocal: Prisma.Decimal;
  grossRevenueUsd: Prisma.Decimal;
  netRevenueLocal: Prisma.Decimal;
  profitLocal: Prisma.Decimal;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moneyService: MoneyService,
  ) {}

  async getReport(
    from: string,
    to: string,
    siteRef?: string,
  ): Promise<SiteReportEntry[]> {
    // Sempre partimos de SiteMapping. Se siteRef não bater com nenhum site
    // conhecido, devolvemos [] direto, sem tocar em FacebookAdMetric/
    // GamAdMetric -- e um GamAdMetric órfão (sem SiteMapping, caso do
    // PROMOSAUDE_MAIN no seed) nunca entra no relatório por essa mesma
    // razão: ele simplesmente nunca é alcançado a partir daqui.
    const sites = await this.prisma.siteMapping.findMany({
      where: siteRef ? { facebookSiteRef: siteRef } : undefined,
    });

    if (sites.length === 0) {
      return [];
    }

    const fromDate = toUtcDateOnly(from);
    const toDate = toUtcDateOnly(to);
    const days = enumerateDays(from, to);
    const siteRefs = sites.map((site) => site.facebookSiteRef);
    const siteCodes = sites.map((site) => site.gamSiteCode);

    // 3 queries agregadas no banco pro período inteiro (uma por fonte +
    // uma de câmbio), nunca uma query por site ou por dia -- isso é o que
    // evita N+1 aqui.
    const [fbRows, gamRows, currencyRows, fxRows] = await Promise.all([
      this.prisma.facebookAdMetric.groupBy({
        by: ["siteRef", "localDate"],
        where: { siteRef: { in: siteRefs }, localDate: { gte: fromDate, lte: toDate } },
        _sum: { spend: true, impressions: true, clicks: true },
      }),
      this.prisma.gamAdMetric.groupBy({
        by: ["siteCode", "utcDate"],
        where: { siteCode: { in: siteCodes }, utcDate: { gte: fromDate, lte: toDate } },
        _sum: { adRevenue: true },
      }),
      // A moeda de cada site vem de FacebookAdMetric.accountCurrency, não
      // de SiteMapping. Pegamos aqui fora do filtro de período, porque a
      // moeda é constante no tempo -- um site sem nenhuma linha de FB
      // dentro do período informado (mas com histórico fora dele) ainda
      // deveria saber sua própria moeda.
      this.prisma.facebookAdMetric.findMany({
        where: { siteRef: { in: siteRefs } },
        distinct: ["siteRef"],
        select: { siteRef: true, accountCurrency: true },
      }),
      // Sem limite inferior: pra fazer carry-forward do câmbio no
      // primeiro dia do período que porventura não tenha cotação, a gente
      // precisa poder olhar pra trás do "from".
      this.prisma.fxRate.findMany({
        where: { date: { lte: toDate } },
        orderBy: { date: "asc" },
      }),
    ]);

    const fbBySiteDay = new Map<string, { spend: Prisma.Decimal; impressions: number; clicks: number }>();
    for (const row of fbRows) {
      fbBySiteDay.set(`${row.siteRef}|${formatUtcDateOnly(row.localDate)}`, {
        spend: row._sum.spend ?? new Prisma.Decimal(0),
        impressions: row._sum.impressions ?? 0,
        clicks: row._sum.clicks ?? 0,
      });
    }

    const gamBySiteDay = new Map<string, Prisma.Decimal>();
    for (const row of gamRows) {
      gamBySiteDay.set(`${row.siteCode}|${formatUtcDateOnly(row.utcDate)}`, row._sum.adRevenue ?? new Prisma.Decimal(0));
    }

    const currencyBySite = new Map<string, string>();
    for (const row of currencyRows) {
      currencyBySite.set(row.siteRef, row.accountCurrency);
    }

    // Lista ordenada de (data, cotação) só com os dias que realmente têm
    // FxRate -- serve pra achar "a última cotação conhecida antes ou no
    // dia X" com uma busca simples, sem query por dia.
    const fxKnown = fxRows.map((row) => ({
      date: formatUtcDateOnly(row.date),
      usdBrl: row.usdBrl,
    }));

    const findFxRate = (day: string): Prisma.Decimal | null => {
      let latest: Prisma.Decimal | null = null;
      for (const entry of fxKnown) {
        if (entry.date > day) break;
        latest = entry.usdBrl;
      }
      return latest;
    };

    const entries: SiteReportEntry[] = sites.map((site) => {
      const currency = currencyBySite.get(site.facebookSiteRef) ?? "USD";
      const totals: DayTotals = {
        impressions: 0,
        clicks: 0,
        mediaCostLocal: new Prisma.Decimal(0),
        mediaCostWithTaxLocal: new Prisma.Decimal(0),
        grossRevenueUsd: new Prisma.Decimal(0),
        netRevenueLocal: new Prisma.Decimal(0),
        profitLocal: new Prisma.Decimal(0),
      };

      for (const day of days) {
        const fb = fbBySiteDay.get(`${site.facebookSiteRef}|${day}`);
        const gamRevenue = gamBySiteDay.get(`${site.gamSiteCode}|${day}`) ?? new Prisma.Decimal(0);

        // Sem linha de FB nesse dia = sem gasto de mídia nesse dia (dia
        // realmente vazio, ok). Sem linha de GAM nesse dia com FB
        // presente = gastou mídia e não teve receita GAM registrada
        // (caso do FITPRO_MAIN, 07-15 a 07-19) -- entra como receita 0
        // nesse dia, não é um dia pra pular.
        const mediaCostLocal = fb?.spend ?? new Prisma.Decimal(0);

        let fxRate: Prisma.Decimal;
        if (currency === "USD") {
          fxRate = new Prisma.Decimal(1);
        } else {
          const known = findFxRate(day);
          if (known) {
            fxRate = known;
          } else {
            // Não achou nenhuma cotação conhecida em ou antes desse dia
            // (não acontece no seed atual, mas pode acontecer se o
            // período pedido começar antes de qualquer FxRate existir).
            // Não falhamos o request inteiro por isso: só não convertemos
            // a receita desse dia específico, e avisamos no log.
            this.logger.warn(
              `Sem cotação FX conhecida em ou antes de ${day} para converter a receita de ${site.displayName}; receita local desse dia ficará zerada.`,
            );
            fxRate = new Prisma.Decimal(0);
          }
        }

        const dayResult = this.moneyService.calculate({
          grossRevenueUsd: gamRevenue.toNumber(),
          revSharePct: site.revSharePct.toNumber(),
          taxOnRevenuePct: site.taxOnRevenuePct.toNumber(),
          fxRate: fxRate.toNumber(),
          mediaCostLocal: mediaCostLocal.toNumber(),
          taxOnMediaCostPct: site.taxOnMediaCostPct.toNumber(),
        });

        // MoneyService já devolveu tudo arredondado; somamos em Decimal
        // pra não reintroduzir ponto flutuante binário nessa soma de ~30
        // valores por site.
        totals.impressions += fb?.impressions ?? 0;
        totals.clicks += fb?.clicks ?? 0;
        totals.mediaCostLocal = totals.mediaCostLocal.plus(mediaCostLocal);
        totals.mediaCostWithTaxLocal = totals.mediaCostWithTaxLocal.plus(dayResult.mediaCostWithTaxLocal);
        totals.grossRevenueUsd = totals.grossRevenueUsd.plus(gamRevenue);
        totals.netRevenueLocal = totals.netRevenueLocal.plus(dayResult.netRevenueLocal);
        totals.profitLocal = totals.profitLocal.plus(dayResult.profitLocal);
      }

      // roas/ctr/cpa do período são recalculados sobre os totais, nunca
      // como média dos valores diários -- README também aponta isso
      // ("some os valores... antes de consolidar"). cpa aqui é custo por
      // clique, definição explícita do desafio (schema não tem campo de
      // conversão).
      const roas = totals.mediaCostWithTaxLocal.isZero()
        ? 0
        : totals.netRevenueLocal.dividedBy(totals.mediaCostWithTaxLocal).toDecimalPlaces(4).toNumber();
      const ctr = totals.impressions === 0 ? 0 : totals.clicks / totals.impressions;
      const cpa = totals.clicks === 0 ? 0 : totals.mediaCostWithTaxLocal.dividedBy(totals.clicks).toDecimalPlaces(2).toNumber();

      return {
        siteRef: site.facebookSiteRef,
        siteCode: site.gamSiteCode,
        displayName: site.displayName,
        currency,
        impressions: totals.impressions,
        clicks: totals.clicks,
        ctr,
        cpa,
        mediaCostLocal: totals.mediaCostLocal.toDecimalPlaces(2).toNumber(),
        mediaCostWithTaxLocal: totals.mediaCostWithTaxLocal.toDecimalPlaces(2).toNumber(),
        grossRevenueUsd: totals.grossRevenueUsd.toDecimalPlaces(2).toNumber(),
        netRevenueLocal: totals.netRevenueLocal.toDecimalPlaces(2).toNumber(),
        profitLocal: totals.profitLocal.toDecimalPlaces(2).toNumber(),
        roas,
      };
    });

    return entries;
  }
}
