import { IsDateString } from "class-validator";

export class GapReportQueryInputDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
