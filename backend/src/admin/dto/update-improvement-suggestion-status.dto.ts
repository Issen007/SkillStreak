import { IsEnum } from 'class-validator';
import { ImprovementSuggestionStatus } from '../../improvement-suggestions/entities/improvement-suggestion.entity';

/**
 * Status only — no freeform admin-notes field, for the reason
 * UpdateBugReportStatusDto gives: `forbidNonWhitelisted: true` means a
 * client sending a `note` gets a 400 rather than having it quietly
 * dropped, so the absence is enforced at the boundary rather than merely
 * unimplemented.
 *
 * Somewhere to write down what you think of an idea is a real need, and
 * this is deliberately not it: that place is the backlog, in the
 * operator's own words, outside a table of child-authored text that is
 * swept after 90 days.
 *
 * **Any target status is accepted — transitions are not forward-only.**
 */
export class UpdateImprovementSuggestionStatusDto {
  @IsEnum(ImprovementSuggestionStatus)
  status!: ImprovementSuggestionStatus;
}
