// Screen-by-screen state machine for Part 1 of docs/design/phase1-flows.md
// (O1-O6, plus O1a/O1b/O1c added by the 2026-07-09 self-service-team-
// creation update). O7 is a home-screen state, not part of this flow (see
// src/home/HomeScreen.tsx).
export type OnboardingStep =
  | 'O1'
  | 'O1a'
  | 'O1b'
  | 'O1c'
  | 'O2'
  | 'O3'
  | 'O4'
  | 'O5'
  | 'O6';

/** Everything collected across the onboarding screens, accumulated in
 * memory only until O5's submit (per the contract, nothing is created
 * server-side before `POST /players`). */
export interface OnboardingData {
  inviteCode: string;
  teamId: string | null;
  /** Join path: the existing team's name, from O1/O2's preview. Create
   * path: the name typed at O1b. Never both at once — see `isCreatingTeam`
   * for which meaning currently applies. After a successful O5 submit, this
   * is overwritten with the server-confirmed `teamName` from the `201`
   * response either way (see ADR-0009's response addendum). */
  teamName: string | null;
  /** True once the player has confirmed "create a new team" at Screen O1c
   * (ADR-0009's create path). Drives whether `teamName` is sent on
   * `POST /players` — absent entirely for the join path, per the
   * contract's "byte-for-byte unchanged if never sent" guarantee. */
  isCreatingTeam: boolean;
  screenName: string;
  avatarId: string | null;
  birthYear: number | null;
  parentContact: string;
  /** Set from the `201` response at the end of O5. Screen O6 is built
   * strictly off these two response fields, never off which UI path
   * (O1a/O1c vs O2) the player took to get here — see the flow doc's O6
   * "Edge case" callout for why. */
  teamCreated: boolean;
  isCaptain: boolean;
}

export const INITIAL_ONBOARDING_DATA: OnboardingData = {
  inviteCode: '',
  teamId: null,
  teamName: null,
  isCreatingTeam: false,
  screenName: '',
  avatarId: null,
  birthYear: null,
  parentContact: '',
  teamCreated: false,
  isCaptain: false,
};
