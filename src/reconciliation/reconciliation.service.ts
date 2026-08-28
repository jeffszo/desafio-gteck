import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { GapReport } from "./reconciliation.types";

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async findGaps(from: string, to: string): Promise<GapReport[]> {
    // Para cada site em SiteMapping, percorra o período [from, to] e
    // identifique dias sem nenhuma linha em FacebookAdMetric (por siteRef)
    // ou em GamAdMetric (por siteCode). É uma varredura de série temporal,
    // não tenta "corrigir" nada (o modelo é push via webhook, não tem de
    // onde puxar de novo), só sinaliza.
    throw new Error("not implemented");
  }
}
