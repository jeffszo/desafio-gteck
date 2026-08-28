import { IsDateString, IsOptional, IsString } from "class-validator";

export class ReportQueryInputDto {
  // Início do período (inclusive), formato YYYY-MM-DD.
  @IsDateString()
  from: string;

  // Fim do período (inclusive), formato YYYY-MM-DD.
  @IsDateString()
  to: string;

  // Filtra o relatório pra um único site (facebookSiteRef de SiteMapping).
  // Omitido = todos os sites.
  @IsOptional()
  @IsString()
  siteRef?: string;
}
