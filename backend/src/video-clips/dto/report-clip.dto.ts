import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ClipReportReason } from '../entities/clip-report.entity';
import { CLIP_REPORT_NOTE_MAX_LENGTH } from '../video-clip.constants';

export class ReportClipDto {
  @IsEnum(ClipReportReason)
  reason!: ClipReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(CLIP_REPORT_NOTE_MAX_LENGTH)
  note?: string;
}
