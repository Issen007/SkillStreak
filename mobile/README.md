# mobile/

Expo (React Native + TypeScript) client. For the end-to-end "clone and try
it" instructions (Docker backend, seeding, screenshots), see the
[repo root README](../README.md) — this file is the developer-facing map of
`src/` plus a couple of gotchas specific to working in this app.

## Module map (`src/`)

- **`api/`** — the only layer allowed to know about HTTP. `client.ts` has
  one `request()` function (auth header, JSON parse, error-envelope
  handling); `endpoints.ts` is one thin, typed function per backend route
  (no logic beyond building the URL/body); `types.ts` mirrors
  `docs/api/phase1-contract.md` / `docs/api/phase2-contract.md` request and
  response shapes exactly, with no logic of its own. `authStorage.ts` and
  `localFlags.ts` wrap `expo-secure-store` for the session JWT and one
  small client-only "have I seen this bonus banner yet" flag,
  respectively — see their file comments for why SecureStore is reused for
  both rather than adding a second storage dependency.
- **`onboarding/`** — Screens O1-O6 (invite code → team confirm → name/
  avatar → birth year → parent contact/consent → confirmation), driven by
  `OnboardingFlow.tsx`'s small step state machine. Design source of truth:
  `docs/design/phase1-flows.md` Part 1.
- **`home/`** — the "Hem" tab (`HomeScreen.tsx`): streak card, team pool
  card, the "Jag har tränat" button and its activity/duration sheet, and
  the post-log celebration states (H5/H6, plus Phase 2's goal-bonus
  takeover). Design source: `docs/design/phase1-flows.md` Part 2,
  `docs/design/phase2-flows.md` Part 3.
- **`team/`** — the "Laget" tab (`TeamScreen.tsx`): baseline roster
  aggregate (counts only, never names) for every player, plus a
  captain-only detailed roster (`RosterScreen.tsx`) and consent-reminder
  action sheet. Design source: `docs/design/phase2-flows.md` Part 1.
- **`goal/`** — the "Mål" tab (`GoalScreen.tsx`): the team-wide weekly-goal
  progress card, history list, and the captain-only goal builder
  (`GoalBuilderFlow.tsx`, screens KB1-KB4). Design source:
  `docs/design/phase2-flows.md` Parts 2-3.
- **`navigation/`** — `TabBar.tsx`, a plain (non-library) bottom tab bar.
  `AppShell.tsx` (one level up, not inside `navigation/` since it also owns
  cross-tab data/state — see its file comment) wraps the three tabs.
- **`components/`** — shared, screen-agnostic primitives: buttons
  (`PrimaryButton`, `SecondaryButton`, `SecondaryLink`), `TextField`,
  `ScreenContainer`, and the transient-overlay components `Toast` and
  `CatchUpBanner`. (Two more transient overlays, `SuccessOverlay` and
  `GoalBonusTakeover`, live in `home/components/` instead since they're
  currently only ever used from `HomeScreen` — see "Known duplication"
  below before adding a fifth one of these.)
- **`theme/`** — `colors.ts`/`fonts.ts`, tokens from
  `docs/design/style-guide.md`. Treat that doc as the source of truth, not
  this file, if the two ever disagree.
- **`utils/`** — `dateMath.ts` (local-clock ISO date helpers, client-side
  defaults only — the server is the real source of truth for date
  validation) and `formatDate.ts` (Swedish date display; deliberately a
  manual month table, not `Intl.DateTimeFormat`, since Hermes's bundled ICU
  data doesn't reliably include full locale-aware month names).
- **`AppRoot.tsx`** — top-level "are we onboarding or in the app" switch,
  based on whether a session token exists.
- **`App.tsx`** (repo root of `mobile/`, not under `src/`) — Expo entry
  point: loads fonts, holds the splash screen until they're ready, then
  renders `AppRoot`.

For *why* a given screen looks the way it does (copy, judgment calls,
what's deliberately out of scope), read `docs/design/phase1-flows.md` and
`docs/design/phase2-flows.md` rather than this file — comments in the code
point at the specific screen ID (e.g. "Screen G2") but don't restate the
reasoning.

## Running locally

The root README covers the full "clone, start Docker backend, connect a
phone" walkthrough. The mobile-specific pieces:

- **`EXPO_PUBLIC_API_URL`** — the only way to point the app at a backend
  that isn't `localhost`. Expo inlines `EXPO_PUBLIC_*` env vars at
  build/start time (see `src/api/config.ts`). Without it: iOS Simulator
  can reach the host machine via `localhost` directly, but the Android
  Emulator's `localhost` refers to the emulator itself, so it needs the
  special alias `10.0.2.2` (handled automatically). A **physical** device
  (real iPhone/Android via Expo Go) always needs this set explicitly to
  your computer's LAN IP, since neither of the above applies:
  ```bash
  EXPO_PUBLIC_API_URL="http://<your-lan-ip>:3000" npx expo start --lan
  ```
- **Connecting a physical device via Expo Go** — install Expo Go from the
  App Store/Google Play, make sure the phone is on the **same Wi-Fi** as
  the machine running `expo start`, then scan the QR code the CLI prints
  (or enter the `exp://<your-lan-ip>:8081` URL manually if your Expo Go
  build has no scan option on its landing screen).
- **The SDK-version gotcha** — Expo Go only supports *one* SDK version per
  app-store release; there's no way to pin an older Expo Go build
  yourself. If a device's installed Expo Go is on a different SDK than
  this project's (`app.json`/`package.json`'s `expo` version), you'll get
  an "incompatible" error on connect. This project hit that once already
  (initially scaffolded on SDK 57, a real device only had SDK 54's Expo Go
  available) and resolved it by downgrading the project via
  `expo install --fix` rather than asking every tester to sideload a
  specific Expo Go build. If you hit this: first try updating Expo Go
  itself (App Store/Google Play) to the latest release — that's usually
  enough — and only downgrade this project's SDK if that doesn't resolve
  it.
- Package manager is **pnpm** (`pnpm install`), per
  `docs/adr/0003-package-managers.md` — don't reintroduce an npm/yarn
  lockfile alongside it.
- `npx tsc --noEmit` and `npx expo-doctor` are the two quick sanity checks
  worth running before calling a change done; neither replaces actually
  opening the app in Expo Go/simulator.

## Known duplication / consolidation candidates (tracked, not yet acted on)

Left as-is deliberately for now — see the Phase 2.5 pass in
`docs/ACTION_PLAN.md` for the full reasoning — but worth knowing about
before Phase 3 (media/feed) adds a third or fourth similar screen:

- `CatchUpBanner` (`components/`) and `Toast` (`components/`) are close to
  line-for-line identical (same fade-in/delay/fade-out `Animated`
  sequence, same tap-to-dismiss handler, same layout) — they differ only
  in background color, `zIndex`, duration, and message content. A real
  consolidation candidate (e.g. a `variant`/`durationMs` prop on `Toast`),
  just not done in this pass to avoid touching two live celebration paths
  without a dedicated review.
- `HomeScreen`, `TeamScreen`, `GoalScreen`, and `RosterScreen` each
  hand-roll the same loading-spinner / error-with-retry block and the same
  three style objects (`centered`, `errorText`, `retryText`). Worth
  extracting into one shared component/hook before a Phase 3 feed screen
  becomes a fifth copy.
- `TeamPoolCard` and `GoalCard` each re-implement the same
  "animate a progress-bar fill from `percentComplete`" `Animated.Value`
  logic. Small (a dozen lines), but a shared `useProgressBarWidth` hook
  would remove it if a third progress bar shows up.
- `GoalBonusTakeover` (`home/components/`) and `SuccessOverlay`
  (`home/components/`) were deliberately **not** folded into the
  `Toast`/`CatchUpBanner` consolidation above — their animation shapes
  (spring+scale takeover vs. banner-plus-floating-tag), timing, and
  dismissal behavior differ enough that a forced shared primitive would
  cost more (a prop surface trying to cover four unrelated shapes) than it
  saves.
