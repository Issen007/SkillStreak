// Screen-by-screen state machine for Part 1 of docs/design/phase1-flows.md
// (O1-O6). O7 is a home-screen state, not part of this flow (see
// src/home/HomeScreen.tsx).
export type OnboardingStep = 'O1' | 'O2' | 'O3' | 'O4' | 'O5' | 'O6';

/** Everything collected across the onboarding screens, accumulated in
 * memory only until O5's submit (per the contract, nothing is created
 * server-side before `POST /players`). */
export interface OnboardingData {
  inviteCode: string;
  teamId: string | null;
  teamName: string | null;
  screenName: string;
  avatarId: string | null;
  birthYear: number | null;
  parentContact: string;
}

export const INITIAL_ONBOARDING_DATA: OnboardingData = {
  inviteCode: '',
  teamId: null,
  teamName: null,
  screenName: '',
  avatarId: null,
  birthYear: null,
  parentContact: '',
};
