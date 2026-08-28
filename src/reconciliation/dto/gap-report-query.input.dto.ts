import { IsDateString } from "class-validator";

// Janela de datas verificada por GET /reconciliation/gaps.
export class GapReportQueryInputDto {
  // Início da janela (inclusive), formato YYYY-MM-DD.
  @IsDateString()
  from: string;

  // Fim da janela (inclusive), formato YYYY-MM-DD.
  @IsDateString()
  to: string;
}
