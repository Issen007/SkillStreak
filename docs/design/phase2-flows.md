# Phase 2 Flows — Coach Dashboard, Challenge Builder & Player Challenge Card

Status: draft, ux-designer-owned, for frontend-developer/backend-developer to
build against. No API contract exists yet for Phase 2 (unlike Phase 1's
`api/phase1-contract.md`) — the "API" line on each screen below is this
doc's best guess at the shape, not a fixed spec; see "Notes for
architect/backend-developer" at the end for the informal endpoint sketch.
Built against the real `Challenge` entity
(`backend/src/challenges/entities/challenge.entity.ts`) — every field this
doc uses (`title`, `description`, `targetMetric`, `targetValue`,
`startDate`/`endDate`, `status`) already exists; nothing here invents a
different shape.

Same format as `docs/design/phase1-flows.md`: **Trigger** / **API** /
**Copy** / **Next** per screen, judgment calls flagged inline and
summarized at the end. Visual language is `docs/design/style-guide.md` —
this doc doesn't add new color tokens (see judgment call on the
"challenges" visual motif below for why).

Companion static mockup: `docs/design/phase2-mockup.html` (same phone-frame
pattern as `phase1-mockup.html`).

**Platform note:** per the task framing, there is no separate web
dashboard — the coach dashboard and challenge builder are screens inside
the same Expo app, gated behind a coach-authenticated session rather than
a player one. **Coach login itself is out of scope of this doc** — Phase 1
only built player onboarding (no-password, coach-facilitated). A coach
needs a real credential (the `Coach` entity has `email`/`displayName`,
no password field yet), which is an auth design question for
architect/backend-developer, not a UX layout question. Everything below
assumes that session already exists and starts from the coach's dashboard
as the landing screen for a coach-authenticated app session.

---

## Part 1 — Coach Dashboard

### Screen C1 — Tränarvy (coach home)

**Trigger:** app open with a coach-scoped session (as opposed to a
player-scoped one — the app should render an entirely different home
surface for a coach token, not a modified player home).
**API:** `GET /api/v1/coach/teams/:teamId/dashboard` (sketch — see notes
at the end). Response would fold together roster/consent counts, the
team's active `TeamSeasonPot`, and a challenge-status summary in one call,
mirroring Phase 1's "no extra round-trip" principle from
`phase1-contract.md`.

Layout: three stacked cards, no tabs, no scrolling required for the
common case (a squad-sized team, ~10–20 players) — a coach checking in
between drills should see everything that matters in one glance.

**Card 1 — Laget (roster + consent):**
- Heading: **"Laget"** 👥
- Big number: **"{rosterCount} spelare"**
- Status chips below: **"{approvedCount} godkända ✓"**,
  **"{pendingCount} väntar ⏳"**, **"{revokedCount} pausade ⏸️"** (a chip
  is omitted entirely if its count is 0, rather than showing "0 pausade" —
  keeps the healthy-team case from looking cluttered)
- Secondary button: **"Se laget"** → Screen C2

**Card 2 — Lagets VM-Guld-pott (same data the player app shows, coach
vantage):**
- Heading: **"Lagets VM-Guld-pott"** 🥇 (gold fill, same meter component
  as the player home screen — deliberately identical, so a coach
  recognizes it instantly)
- Points + meter: **"{pointsTotal} / {goalThreshold}"**,
  `percentComplete` drives fill width
- Sub-line: **"{percent} % till guldet {seasonLabel}"**
- Second sub-line, coach-specific (not shown to players — this is an
  engagement signal, not a score): **"Senaste 7 dagarna: {loggedCount} av
  {rosterCount} spelare har loggat minst en gång."**

**Card 3 — Utmaningar (challenges):**
- Heading: **"Utmaningar"** 🎯
- Grouped counts: **"{activeCount} aktiva"**, **"{draftCount} utkast"**,
  **"{completedCount} avslutade"**
- Up to 3 most-relevant rows shown inline (active first, then draft, then
  most-recently-completed), each: title, small status pill, one context
  line —
  - Active: **"Aktiv · Slutar {endDate}"**
  - Draft: **"Utkast · inte publicerad än"**
  - Completed: **"Avslutad · {completedCount}/{rosterCount} klarade den"**
- Row tap → Screen C3 (challenge detail, coach view)
- **"Visa alla"** text link if more than 3 challenges exist → full list
  (same screen as C3's list, not designed as a separate screen here —
  it's C3's list view without a single challenge pre-selected)
- Prominent primary button, full-width, bottom of card:
  **"+ Ny utmaning"** → Screen CB1 (challenge builder)

**Next:** "+ Ny utmaning" → CB1. "Se laget" → C2. A challenge row → C3.

---

### Screen C2 — Laget (roster + consent detail)

**Trigger:** "Se laget" tap from C1.
**API:** `GET /api/v1/coach/teams/:teamId/roster` (sketch).

A flat list, one row per player. **Deliberately shows `screenName`, not
real name** — per CLAUDE.md's screen-name-first identity rule, a coach
dashboard doesn't need to break that convention to do its job (consent
status and last-trained date don't require a real name); real-name
lookups, where a coach genuinely needs them (e.g. contacting a parent),
already live in the `PlayerPrivateInfo`/consent-email flow from the
pre-beta hardening pass, not this screen.

Per row:
- Avatar emoji + `screenName`
- Consent status chip: **"Godkänd ✓"** / **"Väntar ⏳"** / **"Pausad ⏸️"**
  / **"Inte skickad än"** (mirrors the four `ParentalConsentStatus`
  values, same wording style as Phase 1's O7 banner so a coach recognizes
  the same language the kid sees)
- Small muted line: **"Senast loggade: {date}"** or, if never logged,
  **"Har inte loggat än"** — framed as information for the coach to
  follow up personally (e.g. "hey, everything okay?"), not a public
  ranking; this line is coach-only, never shown to teammates.

Row actions (tap row → small action sheet, not inline buttons — keeps the
list scannable):
- **"Skicka påminnelse till förälder"** — only shown for `pending` status;
  re-sends the consent-request email. *(Judgment call: no such
  "resend" endpoint exists yet — the pre-beta consent flow issued one
  single-use token per request. Flagging this as a real Phase 2 backend
  need, not assuming it's free.)*
- **"Skicka ny inloggningslänk"** — shown for any player, addresses the
  carried-over Phase 1 follow-up ("`tokenVersion` check + coach-facing
  reissue action", tracked in `ACTION_PLAN.md`'s Phase 1 follow-ups).
  *(Judgment call: this doc designs only the coach-facing trigger and
  confirmation copy, not the actual re-linking mechanism — how the new
  session reaches the kid's device without a password is a real
  security/session-design question for architect + security-reviewer,
  not something to improvise here as a UI-only decision.)*
  - Confirmation copy after tapping: **"Ny länk skickad. Visa den för
    {screenName} så de kan logga in igen."**

**Next:** back gesture/button → C1.

---

### Screen C3 — Utmaningens detaljer (challenge detail, coach view)

**Trigger:** tapping a challenge row from C1 or its "Visa alla" list.
**API:** `GET /api/v1/coach/challenges/:id` (sketch) — includes the
challenge fields plus a coach-only completion aggregate.

Copy:
- Title, description (as the coach wrote them)
- Target line, plain language: **"Mål: {targetValue} minuter
  {targetMetricLabel} per spelare"** (see CB2 for where
  `targetMetricLabel` comes from)
- Dates: **"{startDate} – {endDate}"**
- Status pill: **"Utkast"** / **"Aktiv"** / **"Avslutad"** / **"Avbruten"**
- Completion aggregate (only meaningful once `active`/`completed`):
  **"{completedCount} av {rosterCount} spelare har nått målet"** — team
  count only, **no per-player ranked list** (see judgment call below on
  why a leaderboard isn't shown here either).

Status-dependent actions, one primary button:
- `draft` → **"Publicera"** (→ `active`) and a secondary **"Redigera"**
  (re-opens CB1–CB3 pre-filled). Editing is only offered while `draft` —
  once `active`, dates/target are frozen (see judgment call).
- `active` → secondary-only, low-emphasis: **"Avbryt utmaningen"**
  (→ `cancelled`, with a confirm step: **"Avbryta '{title}'? Loggad
  träning påverkas inte, men ingen mer räknas till den här
  utmaningen."**) — no "edit" option while active, to avoid a coach
  quietly moving the goalposts on players mid-challenge.
- `completed` / `cancelled` → read-only, no actions (history only).

**Next:** "Publicera" → status flips, chip updates in place, back to C1's
card refreshing its counts. "Redigera" → CB1 pre-filled. "Avbryt" (after
confirm) → same in-place update.

---

## Part 2 — Challenge Builder

### Screen CB1 — Titel och beskrivning

**Trigger:** "+ Ny utmaning" (C1) or "Redigera" on a draft (C3).
**API:** none yet — client-side form state; submitted as part of CB4's
create/update call.

Copy:
- Heading: **"Skapa en utmaning"**
- Sub: **"Ge den ett kul namn — det här är vad spelarna ser."**
- Input label: **"Titel"**, placeholder: **"T.ex. Zorro-finter-utmaningen"**
- Input label: **"Beskrivning"** (multi-line), placeholder: **"T.ex. Gör
  så många zorro-finter du kan innan fredag!"**
- Primary button (disabled until title is non-empty): **"Nästa"**

**Next:** → Screen CB2.

---

### Screen CB2 — Sätt målet

**Trigger:** title/description entered.
**API:** none yet.

**Judgment call — target metric as a fixed preset, not free text:**
`targetMetric` is a free-form `varchar` column on the entity, but this
builder deliberately constrains it to five app-controlled values at the
UI layer, mirroring the same four `activityType` values the "Vad tränade
du?" picker already uses (`fitness`/`drill`/`running`/`other`, from
`api/phase1-contract.md`'s H2 screen) plus one that spans all of them:

| Chip (Swedish label) | Icon | `targetMetric` value |
|---|---|---|
| Kondition | 🏋️ | `fitness-minuter` |
| Teknik/övning | 🏑 | `drill-minuter` |
| Löpning | 🏃 | `running-minuter` |
| Annat | ⭐ | `other-minuter` |
| Totalt (alla typer) | 🎯 | `total-minuter` |

Why a preset and not free text: progress has to be computed automatically
by summing real `TrainingLogEntry` rows (`durationMinutes`, tagged
`challengeId`) — a free-text metric like "antal zorro-finter" has no
corresponding loggable field (the app only ever records an activity type
+ a duration in minutes, never a move count or rep count), so a freeform
label would create a challenge whose progress meter *cannot actually be
computed*. Constraining the picker to these five values guarantees every
published challenge is trackable the moment it goes live. The coach's
creative framing ("50 zorro-finter") still lives in CB1's free-text
title/description — the structured target underneath is a close
mechanical proxy (e.g. "30 minutes of technique work"), not a literal
move count. This mismatch (fun title vs. mechanical target) is called out
explicitly on this screen, not hidden:

Copy:
- Heading: **"Vad ska spelarna samla ihop?"**
- Sub (the mismatch, named plainly): **"Vi räknar loggad träningstid, inte
  antal moves — så välj den typ av träning som passar bäst."**
- Metric chips: as table above, single-select
- Input label: **"Mål (minuter)"**, numeric stepper, placeholder
  **"T.ex. 30"**
- Live preview line, updates as fields fill in: **"Varje spelare försöker
  samla {targetValue} minuter {metricLabel} innan utmaningen slutar."**
- Primary button (disabled until a metric and a positive `targetValue`
  are set): **"Nästa"**

**Next:** → Screen CB3.

---

### Screen CB3 — Start- och slutdatum

**Trigger:** metric + target value set.
**API:** none yet.

Copy:
- Heading: **"När börjar och slutar utmaningen?"**
- Two date pickers: **"Startdatum"** (defaults to today), **"Slutdatum"**
  (defaults to +7 days — a sensible default for a "before Friday"-style
  weekly challenge, editable)
- Inline validation if end ≤ start: **"Slutdatum måste vara efter
  startdatum."**
- Primary button: **"Nästa"**

**Next:** → Screen CB4.

---

### Screen CB4 — Granska och publicera

**Trigger:** dates set.
**API:** submitting calls either:
- `POST /api/v1/coach/challenges` with `status: "draft"` (**"Spara som
  utkast"**), or
- `POST /api/v1/coach/challenges` with `status: "active"` directly
  (**"Publicera nu"**) — a single call, not create-then-activate, since
  there's no reason to force two round-trips for the common "I'm ready
  now" case.

If this is an edit of an existing draft (from C3's "Redigera"), the same
screen instead calls `PATCH /api/v1/coach/challenges/:id`.

Layout: a live preview of the exact card a player will see (Screen CP1's
card, rendered inline here) above the two action buttons — so the coach
sees precisely what the team is about to be shown, not a data-entry
summary table.

Copy:
- Heading: **"Så här ser det ut för spelarna"**
- [Player-card preview — see CP1]
- Secondary button: **"Spara som utkast"**
- Primary button: **"Publicera nu"**

**Next:** either button → success toast (**"Utmaningen är sparad!"** /
**"Utmaningen är publicerad — laget ser den nu."**) → back to Screen C1,
challenges card refreshed.

---

## Part 3 — Player-Facing Challenge Card

### Judgment call — individual progress, not team-wide

The task flags this as an open call: is a challenge's progress meter
individual (like the streak) or team-wide (like the VM-Guld pool)?
**Decision: individual, tracked per player, against the team's shared
challenge definition.**

Reasoning, against the pitch's own example ("Gör 50 zorro-finter innan
fredag"):
- That phrasing reads as a personal target each player is asked to hit
  ("*you*, do 50"), not a pooled target the team clears together. A
  team-wide sum would make the challenge trivially satisfiable by a few
  highly active players while most of the team does nothing — which
  undercuts the coach's actual intent (get *everyone* doing the drill),
  and duplicates what VM-Guld already does better (VM-Guld is explicitly
  designed to be "independent of individual skill/age" and pooled by
  design — see CLAUDE.md).
- The style guide's whole reason for the flame/gold split is that
  "individual" and "shared" already have distinct, protected visual
  language. A challenge that's really "everyone individually chases the
  same target, in parallel" fits the flame (individual) side of that
  split much better than inventing a second pooled meter that would
  compete visually with VM-Guld's gold meter for the same "shared
  progress bar" psychological hook — diluting the one pooled meter the
  team is meant to rally around.
- Mechanically, this is also just simpler against the real schema:
  `TrainingLogEntry.playerId` + `TrainingLogEntry.challengeId` gives a
  clean per-player sum with no extra modeling; a team-wide challenge
  total would need to be reconciled against — and would likely be
  confused with — `TeamSeasonPot.pointsTotal`, which already exists for
  exactly that "everyone's effort, one shared number" purpose.

**Visual consequence:** the per-player progress meter on a challenge card
uses **`flame`**, not `gold` — it's a "mine" meter, structurally identical
to the streak's individual framing, even though the *challenge itself* is
authored once and assigned to the whole team. Buttons stay the neutral
`ink` fill used for primary actions elsewhere (not flame, not gold) —
challenges don't need a third color token; they reuse the existing
individual/shared split correctly rather than inventing a new one. Worth
folding this convention back into `style-guide.md` once
frontend-developer builds against it, not treated as a one-off.

A team-level number still appears (see CP1), but only as a plain
**count** ("8 av 14 klarade den"), never a ranked/named list — same
badge-style "no performance shaming" principle CLAUDE.md already applies
to badges extends naturally to challenges.

### Judgment call — no separate "join" step

Because `Challenge.teamId` already scopes a challenge to the whole team
(the entity has no per-player assignment table), every teammate is
automatically eligible the moment a challenge goes `active` — there's no
enrollment/opt-in screen. A player participates simply by tagging a
training log to the challenge when they log (see the H2 addendum below).
This keeps Phase 2 a one-tap-deeper addition to the existing loop, not a
new signup flow.

---

### Screen CP1 — Utmaningar (tab)

**Trigger:** tapping the **"Utmaningar"** tab, already present (but
unbuilt) in the Phase 1 tab bar mockup.
**API:** `GET /api/v1/players/me/challenges` (sketch) — returns the
team's `active`/`completed` challenges plus this player's own computed
progress against each.

Layout: simple vertical list, no infinite scroll (a team has a handful of
challenges at a time, not a feed) — active challenges first, a
"Avslutade utmaningar" section below for completed ones.

Per active challenge, a card:
- Title + description (coach's copy, verbatim)
- Progress meter, `flame`-filled: **"{playerMinutes} / {targetValue}
  minuter"**, percent-driven fill
- Team aggregate line, small, muted: **"{completedCount} av
  {rosterCount} lagkompisar har redan klarat den här utmaningen!"**
  (celebratory framing of others' success, not a comparison ranking)
- Time-remaining line, informational only, no urgency styling: **"Slutar
  {endDate}"** — deliberately not a countdown timer or "X dagar kvar!"
  banner; per CLAUDE.md, no manufactured urgency aimed at children, even
  in a feature this low-stakes.
- If the player has already reached `targetValue`: card gets a small
  **"Klart! 🎉"** chip and the meter shows full — this is a natural badge
  trigger (e.g. a future "Utmaning klarad" `BadgeAward`), noted here as a
  hook for backend-developer/architect, not designed in depth in this doc.

Empty state (no active challenges): a friendly placeholder, not a blank
list — **"Inga utmaningar just nu"**, sub: **"Din tränare lägger snart
upp en ny — kolla igen om ett tag!"**

**Next:** no further navigation needed from this screen (progress updates
automatically as the player logs training elsewhere) — this is a
check-in view, not a flow.

---

### H2 addendum (Phase 2) — tagging a log to a challenge

Extends Phase 1's Screen H2 ("Vad tränade du?" bottom sheet,
`phase1-flows.md`) rather than replacing it — the activity/duration chips
are unchanged.

**Trigger:** same as H2 (CTA tap on the home screen), now additionally
checking whether any `active` team challenge is *compatible* with the
activity type the player is about to pick (metric matches the picked
`activityType`, or metric is `total-minuter`, which matches anything).

Added row, appears only after an activity chip is picked, and only if at
least one compatible active challenge exists (row is omitted entirely
otherwise — no dead "no challenges" state cluttering the common case):

- Small label: **"Räkna till en utmaning?"**
- Chip(s), one per compatible active challenge, single-select (a log can
  only carry one `challengeId`, per the entity's single nullable FK):
  - **Exactly one compatible challenge** → its chip is pre-selected by
    default (opt-out, not opt-in — the friendlier default when there's no
    ambiguity, consistent with "minimal reading, one tap deep")
  - **More than one compatible challenge** → none pre-selected, player
    picks at most one, to avoid guessing which the player meant
- Submitting still calls the same `POST /training-logs`, now including
  `challengeId` if a chip was selected

**Next:** unchanged from H2 — `201` → H5/H6 success moment. No extra
success copy for the challenge tag itself in Phase 2 (avoids stacking two
celebration moments on one tap); CP1's card simply reflects the new total
next time it's opened.

---

## Judgment calls made in this doc (flagging, not silently deciding)

1. **Target metric is a small preset (5 values tied to `activityType` +
   "totalt"), not free text** (CB2) — the only way an automatically
   computed progress meter can exist at all, given `TrainingLogEntry`
   only ever records a duration in minutes, never a move/rep count. A
   coach's more colorful framing ("50 zorro-finter") stays in the
   free-text title/description; the tracked target is a minutes-based
   proxy against an activity type.
2. **Challenge progress is individual, not team-pooled** (Part 3 header)
   — argued at length above; the short version is that VM-Guld already
   owns the "one shared number" hook, and the pitch's own example reads
   as a per-player ask, not a pooled one.
3. **Challenges reuse `flame` for the individual meter, `ink` for
   buttons — no new color token** — an extension, not a violation, of
   the style guide's protected flame-vs-gold split; recommended as a
   follow-up note to `style-guide.md` rather than treated as fixed here.
4. **No per-player ranked leaderboard, on either the coach's challenge
   detail (C3) or the player's card (CP1)** — only a plain completion
   count. Consistent with CLAUDE.md's "surprise badges, not just
   performance" framing and the project's explicit rejection of dark
   patterns; a named ranking is the kind of feature that's easy to add
   later and hard to walk back once it's shipped and a kid has seen
   where they rank.
5. **No "join a challenge" step** — every teammate is automatically
   eligible the moment a challenge is `active`, since `Challenge.teamId`
   already scopes it to the whole team; participation happens by tagging
   a log, not by enrolling.
6. **Editing is only possible while a challenge is `draft`; `active`
   challenges can only be cancelled, not edited** (C3) — prevents a coach
   from moving the target/dates on players mid-challenge without it
   reading as a cancel + a fresh start.
7. **Coach roster view (C2) shows `screenName`, never real name** —
   preserves the screen-name-first identity rule from CLAUDE.md even in
   a coach-only surface; nothing about consent-status or engagement
   tracking requires breaking that convention.
8. **Session-reissue action (C2) is only a UI trigger + confirmation
   copy here, not a designed mechanism** — the actual "how does a new
   session reach a kid's device without a password" question is a
   security/session-design call, flagged for architect +
   security-reviewer, not invented as a UI-only decision. Included
   because `ACTION_PLAN.md` explicitly ties the carried-over
   180-day-JWT/no-revocation gap to "the Phase 2 coach dashboard."
9. **Time-remaining shown as a plain date, not a countdown/urgency
   banner** (CP1) — matches the same no-guilt-trip, no-manufactured-
   urgency principle already applied to the streak state (O7) in Phase 1.
10. **Coach login/auth is explicitly out of scope of this doc** — the
    dashboard assumes a coach session already exists; how a coach
    authenticates (email+password, magic link, etc.) is a backend/
    architect decision this doc deliberately doesn't pre-empt.

---

## Notes for architect/backend-developer (informal sketch, not a contract)

Not a fixed API contract like `phase1-contract.md` — Phase 2 doesn't have
one yet, per the task. Shapes below are this doc's best guess at what the
screens above need, meant as a starting point for architect to formalize,
not something to build against verbatim.

- `GET /api/v1/coach/teams/:teamId/dashboard` — roster counts by
  `ParentalConsentStatus`, the team's active `TeamSeasonPot` fields (same
  shape as `GET /players/me`'s `teamPool`), a 7-day engagement count, and
  challenge counts by `ChallengeStatus`. One call, mirroring Phase 1's
  "no extra round-trip" principle.
- `GET /api/v1/coach/teams/:teamId/roster` — per player: `screenName`,
  `avatarId`, `consentStatus`, `lastTrainedDate` (nullable). No real name.
- `POST /api/v1/coach/challenges` / `PATCH /api/v1/coach/challenges/:id` —
  standard CRUD against the existing `Challenge` entity; `PATCH` should
  reject target/date changes once `status !== 'draft'` (see judgment call
  6), and reject any transition except `draft→active`, `active→completed`,
  `active→cancelled` (no un-cancelling, no skipping back to draft).
- `GET /api/v1/players/me/challenges` — per active/completed team
  challenge: the challenge fields, this player's own progress (sum of
  `TrainingLogEntry.durationMinutes` where `challengeId` matches,
  filtered by `activityType` unless the metric is `total-minuter`), and a
  team-wide `completedCount`/`rosterCount` pair. Coach-only completion
  detail (`GET /api/v1/coach/challenges/:id`) is the same aggregate,
  reused rather than duplicated.
- `POST /api/v1/training-logs` (existing Phase 1 endpoint) — no shape
  change needed; `challengeId` already exists as an optional field per
  `phase1-contract.md`. Backend-developer's job is validating that a
  submitted `challengeId` is actually `active`, belongs to the player's
  team, and is metric-compatible with the submitted `activityType` —
  rejecting silently-mismatched tags rather than trusting the client.
- Consent-reminder resend and session-reissue (C2) are **new** endpoints
  with real security implications (who can trigger sending a credential
  to a child's parent or device, rate limiting, audit logging) — flagged
  for architect + security-reviewer, not assumed free to add.
