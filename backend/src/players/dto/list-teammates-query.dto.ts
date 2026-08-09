import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

// docs/api/phase2-contract.md endpoint 10's 2026-08-06 revision
// (docs/adr/0021-clip-challenge-notifications.md's security-reviewer
// addendum finding 2) — an opt-in narrowing, NOT a change to this
// endpoint's default response. `PlayersService.listTeammates`'s own
// comment explains why the default must stay unfiltered: this one
// endpoint backs three independent pickers (the video-clip tag picker,
// the ADR-0006 captain-transfer picker, and the ADR-0013 GDPR
// account-erasure successor picker), and only the first has ever been
// reasoned about wanting a `teamJoinStatus === APPROVED`-only list.
//
// A bare boolean query param arrives as the literal string `"true"`/
// `"false"` (or is entirely absent) — `@Type(() => Boolean)` would coerce
// any non-empty string (including `"false"`) to `true`, so this uses an
// explicit string-literal check instead, same posture as this codebase's
// other query-param transforms (e.g. ListClipsQueryDto's ISO-date/number
// handling) of never trusting a generic coercion for a query string.
export class ListTeammatesQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  approvedOnly?: boolean;
}
