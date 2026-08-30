import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";


export class FacebookMetricInputDto {

  @IsString()
  externalCampaignId: string;

  @IsString()
  campaignName: string;


  @IsString()
  siteRef: string;

  @IsDateString()
  localDate: string;

  @IsString()
  accountTimezone: string;

  @IsString()
  accountCurrency: string;

  @IsNumber()
  @Min(0)
  spend: number;

  @IsInt()
  @Min(0)
  impressions: number;

  @IsInt()
  @Min(0)
  clicks: number;
}


export class GamMetricInputDto {
  @IsString()
  networkCode: string;

  @IsString()
  siteCode: string;

  @IsDateString()
  utcDate: string;

  @IsString()
  currencyCode: string;

  @IsNumber()
  @Min(0)
  adRevenue: number;

  @IsInt()
  @Min(0)
  impressions: number;

  @IsInt()
  @Min(0)
  adRequests: number;
}


export class IngestMetricsInputDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacebookMetricInputDto)
  facebook: FacebookMetricInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GamMetricInputDto)
  gam: GamMetricInputDto[];
}
