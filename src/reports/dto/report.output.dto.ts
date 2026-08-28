// Uma linha do relatório consolidado, uma por site no período filtrado.
// cpa aqui é custo por clique (mediaCostWithTaxLocal / clicks), usado como
// proxy de "ação", o schema não tem campo de conversão. Ver README.
export class SiteReportOutputDto {
  // facebookSiteRef do site (chave usada nos filtros da query).
  siteRef: string;

  // gamSiteCode do site.
  siteCode: string;

  // Nome amigável do site (SiteMapping.displayName).
  displayName: string;

  // Moeda local do site (BRL ou USD).
  currency: string;

  // Soma de impressões do Facebook no período.
  impressions: number;

  // Soma de cliques do Facebook no período.
  clicks: number;

  // clicks / impressions.
  ctr: number;

  // mediaCostWithTaxLocal / clicks.
  cpa: number;

  // Soma do custo de mídia (Facebook spend) no período, na moeda do site.
  mediaCostLocal: number;

  // mediaCostLocal com o tributo sobre mídia aplicado.
  mediaCostWithTaxLocal: number;

  // Soma da receita bruta do GAM no período, sempre em USD.
  grossRevenueUsd: number;

  // Receita líquida (pós revShare, pós tributo, convertida pra moeda local).
  netRevenueLocal: number;

  // netRevenueLocal - mediaCostWithTaxLocal.
  profitLocal: number;

  // netRevenueLocal / mediaCostWithTaxLocal.
  roas: number;
}
