import { Controller, Get, Query } from "@nestjs/common";
import { ReportQueryInputDto } from "./dto/report.input.dto";
import { SiteReportOutputDto } from "./dto/report.output.dto";
import { ReportsService } from "./reports.service";

// Wiring pronto: valida a query (ValidationPipe global) e delega pro
// service. A lógica de negócio fica em ReportsService#getReport.
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  async getReport(@Query() query: ReportQueryInputDto): Promise<SiteReportOutputDto[]> {
    return this.reportsService.getReport(query.from, query.to, query.siteRef);
  }
}
