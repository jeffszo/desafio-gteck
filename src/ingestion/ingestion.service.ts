import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { FacebookMetricInput, GamMetricInput } from "./ingestion.types";

@Injectable()
export class IngestionService {
  constructor(private readonly prisma: PrismaService) {}

  async processMetrics(
    facebook: FacebookMetricInput[],
    gam: GamMetricInput[],
  ): Promise<void> {
    // Persista facebook em FacebookAdMetric e gam em GamAdMetric.
    // Reprocessar o mesmo payload (mesmo webhook reenviado) não pode
    // duplicar linha nem piorar um dado que já estava bom. Arrays vazios
    // significam "a fonte não tinha dado esse dia", não é pra apagar dado
    // bom já persistido. Ver "Ingestão via webhook" no README.
    throw new Error("not implemented");
  }
}
