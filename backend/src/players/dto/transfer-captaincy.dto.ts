import { IsUUID } from 'class-validator';

// docs/api/phase2-contract.md's 2026-07-08 addendum, endpoint 9
// (docs/adr/0006-captain-transfer.md). Whether newCaptainPlayerId is
// actually a teammate (as opposed to just any real player id) is a
// business rule checked in PlayersService.transferCaptaincy (needs the
// row, not just the shape of the request), not here.
export class TransferCaptaincyDto {
  @IsUUID()
  newCaptainPlayerId!: string;
}
