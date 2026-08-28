import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { IngestMetricsInputDto } from "./dto/ingest-metrics.input.dto";
import { IngestionService } from "./ingestion.service";

// Wiring pronto: valida o payload (ValidationPipe global) e delega pro
// service. A lógica de negócio fica em IngestionService#processMetrics.
@Controller("ingestion")
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(@Body() dto: IngestMetricsInputDto): Promise<void> {
    await this.ingestionService.processMetrics(dto.facebook, dto.gam);
  }
}
