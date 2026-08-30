export enum MetricSource {
  Facebook = "facebook",
  Gam = "gam",
}

export interface GapReport {
  source: MetricSource;
  site: string;
  date: string;
}
