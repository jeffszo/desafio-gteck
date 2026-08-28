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

// Uma linha de métrica do Facebook Ads, no formato que a rede de anúncios
// envia pelo webhook
export class FacebookMetricInputDto {
  // Id da campanha na conta do Facebook, usado pra distinguir campanhas
  // diferentes do mesmo site/dia.
  @IsString()
  externalCampaignId: string;

  // Nome da campanha, só pra exibição/depuração.
  @IsString()
  campaignName: string;

  // Referência do site na conta de anúncios. Chave pra casar com
  // SiteMapping.facebookSiteRef.
  @IsString()
  siteRef: string;

  // Dia civil na timezone da conta (accountTimezone), não UTC.
  @IsDateString()
  localDate: string;

  // Timezone da conta, necessária pra interpretar localDate corretamente.
  @IsString()
  accountTimezone: string;

  // Moeda da conta (BRL ou USD), spend está nessa moeda.
  @IsString()
  accountCurrency: string;

  // Custo de mídia do dia, na moeda da conta.
  @IsNumber()
  @Min(0)
  spend: number;

  // Impressões do dia.
  @IsInt()
  @Min(0)
  impressions: number;

  // Cliques do dia.
  @IsInt()
  @Min(0)
  clicks: number;
}

// Uma linha de métrica do Google Ad Manager, no formato que a rede envia
// pelo webhook
export class GamMetricInputDto {
  // Código da rede de anúncios no GAM.
  @IsString()
  networkCode: string;

  // Código do site no GAM. Chave pra casar com SiteMapping.gamSiteCode.
  @IsString()
  siteCode: string;

  // Dia em UTC (GAM sempre reporta em UTC, diferente do Facebook).
  @IsDateString()
  utcDate: string;

  // Moeda da receita. O GAM desta rede sempre reporta em USD.
  @IsString()
  currencyCode: string;

  // Receita bruta de anúncios do dia, sempre em USD.
  @IsNumber()
  @Min(0)
  adRevenue: number;

  // Impressões do dia.
  @IsInt()
  @Min(0)
  impressions: number;

  // Ad requests do dia (volume de leilões, não necessariamente preenchidos).
  @IsInt()
  @Min(0)
  adRequests: number;
}

// Payload combinado que a "rede de anúncios" envia por webhook. facebook/gam
// vazios ([]) são válidos: significa "sem dado esse dia nessa fonte", não
// um erro. Ver README para o que IngestionService#processMetrics precisa
// fazer com isso.
export class IngestMetricsInputDto {
  // Linhas de Facebook Ads pra persistir/atualizar.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacebookMetricInputDto)
  facebook: FacebookMetricInputDto[];

  // Linhas de Google Ad Manager pra persistir/atualizar.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GamMetricInputDto)
  gam: GamMetricInputDto[];
}
