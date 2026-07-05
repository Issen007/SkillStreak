# Phase 2 Flows — Kapten, Veckans Mål & Session Reissue

Status: draft, ux-designer-owned, for frontend-developer to build against.
Built directly against `docs/api/phase2-contract.md` and
`docs/adr/0005-kapten-and-weekly-team-goal.md` — every screen below is
driven by a real request/response shape from that contract, not a sketch.

**This replaces the previous version of this document's Part 1 and Part 3
wholesale**, following the project owner's pivot away from a separate adult
"Coach" concept to a player-captain ("Kapten") who uses their existing
player account and session. See ADR-0005 and ADR-0004's 2026-07-05 addendum
for the full reasoning — short version: there is no coach login, no coach
dashboard as a separate app surface, and no per-player challenge progress.
A captain is a teammate with one extra flag (`is_captain`); the weekly goal
is a single team-wide target; the completion bonus is a one-time lump sum.
**Part 2 (the goal-builder wizard) is adapted, not replaced** — the old
CB1–CB4 structure holds up well, renamed `KB1`–`KB4` and reframed around a
team-wide target instead of a per-player one. **Part 4 is new** — the
player-facing "lost your session?" redemption screen (ADR-0004 Part 3),
never designed in UI terms until now.

Same format as `docs/design/phase1-flows.md`: **Trigger** / **API** /
**Copy** / **Next** per screen, judgment calls flagged inline and
summarized at the end. Visual language is `docs/design/style-guide.md`.

Companion static mockup: `docs/design/phase2-mockup.html` (same phone-frame
pattern as `phase1-mockup.html`) — rebuilt from scratch for this pivot, not
edited in place, since almost every screen it showed is superseded.

**Platform note, corrected:** there is no separate coach-authenticated app
mode. Every screen below lives inside the ordinary player app, on the
ordinary player session (`Authorization: Bearer <playerSessionToken>`,
same `JwtAuthGuard` as Phase 1). A captain sees a few extra
buttons/sections, gated client-side on `viewerIsCaptain` (from
`GET /teams/:teamId/dashboard` and `GET /teams/:teamId/weekly-goal`) and
enforced server-side by the service-layer captain check — never a
different app shell, different navigation stack, or different login step.

---

## Judgment call — where the captain surface lives

The task leaves this open: an extra tab, or a button inside an existing
one. **Decision: no new tab — captain-only content is folded into the
existing "Laget" tab** (already reserved in the Phase 1 tab-bar mockup,
previously unbuilt).

Reasoning:
- The tab bar already has four slots (Hem / Utmaningar / Laget / Profil).
  A fifth tab that only ~1-in-15 players (one captain per team) ever sees
  populated would be dead chrome for everyone else, or would have to
  appear/disappear per-viewer — a more surprising, harder-to-explain
  navigation change than a section inside a tab that already exists for
  everyone.
- "Laget" ("the team") is already the semantically correct home for
  roster/team-management content regardless of who's looking at it — a
  non-captain plausibly wants *some* team-facing screen too (even if
  Phase 2 only gives them an aggregate view), so the tab isn't
  captain-exclusive in concept, just captain-*extended* in content. That
  matches the brief's instruction almost exactly: "an extra tab/button
  visible only when `viewerIsCaptain` is true... not a separate app mode."
- The **"Utmaningar" tab is renamed "Mål"** ("goal") for this phase — it
  used to imply a list of challenges; now there's exactly one team-wide
  goal at a time, and "Mål" reads correctly whether a goal is currently
  active or not. This is a copy-only change (icon 🎯 stays), flagged as
  a judgment call below since `ADR-0005` explicitly keeps `challengeId`
  dormant for a possible future *individual* challenge feature — if that
  ever ships, the tab may need to go back to a list view and a plural
  label; not a concern for Phase 2.

---

## Part 1 — Kapten: roster, consent, and session reissue

### Screen K1 — Laget (tab, every player — captain sees more)

**Trigger:** tapping the **"Laget"** tab.
**API:** `GET /api/v1/teams/:teamId/dashboard` — open to any team member,
not captain-gated (per the contract, "nothing here is sensitive beyond
what the roster view separately protects").

**Baseline content, shown to every player:**
- Heading: **"Laget"** 👥
- Aggregate chips (a chip is omitted if its count is 0, same rule as the
  old coach dashboard had): **"{approvedCount} godkända ✓"**,
  **"{pendingCount} väntar ⏳"**, **"{revokedCount} pausade ⏸️"** — counts
  only, no names; this is deliberately the *most* team-management detail a
  non-captain ever sees, and it's non-identifying.
- The same VM-Guld gold meter already shown on the home screen
  (`teamPool.pointsTotal`/`goalThreshold`/`percentComplete`) — repeated
  here rather than assumed-remembered, since "Laget" is a plausible place
  a curious kid checks team progress from, independent of the home screen.

**Captain-only addition** (`viewerIsCaptain: true`), a distinct card below
the baseline content, not blended into it — so a captain always knows
which parts of the screen are "everyone's view" vs. "my extra tools":
- Small header row: **"👑 Du är kapten"** (a light, one-time-per-visit
  badge of role, not a persistent nag — see judgment call below on why
  this is worth showing at all)
- Button: **"Se laget i detalj"** → Screen K2
- Button: **"Hantera veckans mål"** → Screen G1 in its captain-editable
  state (Part 3) — a captain's goal-management entry point lives with the
  goal card itself, not duplicated here; this button is a shortcut, not a
  second copy of that screen.

**Next:** "Se laget i detalj" → K2. "Hantera veckans mål" → G1
(captain view). Tab switch → home tab, unaffected.

---

### Screen K2 — Kaptenens laglista (full roster detail)

**Trigger:** "Se laget i detalj" from K1. **Captain-only** — a non-captain
who somehow reaches this route (e.g. a stale deep link) gets bounced back
to K1 with a quiet toast, not a broken screen: **"Den här sidan är bara
för lagets kapten."**
**API:** `GET /api/v1/teams/:teamId/roster` (`403 not_team_captain`
otherwise — the client shouldn't need to hit this to know, since K1
already only shows the entry button when `viewerIsCaptain`, but the
service-layer check is the real gate, not this button's visibility).

Unchanged in substance from the old coach-only roster screen — the *data*
was never coach-specific, only who could see it:

Per row:
- Avatar emoji + `screenName` — **never real name**, same rule as always.
- Consent status chip: **"Godkänd ✓"** / **"Väntar ⏳"** / **"Pausad ⏸️"**
  / **"Inte skickad än"**.
- Muted sub-line: **"Senast loggade: {date}"** or **"Har inte loggat än"**.

Row tap → action sheet, two actions:
- **"Skicka påminnelse till förälder"** (only for `pending` rows) →
  `POST /players/:playerId/consent-reminder` → confirmation toast:
  **"Påminnelse skickad."** `409 consent_not_pending` (race: status
  changed between opening the sheet and tapping) → toast: **"Den här
  spelaren väntar inte längre på godkännande."**, row refreshes in place.
- **"Visa inloggningskod"** (shown for any row — renamed from the old
  "Skicka ny inloggningslänk," see judgment call below on why) → a confirm
  step first, **not** an immediate call, since this action has a real
  side effect the moment it's confirmed (it invalidates the teammate's
  current session immediately, whether or not the code is ever used):
  - Confirm sheet copy: **"Visa ny kod till {screenName}?"** Sub:
    **"Det här loggar ut dem på alla enheter direkt. Visa koden bara om du
    har {screenName} framför dig just nu."** Buttons: **"Avbryt"** /
    **"Ja, visa koden"**.
  - Confirmed → `POST /players/:playerId/session-reissue` → Screen K3.

**Next:** back gesture → K1.

---

### Screen K3 — Ny kod till lagkompis

**Trigger:** confirmed "Visa koden" from K2.
**API response used:** `{ reissueCode, expiresAt }`.

This is the screen ADR-0004 Part 3 flagged as needing UI attention: the
code is **displayed**, never "sent" through any other channel — the
copy must not imply an email/push happened, because none does.

Copy:
- Heading: **"Ny kod till {screenName}"**
- Large, monospace, high-contrast code display, grouped in two blocks of
  four for readability (e.g. **"H4K7 QWXP"**) — same human-typable,
  no-ambiguous-characters format ADR-0004 specifies (no `0`/`O`,
  `1`/`I`/`l`); the grouping is a display-only affordance, not part of
  the code itself.
- Sub, instructional: **"Visa den här för {screenName} så de kan skriva in
  den och logga in igen."**
- Info line, plain fact not urgency styling (same no-manufactured-urgency
  principle as everywhere else in this app — this is operational
  information the captain needs, not a countdown aimed at a child):
  **"Koden går att använda en gång, fram till {expiresAt as a clock
  time}."**
- Confirming note, so the captain isn't left wondering whether the old
  session is still live: **"Deras gamla inloggning slutade fungera direkt
  när du visade koden."**
- Primary button: **"Klar"** → back to K2, roster row unchanged (the
  roster view has no "reissue pending" state to show — the code's
  lifecycle is entirely between this screen and the teammate's device).

**Next:** "Klar" → K2.

---

## Part 2 — Kaptenens verktyg: bygg veckans mål

Adapted from the old CB1–CB4 challenge builder — the four-step
title/description → target → dates → review shape holds up unchanged; what
changes is the framing (team-wide, not per-player) and one new guard rail
(the one-active-goal-per-team constraint).

**Entry:** "Hantera veckans mål" (K1) or "Skapa nytt mål" (Screen G1, Part
3, when the team has no current goal) → **KB1**. Editing an existing
`draft` (from G1's captain view) re-opens **KB1–KB3** pre-filled, same as
before.

### Screen KB1 — Titel och beskrivning

**Trigger:** entry above.
**API:** none yet — client-side form state, submitted with KB4.

Copy:
- Heading: **"Sätt lagets mål för veckan"**
- Sub: **"Ge det ett kul namn — det här är vad hela laget ser."**
- Input label: **"Titel"**, placeholder: **"T.ex.
  Zorro-finter-utmaningen"**
- Input label: **"Beskrivning"** (multi-line), placeholder: **"T.ex. Gör så
  många zorro-finter ni kan tillsammans innan fredag!"**
- Primary button (disabled until title is non-empty): **"Nästa"**

**Next:** → KB2.

---

### Screen KB2 — Sätt målet

**Trigger:** title/description entered.
**API:** none yet.

Same fixed five-value `targetMetric` preset as before (unchanged
reasoning — progress can only be computed automatically from logged
minutes, never a free-text move count), copy reframed from "each player"
to "the team, together":

| Chip (Swedish label) | Icon | `targetMetric` value |
|---|---|---|
| Kondition | 🏋️ | `fitness-minuter` |
| Teknik/övning | 🏑 | `drill-minuter` |
| Löpning | 🏃 | `running-minuter` |
| Annat | ⭐ | `other-minuter` |
| Totalt (alla typer) | 🎯 | `total-minuter` |

Copy:
- Heading: **"Vad ska laget samla ihop — tillsammans?"**
- Sub: **"Vi räknar allas loggade träningstid, inte antal moves — så välj
  den typ av träning som passar bäst."**
- Metric chips: as table above, single-select
- Input label: **"Mål (minuter, hela lagets summa)"**, numeric stepper,
  placeholder **"T.ex. 600"** — the helper text under the input makes the
  team-wide scale explicit, since a captain might otherwise reflexively
  type a per-player-sized number: **"Det här är hela lagets totalsumma,
  inte per spelare."**
- Live preview line: **"Laget försöker tillsammans samla {targetValue}
  minuter {metricLabel} innan målet slutar."**
- Primary button (disabled until a metric and a positive `targetValue` are
  set): **"Nästa"**

**Next:** → KB3.

---

### Screen KB3 — Start- och slutdatum

Unchanged from the old CB3 — team-wide framing doesn't affect date
pickers.

**Trigger:** metric + target value set.
**API:** none yet.

Copy:
- Heading: **"När börjar och slutar veckans mål?"**
- Two date pickers: **"Startdatum"** (defaults to today), **"Slutdatum"**
  (defaults to +7 days)
- Inline validation if end ≤ start: **"Slutdatum måste vara efter
  startdatum."**
- Primary button: **"Nästa"**

**Next:** → KB4.

---

### Screen KB4 — Granska och publicera

**Trigger:** dates set.
**API:** submitting calls either:
- `POST /api/v1/teams/:teamId/weekly-goal` with `status: "draft"`
  (**"Spara som utkast"**), or
- the same endpoint with `status: "active"` (**"Aktivera nu"**) — a single
  call, not create-then-activate.

If this is an edit of an existing `draft`, the same screen instead calls
`PATCH /api/v1/teams/:teamId/weekly-goal/:id`.

**New guard, preemptive rather than error-only:** because the client
already knows (from K1/G1's last fetch) whether the team currently has an
`active` goal, **"Aktivera nu" is disabled outright** — not just left to
fail — when one already exists, with an inline explanation rather than a
dead button: **"Ni har redan ett aktivt mål. Det här sparas som utkast tills
det är klart, eller tills du avbryter det andra."** Only **"Spara som
utkast"** stays enabled in that case. This is a UX nicety on top of, not a
replacement for, the server-side `409 active_goal_already_exists` — if the
client's cached state is stale (e.g. the same captain activated a
different draft moments earlier from a second device), the request can
still fail server-side; the fallback error state re-fetches the current
active goal and shows the same inline explanation.

Layout: a live preview of the exact card every teammate will see (Screen
G1's card, rendered inline) above the two action buttons.

Copy:
- Heading: **"Så här ser det ut för laget"**
- [Goal-card preview — see G1, gold meter, 0% filled]
- Secondary button: **"Spara som utkast"**
- Primary button: **"Aktivera nu"** (disabled per the guard above, with
  its inline explanation shown in place of the button when disabled)

**Next:** either action → success toast (**"Målet är sparat!"** /
**"Målet är aktiverat — laget ser det nu."**) → back to K1/G1, refreshed.

**Edge case — more than one `draft` exists:** the dashboard/goal endpoints
only surface *one* "current" goal (the active one, or else the most
recent draft). If a captain has drafted more than one candidate goal
before picking a favorite, only the newest is reachable from G1/K1
directly. **Judgment call:** add a small text link, shown only when this
situation is detected (i.e. never for the common one-draft-or-none case):
**"Se andra utkast ({n})"** → a simple flat list, title + "Utkast" pill per
row, tap → KB1 pre-filled for that draft. Not designed as its own numbered
screen here since it's a rare, low-stakes list, not a flow — flagged for
frontend-developer to build as a simple reuse of existing list-row styles.

---

## Part 3 — Player-facing team goal card & the bonus celebration

### Judgment call — team-wide progress, `gold` not `flame`

This supersedes the previous version's "individual progress, `flame`"
decision entirely — not a refinement, a reversal, because ADR-0005 made
the progress model itself team-wide, not a re-interpretation of the same
data. The goal card now shows **one shared number**, structurally the same
kind of meter as VM-Guld, so it reuses **`gold`**, not `flame`. `flame`
stays reserved for the individual streak, exactly per the style guide's
protected split — a team-wide meter using `flame` would be the actual
violation of that rule, not a stylistic preference.

**Distinguishing the goal meter from the VM-Guld meter** (both are now
gold, both are team-wide, and both live one tab-swipe apart from each
other): the goal card is visually *lighter weight* — smaller card, no
gradient hero treatment — and carries its own framing line ("Veckans mål",
a name, a description, an end date) that VM-Guld's card never has (VM-Guld
is a season-long number with no author and no end date). The two aren't
meant to be confused: VM-Guld is the destination, the weekly goal is a
short-lived sub-target that happens to pay into the same pot when cleared
— see ADR-0005's own "two different timescales of the same pot" framing,
now reflected visually as "two gold meters that look related, but the
Home tab's is the big one and the Mål tab's is the small one," not two
visually identical cards a kid can't tell apart at a glance.

### Judgment call — who set it, shown without a name

The task asks for "who set it (not by name necessarily, just that it's
'veckans mål')". **Decision: no name at all** — the card's own label
("Veckans mål") and a plain sub-line (**"Satt av lagets kapten"**) are
enough to answer "where did this come from" without surfacing which
specific teammate set it. This is a deliberate, small privacy-minimizing
choice beyond what's strictly required (the captain's `screenName` is
already visible to every teammate via other surfaces, so this isn't
closing an actual leak) — it just keeps the goal card's framing about the
*team's* target, not about one kid's authorship, which fits the
"team-wide, not individual" spirit of the whole feature.

---

### Screen G1 — Veckans mål (tab, renamed from "Utmaningar")

**Trigger:** tapping the **"Mål"** tab.
**API:** `GET /api/v1/teams/:teamId/weekly-goal`.

**Baseline card, every player:**
- Heading: **"Veckans mål"** 🎯, sub-line: **"Satt av lagets kapten"**
- Title + description (captain's copy, verbatim)
- Gold meter: **"{progressMinutes} / {targetValue} minuter"**,
  `percentComplete` drives fill width
- Plain end-date line, no countdown/urgency styling (unchanged rule from
  the old CP1's "Slutar {date}", still correct here): **"Slutar
  {endDate}"**
- If `goalMet: true` (whether or not this device has "seen" the bonus
  moment yet — see G3): a small **"Nått! 🎉"** chip, meter shown full.

**Captain-only addition** (`viewerIsCaptain: true`), status-dependent:
- `active` → secondary, low-emphasis button: **"Avbryt målet"** (→
  `PATCH .../weekly-goal/:id { status: "cancelled" }`, with a confirm
  step: **"Avbryta '{title}'? Loggad träning påverkas inte, men den räknas
  inte längre mot ett mål."**)
- `draft` → **"Redigera"** (→ KB1, pre-filled) and **"Aktivera nu"** (same
  preemptive-disable rule as KB4 if a different goal is already active)
- No goal at all (`goal: null`) → primary button: **"+ Sätt veckans mål"**
  → KB1

**Empty state, non-captain** (`goal: null`): friendly placeholder, not a
blank tab — **"Inget mål just nu"**, sub: **"Er kapten sätter snart ett
nytt mål för laget!"**

**"Tidigare mål" section**, below the current card, small text link:
**"Se tidigare mål"** → `GET .../weekly-goal/history`, a flat list (title,
status pill `Avslutad`/`Avbruten`, dates) — same "handful of items, no
pagination" scale assumption as the rest of this app.

**Next:** no further navigation from the baseline view — progress updates
automatically as any teammate logs training elsewhere, same "check-in
view, not a flow" pattern as the old CP1.

---

### Screen G2 — "Laget nådde sitt mål!" (the triggering player's moment)

**Trigger:** `201` response from `POST /training-logs` where
`goalBonus !== null` — this player's log is the one that crossed the
threshold.
**API:** `POST /api/v1/training-logs` response (`teamPool`, `goalBonus`).

This is deliberately bigger and different from H5 (the personal
first-log-of-the-day moment) — it's a **team** achievement this one
player happened to trigger, not a personal one, and the copy is careful
not to overclaim credit (the team did this together; this log was just
the one that happened to tip it over):

Sequence (~3.5–4s total, longer than H5's ~2.5s given how rare and
significant this is, still fully auto-dismissing — no tap required to
close, per the same "celebrate and release" principle as H5):
1. If this log was *also* the day's first (streak moved): the streak
   card's number ticks up quietly in the background, same small animation
   as H5 — but **subordinate** to what follows, not the headline moment
   this time.
2. A gold, full-width takeover card slides in above the fold (bigger than
   H5's banner strip, since this is the rarer, bigger moment):
   - Icon: 🏆🎉
   - Headline: **"Laget nådde veckans mål!"**
   - Sub, crediting the team while acknowledging this player's role
     without claiming sole credit: **"Din logg var den som knuffade laget
     över målet!"**
   - Big bonus figure: **"+{awardedPoints} bonuspoäng till lagets pott!
     🥇"**
3. The VM-Guld meter (home tab, and this player's next visit to the Mål
   tab) animates to its new, bonus-inclusive `percentComplete` in the same
   motion the ordinary per-log increment already uses — no separate
   "watch the bonus land" animation on a meter the player isn't currently
   looking at.
4. Takeover fades after ~3.5s; screen settles into the ordinary
   already-logged-today state (H3-equivalent), reflecting the new
   `teamPool.pointsTotal`.

**Next:** auto-dismiss → ordinary post-log home state. No further action
needed — same "no lingering modal" rule as H5, just a longer, bigger
version of it proportional to how much rarer this moment is.

---

### Screen G3 — Catch-up moment for every other player

**This is the part the API doesn't hand the client for free — the goal
bonus fires once, inside one player's `POST /training-logs` response, and
every teammate finds out "cold" the next time they open the app, with no
dedicated "you missed this" flag anywhere in the contract.**

**Judgment call:** persist a small piece of local client state — the last
`bonusAwardedAt` (from `GET .../weekly-goal`'s `bonusAwardedAt` field) the
device has already shown a catch-up moment for, keyed by goal `id`, in the
same local storage the app already uses for session state. On any app
open/foreground where the fetched goal's `bonusAwardedAt` is non-null and
different from (or absent from) the locally stored value:

1. Show a **single, low-key gold banner** — not a takeover, this player
   didn't just do anything, the moment shouldn't perform as if they did:
   **"🎉 Laget nådde veckans mål! Laget fick +{awardedPoints}
   bonuspoäng."** (`awardedPoints` here comes from the goal's own record —
   see note below on where this number lives for a non-triggering viewer.)
2. Banner sits at the top of whichever tab is open (most likely Home, via
   the ordinary `GET /players/me` foreground refresh) for ~3s or until
   dismissed by tapping elsewhere, then disappears for good — the local
   flag is set immediately on first display, not on dismissal, so a kid
   who backgrounds the app mid-banner never sees it twice.
3. The **"Mål" tab gets a small notification dot** (reusing the existing
   `tab-dot` pattern already in the style guide/mockup) until the catch-up
   banner has been shown once — a quiet "something happened here" nudge,
   not a red badge count or urgency device.

**Where `awardedPoints` comes from for a non-triggering viewer — resolved
2026-07-05:** the contract's `goalBonus` field only ever appeared in the
*triggering* player's `POST /training-logs` response. A client-side
derivation (`5 + targetValue`) was considered and **rejected as
inaccurate**: ADR-0005's real formula is `5 + progress-at-crossing-time`,
and progress at the moment of crossing almost always *exceeds*
`targetValue` (the crossing log's minutes essentially never land exactly on
the threshold) — deriving from `targetValue` would systematically
undercount. **Resolved instead by persisting the real value**:
backend-developer added `goalBonusPointsAwarded` alongside
`goalBonusAwardedAt` on the goal record, set together in the same
transaction, and exposed on `GET .../weekly-goal`/`.../weekly-goal/history`
— use that field directly, don't re-derive it client-side.

**Next:** banner auto-dismisses; goal card (G1) already reflects the
`goalMet`/`bonusAwardedAt` state permanently, so nothing further is needed
after this one-time moment.

---

## Part 4 — Tappad inloggning? (session reissue, player side)

New for this pivot — ADR-0004 Part 3's mechanism, never designed in UI
terms until now. The caller of the *triggering* action changed (a captain,
not a coach — see Part 1), but this redemption screen itself is unaffected
by that change; it's simply new.

### Judgment call — entry point

Per the task's own suggestion, this hangs off **Screen O1** ("Ange
lagkod"), since a player with no valid session already lands there (per
`AppRoot`'s routing logic — no session token means the onboarding stack,
not the home screen). A small secondary text link below O1's primary
button, low visual weight so it doesn't compete with the much more common
"I'm new here" path:

- **"Har du redan ett konto men tappat inloggningen?"** → Screen R1

This is deliberately *not* offered as a prominent option — most people
hitting O1 are onboarding for the first time, not recovering a lost
session, and the copy should read as an escape hatch for the minority
case, not a coin-flip choice presented with equal weight.

### Screen R1 — Ange koden från din kapten

**Trigger:** tapping the link above.
**API:** submitting calls
`POST /api/v1/players/session/redeem { code }` (no auth — same
unauthenticated-by-necessity category as `POST /players`).

Layout: single large input, auto-uppercase, no autocorrect, grouped in two
blocks of four as the kid types (matching K3's display grouping, so what
they're shown and what they type visually match) — 8 characters total, no
keyboard suggestions/autofill interference.

Copy:
- Heading: **"Har du tappat inloggningen?"**
- Sub: **"Be din kapten visa dig koden på sin skärm och skriv in den
  här."**
- Input label: **"Kod"**, placeholder: **"T.ex. H4K7 QWXP"**
- Primary button (disabled until 8 characters are entered): **"Logga in
  igen"**

**Next:**
- **`200`** (`{ playerId, sessionToken }`) → store token in SecureStore,
  same mechanism `POST /players` already uses → Screen R2.
- **`invalid_or_expired_code`** — generic, no hint whether the code was
  wrong, expired, or already used, per the contract's deliberate
  ambiguity (don't let a kid's retry strategy leak which case it was):
  inline error under the input, input cleared for a fresh attempt (a
  code this short-lived is unlikely to be worth preserving for editing):
  **"Den koden fungerar inte. Be din kapten om en ny kod."**
- **`429`** (rate-limited, mirroring the existing `@Throttle` pattern on
  other unauthenticated endpoints): **"För många försök. Vänta en liten
  stund och testa igen."**

---

### Screen R2 — Klart!

**Trigger:** `200` from the redeem call.
**API response fields used:** `sessionToken` (already stored).

A short confirmation, same pattern as O6 — one beat to register "this
worked" before landing back in the ordinary app:

Copy:
- Icon: ✅
- Heading: **"Klart! Du är inloggad igen."**
- Primary button: **"Fortsätt"**

**Next:** tap → navigates into the app shell exactly as a fresh
`POST /players` success would (home screen, `GET /players/me`-driven
state) — no special "welcome back" distinction needed beyond this one
screen; the player's actual data (streak, team pool, goal) is unchanged,
only the session credential is new.

---

## Judgment calls made in this doc (flagging, not silently deciding)

1. **Captain surface lives inside the existing "Laget" tab, not a new
   tab** — reasoning in the header judgment call above; avoids dead
   chrome for the ~14-in-15 non-captain players on a typical team.
2. **"Utmaningar" tab renamed "Mål"** — reads correctly now that there's
   exactly one team-wide goal, not a list; would need revisiting (back to
   a list/plural label) only if a future *individual* challenge feature
   revives the dormant `challengeId` field.
3. **Weekly-goal progress meter uses `gold`, not `flame`** — a reversal,
   not a refinement, of the previous version's individual-progress
   decision, forced by ADR-0005's team-wide progress model. The goal
   card is deliberately visually *lighter* than the VM-Guld card so the
   two gold meters (season-long pot vs. short-lived sub-goal) stay
   distinguishable at a glance.
4. **Who set the goal is shown without a name** ("Satt av lagets kapten")
   — not strictly required (the captain's `screenName` is visible via
   other surfaces already) but keeps the card's framing about the team's
   target, not one kid's authorship.
5. **"Visa inloggningskod" requires an explicit confirm step before the
   call fires** — the side effect (invalidating the teammate's session)
   happens the instant the captain confirms, not "sent," so the copy
   warns about that irreversible-until-redeemed effect before it happens,
   not after.
6. **The reissue code is a *displayed* screen (K3), never framed as
   "sent"** — corrects the old doc's carried-over copy ("Ny länk
   skickad"), which implied a channel (email/push) that doesn't exist;
   the mechanism is "shown on the captain's own screen, relayed in
   person."
7. **"Aktivera nu" is preemptively disabled, not just left to 409, when a
   different goal is already active** (KB4) — the client already has the
   information needed to avoid the dead-end tap; the server-side `409` is
   kept as the real enforcement, this is only a UX nicety layered on top.
8. **Multiple simultaneous drafts get a minimal fallback list, not a
   dedicated screen** — a rare, low-stakes case (`GET`/dashboard only
   surface one "current" draft); a plain text link + flat list is enough,
   not worth a numbered flow of its own.
9. **The bonus celebration is split by role, not shown identically to
   everyone** — the triggering player gets a bigger, in-the-moment,
   team-crediting takeover (G2); every other player gets a small, one-time
   "catch-up" banner on next open (G3), using a **client-persisted "last
   seen `bonusAwardedAt`" flag**, since the contract has no server-side
   "has this player seen the bonus" state — that part stays client-only,
   deliberately. **The `awardedPoints` value itself is not derived
   client-side** (an initial proposal to compute it as `5 + targetValue`
   was checked against ADR-0005's actual formula and found to
   systematically undercount — see the resolved note above) — it's read
   directly from `goalBonusPointsAwarded` on the `GET .../weekly-goal`
   response, added specifically so this screen doesn't need to guess.
10. **Session-reissue redemption hangs off Screen O1 as a low-weight
    secondary link, not a prominent choice** — most players hitting O1
    are onboarding fresh, not recovering a session; the copy and visual
    weight reflect that this is the uncommon path.
11. **`invalid_or_expired_code` shown with fully generic copy, input
    cleared rather than preserved** — matches the contract's deliberate
    refusal to distinguish wrong/expired/used; a short-TTL code isn't
    worth preserving for a corrected retry anyway.
12. **A small "👑 Du är kapten" badge shown to the captain themself on
    K1** — a light, self-facing role confirmation (not shown to anyone
    else, not stored as a public "who's captain" callout beyond what the
    roster screen already implies) — a small nicety, not required by the
    contract, easy to cut if frontend-developer/backend-developer would
    rather not build it for Phase 2.

### Carried over unchanged from the superseded version (still correct)

- Screen names, never real names, on every roster/goal surface.
- No per-player ranked leaderboard anywhere — a plain completion/progress
  number, never a named ranking.
- Time-remaining shown as a plain date, never a countdown/urgency banner.
- Target metric is a small preset (5 values tied to `activityType` +
  "totalt"), not free text — the only way an automatically computed
  progress meter can exist at all.
- Editing a goal's target/dates is only possible while `status: "draft"`;
  once `active`, only cancel is offered — prevents a captain from moving
  the goalposts mid-week (now doubly relevant, per ADR-0005, since a real
  point payout is on the line).

---

## Notes for backend-developer / architect (carried and updated)

- The client-side "last seen `bonusAwardedAt`" flag (judgment call 9) is a
  **local-only** concern (SecureStore/AsyncStorage), not a backend ask —
  noting it here only so backend-developer doesn't assume a missing
  server field needs adding for it to work.
- The `awardedPoints`-for-non-triggering-viewers question (also judgment
  call 9) is **resolved**: `goalBonusPointsAwarded` is a real field on the
  `GET .../weekly-goal` response now — use it directly, don't re-derive.
- Consent-reminder resend and session-reissue (K2/K3) are the two
  endpoints ADR-0005's Consequences flags for security-reviewer
  specifically because of the new child-captain-acting-on-a-teammate trust
  model — this doc's copy (the explicit confirm step before session
  reissue, the "you're about to log them out everywhere" warning) is
  written with that review in mind, not as a substitute for it.
