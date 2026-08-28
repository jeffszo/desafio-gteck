export enum MetricSource {
  Facebook = "facebook",
  Gam = "gam",
}

export interface GapReport {
  source: MetricSource;

  // facebookSiteRef (se source === MetricSource.Facebook) ou gamSiteCode
  // (se source === MetricSource.Gam).
  site: string;

  // Dia sem dado, formato YYYY-MM-DD.
  date: string;
}
