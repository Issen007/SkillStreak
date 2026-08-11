import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  PrCampaignAudience,
  PrCampaignChannel,
  PrCampaignLocale,
  PrCampaignStatus,
} from '../entities/pr-campaign.entity';

export class UpsertPrCampaignDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  /**
   * Constrained to the characters that survive a URL unescaped. The tag
   * goes straight into `?campaign=` in copy that gets pasted into
   * LinkedIn and Facebook, and a tag needing percent-encoding would be
   * mangled by at least one of them — producing attribution that silently
   * does not match.
   */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/, {
    message: 'tag must be lowercase letters, numbers and dashes',
  })
  tag!: string;

  @IsEnum(PrCampaignChannel)
  channel!: PrCampaignChannel;

  @IsEnum(PrCampaignAudience)
  audience!: PrCampaignAudience;

  @IsEnum(PrCampaignLocale)
  locale!: PrCampaignLocale;

  @IsOptional()
  @IsEnum(PrCampaignStatus)
  status?: PrCampaignStatus;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  body?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  plannedFor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  postedUrl?: string;
}
