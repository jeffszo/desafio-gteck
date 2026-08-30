import { IsDateString, IsOptional, IsString } from "class-validator";

export class ReportQueryInputDto {
  @IsDateString()
  from: string;
  @IsDateString()
  to: string;
  @IsOptional()
  @IsString()
  siteRef?: string;
}
