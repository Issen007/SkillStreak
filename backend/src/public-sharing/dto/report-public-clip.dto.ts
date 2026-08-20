import { IsEnum } from 'class-validator';
import { ClipReportReason } from '../../video-clips/entities/clip-report.entity';

/**
 * Reporting a stranger's public clip.
 *
 * Reuses the team feed's `ClipReportReason` rather than introducing a
 * second vocabulary: a report is a report, and triage should not have to
 * learn which surface produced it. The public sheet offers four of the
 * five (design §6) — the app-side subset is a copy decision, not a
 * different data model, so nothing here needs to change if that copy is
 * re-tuned.
 *
 * No note field, deliberately. The team-side report has one; this one
 * does not, for the same reason nothing else on the public feed accepts
 * free text between strangers.
 */
export class ReportPublicClipDto {
  @IsEnum(ClipReportReason)
  reason!: ClipReportReason;
}
