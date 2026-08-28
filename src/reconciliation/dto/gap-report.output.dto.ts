import { MetricSource } from "../reconciliation.types";

// Um gap encontrado: uma das duas fontes sem nenhuma linha num site/dia
// dentro da janela verificada.
export class GapReportOutputDto {
  // Qual fonte está faltando o dado.
  source: MetricSource;

  // facebookSiteRef (se source === MetricSource.Facebook) ou gamSiteCode
  // (se source === MetricSource.Gam).
  site: string;

  // Dia sem dado, formato YYYY-MM-DD.
  date: string;
}
