import { MetricSource } from "../reconciliation.types";


export class GapReportOutputDto {
  source: MetricSource;
  site: string;
  date: string;
}
