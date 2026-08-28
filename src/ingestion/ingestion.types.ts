export interface FacebookMetricInput {
  externalCampaignId: string;
  campaignName: string;
  siteRef: string;
  localDate: string;
  accountTimezone: string;
  accountCurrency: string;
  spend: number;
  impressions: number;
  clicks: number;
}

export interface GamMetricInput {
  networkCode: string;
  siteCode: string;
  utcDate: string;
  currencyCode: string;
  adRevenue: number;
  impressions: number;
  adRequests: number;
}
