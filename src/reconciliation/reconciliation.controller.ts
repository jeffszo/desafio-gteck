import { Controller, Get, Query } from "@nestjs/common";
import { GapReportQueryInputDto } from "./dto/gap-report-query.input.dto";
import { GapReportOutputDto } from "./dto/gap-report.output.dto";
import { ReconciliationService } from "./reconciliation.service";

@Controller("reconciliation")
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get("gaps")
  async getGaps(@Query() query: GapReportQueryInputDto): Promise<GapReportOutputDto[]> {
    return this.reconciliationService.findGaps(query.from, query.to);
  }
}
