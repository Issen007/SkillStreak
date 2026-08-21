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
  `docs/api/phase1-contract.md` through `docs/api/phase3-contract.md`
  request and response shapes exactly, with no logic of its own.
  `authStorage.ts` and `localFlags.ts` wrap `expo-secure-store` for the
  session JWT and a growing set of small client-only "have I seen this
  yet" flags (bonus banner, captaincy change, chat/clip unread-dot
  timestamps, chat blocks cache, Fas 3's clip-intro-seen flag and "seen
  challenge clipIds" set), respectively — see their file comments for why
  SecureStore is reused for all of these rather than adding a second
  storage dependency. Note `endpoints.ts`'s two-phase upload split: the
  client calls `createClipUploadUrl`/`completeClipUpload` (both go through
  `client.ts`, same as every other endpoint), but the `PUT` of the actual
  video bytes to the presigned `uploadUrl` in between does **not** — it
  goes straight to MinIO via `expo-file-system`'s upload task (see
  `clips/upload/V6UploadProgress.tsx`), deliberately outside `api/`'s
  "only layer allowed to know about HTTP" rule, since that URL is never an
  `/api/v1/...` route to begin with.
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
- **`chat/`** — the "Chatt" tab (`ChatScreen.tsx`): CH0-CH5 (intro card,
  poll-on-foreground message list, tap-to-reveal report, tap-to-open block
  sheet, blocked-players list). Design source: `docs/design/
  phase2.6-2.7-flows.md` Part B.
- **`clips/`** — the "Klipp" tab (`ClipsScreen.tsx`, Fas 3), placed third in
  tab order: Screens V0-V2 (one-time intro, the consent-gated whole-tab
  waiting state, and the tap-to-play feed itself with its explicit "Visa
  fler klipp" pagination — deliberately not infinite scroll/autoplay, per
  CLAUDE.md's own anti-dark-pattern instruction), the "you were challenged"
  banner (V3, reusing `Toast` — see "Known duplication" below), the report
  sheet/confirmation (V9/V10) and self-delete sheet (V11, the first real
  use of `components/DangerButton.tsx`). `upload/` holds the two-phase
  upload flow's own step machine (`UploadFlow.tsx`) and Screens V4-V7 (pick/
  record → caption + optional tag-a-teammate → progress → published) —
  `clipValidation.ts` is the client-side pre-check (duration/size/format)
  that mirrors the backend's own hard caps so an obviously invalid file
  gets an inline message before ever calling endpoint 1. Design source:
  `docs/design/phase3-flows.md`; contract: `docs/api/phase3-contract.md`.
  Reuses `chat/components/BlockSheet.tsx` directly for its own block sheet
  (a `TeamChatBlock` now covers both chat *and* clips, per the flow doc's
  decision — see that file's updated copy) rather than inventing a second
  block mechanism.
- **`navigation/`** — `TabBar.tsx`, a plain (non-library) bottom tab bar.
  `AppShell.tsx` (one level up, not inside `navigation/` since it also owns
  cross-tab data/state — see its file comment) wraps all five tabs.
- **`components/`** — shared, screen-agnostic primitives: buttons
  (`PrimaryButton`, `SecondaryButton`, `SecondaryLink`, and Fas 3's
  `DangerButton` — this app's reserved destructive/red treatment, used
  exactly once so far for the Klipp tab's self-delete confirmation, since
  that's the first action in this app that's genuinely, unconditionally
  irreversible), `TextField`, `ScreenContainer`, `LoadingOrRetry` (the
  shared loading-spinner/error-with-retry block every data-fetching
  screen uses), and the transient-overlay component `Toast` (its `'gold'`
  `variant` now also covers the former `CatchUpBanner`'s look, per the
  "Known duplication" note below). (Two more transient overlays,
  `SuccessOverlay` and `GoalBonusTakeover`, live in `home/components/`
  instead since they're currently only ever used from `HomeScreen` — see
  "Known duplication" below before adding a second one of these outside
  Home.)
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
- **Testing from a different network (no shared Wi-Fi needed)** — the
  LAN-IP approach above breaks the moment the phone/viewer isn't on the
  same network as this machine (a different Wi-Fi, a guest network with
  client isolation, a coffee-shop demo, etc.), and the IP itself changes
  across networks — this project's `tools/lab-access` exists specifically
  to re-detect it, but that only helps for the *same*-network case. For a
  stable, network-independent alternative, tunnel both halves through a
  public relay instead of a raw IP:
  ```bash
  # In backend/ — tunnels the API via Cloudflare's free "quick tunnel"
  # (no account needed; requires the cloudflared binary — see
  # https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  pnpm run tunnel
  # → prints a https://<random>.trycloudflare.com URL; copy it

  # In mobile/ — tunnels Metro/Expo Go via Expo's own ngrok-based relay
  EXPO_PUBLIC_API_URL="https://<the-trycloudflare-url-above>" pnpm run web:tunnel
  ```
  Both URLs are random and only stable for the life of that tunnel process
  (a restart gets a new one) — not meant as a permanent address, just one
  that works regardless of which network either side is on. The
  `tools/lab-access` Simulator tab's URL field (see its README) accepts
  the resulting `https://*.exp.direct` URL directly if you want the
  phone-frame preview over the tunnel too.
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
- **Fas 3's native modules** — `expo-video` (playback), `expo-image-picker`
  (pick/record a clip), and `expo-file-system` (the presigned-`PUT`
  upload task with real progress events) were added fresh this phase; none
  of Phases 0-2.7 needed any native media module before. All three ship in
  the SDK 54 baseline already documented above (`expo install` resolved
  compatible versions automatically) — no Expo Go incompatibility beyond
  the existing SDK-version gotcha. `app.json`'s `plugins` array carries
  Swedish permission-prompt copy for `expo-image-picker` (camera/photo-
  library/microphone) — Expo Go itself uses generic built-in prompts
  regardless (custom config plugins only take effect in a real prebuild/
  dev-client/EAS build), so this only matters once this project produces
  one of those, not for day-to-day Expo Go testing.
- **No iOS Simulator/Android emulator in this Linux dev environment** (a
  known, previously-flagged gap — see `docs/internal/ACTION_PLAN.md`'s Phase 1
  entry) — still true for Fas 3. Verification for this phase leaned on a
  clean Metro bundle (`npx expo export`) plus exercising every new endpoint
  against a real running backend directly (see `docs/internal/ACTION_PLAN.md`'s
  Phase 3 entry for the exact scenarios covered) — a real tap-through of
  the camera/picker/playback UI still needs a physical device or a
  macOS/Android host.

## Known duplication / consolidation candidates

Three items tracked here since the Phase 2.5 pass (see
`docs/internal/ACTION_PLAN.md` for that pass's original reasoning) were resolved in
a dedicated cleanup pass (2026-08-02); one item remains deliberately
unresolved:

- **Resolved**: `CatchUpBanner` (`components/`) and `Toast`
  (`components/`) were close to line-for-line identical (same fade-in/
  delay/fade-out `Animated` sequence, tap-to-dismiss handler, and layout,
  differing only in background color, `zIndex`, duration, and message
  content) — Fas 3 had already partly anticipated this by having Screen
  V3's "you were challenged" banner reuse `Toast` directly rather than add
  a third near-duplicate. `Toast` now takes a `variant?: 'default' |
  'gold'` prop covering `CatchUpBanner`'s exact visual treatment;
  `CatchUpBanner` itself is deleted, and its one call site (`AppShell`'s
  Screen G3 catch-up banner) now renders `<Toast variant="gold"
  durationMs={3000} ... />` with the message text/number-formatting moved
  to the call site (`Toast` only ever took a plain `message` string).
  `CaptainBanner` (`components/`) was deliberately left as its own
  component, not folded in — its two-line/variant-styled layout doesn't
  fit `Toast`'s single-message prop surface cleanly enough to be worth
  forcing.
- **Resolved**: `HomeScreen`, `TeamScreen`, `GoalScreen`, `RosterScreen`,
  and `ClipsScreen` each hand-rolled the same loading-spinner/
  error-with-retry block and the same three style objects (`centered`,
  `errorText`, `retryText`). Extracted into `components/LoadingOrRetry.tsx`
  — a `loading`/`errorMessage`/`retryLabel`/`onRetry` component with a
  `spinnerColor` prop (Mål's card uses `colors.gold`, everything else the
  default `colors.flame`) and a `fullScreen`/`style` override for Klipp's
  three usages, one of which is embedded inline in a `ScrollView` rather
  than filling the screen.
- **Resolved by removal, not extraction**: this note used to flag
  `TeamPoolCard` and `GoalCard` as each re-implementing the same
  "animate a progress-bar fill from `percentComplete`" `Animated.Value`
  logic, worth a shared `useProgressBarWidth` hook if a third ever
  appeared. `TeamPoolCard`'s percent-fill bar was since removed entirely
  (ADR-0008 Decision 4 — Fas 2.7's leaderboard rewrite has no maximum for
  a bar to represent), and no third progress bar has appeared elsewhere in
  the app — so as of this cleanup pass there is exactly one implementation
  left (`GoalCard`), and extracting a hook for a single call site would be
  premature abstraction, not a duplication fix. Revisit if/when a second
  progress bar actually shows up.
- **Still deliberately unresolved**: `GoalBonusTakeover`
  (`home/components/`) and `SuccessOverlay` (`home/components/`) are
  **not** folded into `Toast` — their animation shapes (spring+scale
  takeover vs. banner-plus-floating-tag), timing, and dismissal behavior
  differ enough that a forced shared primitive would cost more (a prop
  surface trying to cover three unrelated shapes) than it saves.
