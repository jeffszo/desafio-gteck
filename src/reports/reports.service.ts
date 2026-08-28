import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MoneyService } from "../money/money.service";
import type { SiteReportEntry } from "./reports.types";

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moneyService: MoneyService,
  ) {}

  async getReport(
    from: string,
    to: string,
    siteRef?: string,
  ): Promise<SiteReportEntry[]> {
    // Una FacebookAdMetric e GamAdMetric por site (via SiteMapping), calcule
    // as métricas derivadas chamando MoneyService.calculate, e filtre pelo
    // período (from/to) e opcionalmente por siteRef. Os dados seedados têm
    // inconsistências propositais, trate-as de forma explícita e
    // documentada no DECISIONS.md, não silenciosamente.
    throw new Error("not implemented");
  }
}
