import { IsOptional, IsUUID } from 'class-validator';

// docs/adr/0013-account-erasure.md Decision 3/4 — required iff the caller
// is currently captain AND has at least one teammate, forbidden otherwise;
// that state-dependent rule is enforced in AccountErasureService (it
// depends on the caller's own row, not on this DTO's shape alone), not
// here. This DTO only validates the field's own format when present.
export class RequestErasureDto {
  @IsOptional()
  @IsUUID()
  successorPlayerId?: string;
}
