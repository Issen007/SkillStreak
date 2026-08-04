import { IsString, Length } from 'class-validator';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A2 — the
// captain-generated invite code is an 8-character generateHumanCode
// string (see common/crypto/human-code.util.ts).
export class RedeemPtTeamLinkInviteDto {
  @IsString()
  @Length(8, 8)
  code!: string;
}
