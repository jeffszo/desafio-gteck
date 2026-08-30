import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { enumerateDays, formatUtcDateOnly, toUtcDateOnly } from "../common/date.util";
import { MetricSource, type GapReport } from "./reconciliation.types";

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async findGaps(from: string, to: string): Promise<GapReport[]> {
    const sites = await this.prisma.siteMapping.findMany();
    if (sites.length === 0) {
      return [];
    }

    const fromDate = toUtcDateOnly(from);
    const toDate = toUtcDateOnly(to);
    const days = enumerateDays(from, to);

    const [fbRows, gamRows] = await Promise.all([
      this.prisma.facebookAdMetric.groupBy({
        by: ["siteRef", "localDate"],
        where: {
          siteRef: { in: sites.map((site) => site.facebookSiteRef) },
          localDate: { gte: fromDate, lte: toDate },
        },
      }),
      this.prisma.gamAdMetric.groupBy({
        by: ["siteCode", "utcDate"],
        where: {
          siteCode: { in: sites.map((site) => site.gamSiteCode) },
          utcDate: { gte: fromDate, lte: toDate },
        },
      }),
    ]);

    const fbPresent = new Set(fbRows.map((row) => `${row.siteRef}|${formatUtcDateOnly(row.localDate)}`));
    const gamPresent = new Set(gamRows.map((row) => `${row.siteCode}|${formatUtcDateOnly(row.utcDate)}`));

    const gaps: GapReport[] = [];
    for (const site of sites) {
      for (const day of days) {
  
        if (!fbPresent.has(`${site.facebookSiteRef}|${day}`)) {
          gaps.push({ source: MetricSource.Facebook, site: site.facebookSiteRef, date: day });
        }
        if (!gamPresent.has(`${site.gamSiteCode}|${day}`)) {
          gaps.push({ source: MetricSource.Gam, site: site.gamSiteCode, date: day });
        }
      }
    }

    return gaps;
  }
}
