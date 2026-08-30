import { Controller, Get, Query } from "@nestjs/common";
import { ReportQueryInputDto } from "./dto/report.input.dto";
import { SiteReportOutputDto } from "./dto/report.output.dto";
import { ReportsService } from "./reports.service";


@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  async getReport(@Query() query: ReportQueryInputDto): Promise<SiteReportOutputDto[]> {
    return this.reportsService.getReport(query.from, query.to, query.siteRef);
  }
}
