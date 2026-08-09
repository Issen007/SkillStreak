import type { PlayerLocale } from '../api/types';
import { getDeviceDefaultLocale } from '../i18n/deviceLocale';

// Screen-by-screen state machine for Part 1 of docs/design/phase1-flows.md
// (O1-O6, plus O1a added by the self-service-team-
// creation update). O7 is a home-screen state, not part of this flow (see
// src/home/HomeScreen.tsx).
// O0 (docs/adr/0014-multi-language-support.md Decision 2, Fas 4.3) — the
// language picker, added ahead of O1 since every later screen's copy needs
// to render in whatever the player just picked.
// RA1/RA2 (docs/adr/0004-coach-auth-and-session-reissue.md's 2026-07-27
// addendum) — the "Har du redan ett konto?" self-service session-reissue
// entry point, reachable from O1. Not part of the O1-O6 numbering since
// it's a parallel branch (an existing account regaining a session), not a
// step in creating a new one.
export type OnboardingStep =
  | 'O0'
  | 'O1'
  | 'O1a'
      | 'O2'
  | 'O3'
  | 'O4'
  | 'O5'
  | 'O6'
  | 'RA1'
  | 'RA2';

/** Everything collected across the onboarding screens, accumulated in
 * memory only until O5's submit (per the contract, nothing is created
 * server-side before `POST /players`). */
export interface OnboardingData {
  /** Set at Screen O0 — starts as the device-guessed default
   * (`i18n/deviceLocale.ts`), overwritten the moment the player taps a
   * different row, submitted as-is on `POST /players`. See
   * docs/adr/0014-multi-language-support.md Decision 2. */
  locale: PlayerLocale;
  inviteCode: string;
  teamId: string | null;
  /** Join path: the existing team's name, from O1/O2's preview. Create
   * path: the name typed at O1a. Never both at once — see `isCreatingTeam`
   * for which meaning currently applies. After a successful O5 submit, this
   * is overwritten with the server-confirmed `teamName` from the `201`
   * response either way (see ADR-0009's response addendum). */
  teamName: string | null;
  /** True once the player has confirmed "create a new team" at Screen O1a
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
   * (O1a vs O2) the player took to get here — see the flow doc's O6
   * "Edge case" callout for why. */
  teamCreated: boolean;
  isCaptain: boolean;
}

export const INITIAL_ONBOARDING_DATA: OnboardingData = {
  // Local-only device guess (see i18n/deviceLocale.ts) — Screen O0's
  // starting selection, not yet a submitted choice.
  locale: getDeviceDefaultLocale(),
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
