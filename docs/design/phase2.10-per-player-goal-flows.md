# Phase 2.10 Flows — Weekly goal, per-player completion

Status: draft, ux-designer-owned, for frontend-developer to build against.
Built directly against `docs/adr/0015-weekly-goal-per-player-completion.md`
("ADR-0015" below) — every screen/copy change here is driven by that ADR's
Decision 3 `PlayerGoalProgress`/`GoalProgressSummary` shape, not a sketch.
Read ADR-0015 first; this doc only designs the UX layer on top of it, per
its own explicit follow-up ask (Consequences, last bullet).

This **updates, not replaces**, `docs/design/phase2-flows.md` Part 3 (the
original team-wide `gold` meter) and its Part 2 (`KB1`–`KB4` goal builder).
Screen IDs continue that doc's scheme (`G`-prefix for the goal tab,
`K`-prefix for the "Laget" tab, `KB`-prefix for the builder) — this doc adds
`G1D` (new) and revises `G1`'s card, `K1`'s dashboard, and `KB2`/`KB4`
in place. `G2`/`G3` get copy-only revisions, noted where they change.

**Read this first if you're frontend-developer:** the component that
actually needs redesigning is `mobile/src/goal/components/GoalCard.tsx`
(reused by `mobile/src/goal/GoalScreen.tsx` — Screen G1 — and by
`mobile/src/goal/screens/KB4Review.tsx`'s live preview), plus a **new**
addition to `mobile/src/team/TeamScreen.tsx` (Screen K1), which currently
fetches `TeamDashboardResponse.weeklyGoal` but never renders it — see the
"Notes for frontend-developer" section at the end. The goal-builder step
that needs the unit toggle is `mobile/src/goal/screens/KB2TargetMetric.tsx`
and its shared preset table, `mobile/src/goal/types.ts`.

Companion mockup: `docs/design/phase2.10-mockup.html` (same phone-frame
pattern as the other `phaseN-mockup.html` files) — four illustrative
screens, not a full redraw.

---

## What's actually changing, in one paragraph

Today `GoalCard` shows one shared number: `{progressMinutes} / {targetValue}
minuter`, a team-wide *total*. Per ADR-0015, `targetValue` is now a
**per-player** target (every eligible player must individually reach it),
and the thing worth showing at a glance is **how many teammates are done**,
not a pooled minute count. That means: (1) the card's headline figure
changes from a minute-total to a "**X av Y lagkamrater klara**" completion
count, (2) a new, honest way to show the players who *aren't* counted this
week (`eligible: false`) without making the screen look broken, and (3) the
goal-builder needs a unit toggle, because "targetValue" can now mean
minutes *or* session count (ADR-0015 Decision 1's 10-value metric enum).

---

## Judgment call — one `GoalCard` component, shown in two places

ADR-0015 Decision 3 explicitly notes `DashboardResponse.weeklyGoal.current`
(Screen K1, the "Laget" tab) gains the same new fields as the `GET
.../weekly-goal` response (Screen G1, the "Mål" tab) "since the dashboard
is exactly where the per-teammate view needs to render." Today, `K1`
(`TeamScreen.tsx`) fetches `weeklyGoal` but doesn't render it at all — a
pre-existing gap, not something this pass is introducing.

**Decision: the redesigned compact `GoalCard` is added to both places,**
reusing the exact same component (no divergent "dashboard version" vs.
"goal-tab version"):

- **K1 ("Laget" tab)** — inserted between the consent chips/pending-joins
  section and the "Spelare i laget" list, so a player who never opens "Mål"
  still sees the weekly goal's status the moment they check the team. This
  is the "compact summary suitable for a dashboard card" the task asks for.
- **G1 ("Mål" tab)** — same card, same component, now the *primary* content
  of a tab whose whole purpose is this goal, with the captain's
  management actions below it (unchanged structure from `phase2-flows.md`).

Both entry points link to the same new detail screen (`G1D`, below) via an
identical "**Se vem som är klar →**" text link under the card — one
implementation, two doorways in, no duplicated logic. This also avoids a
second, riskier option (making the compact card itself list every
teammate's avatar inline) that would get visually noisy on `K1`, which
already carries the consent chips, a pending-joins card, the full
teammates list, the invite card, and the VM-Guld card — adding a dense
per-player breakdown directly there would bury it, not surface it.

---

## Component — `GoalCard`, redesigned

**Props needed (design-level, not a TS signature):** everything on
`GoalProgressSummary`/`DashboardCurrentGoal` per ADR-0015 Decision 3 —
`title`, `description`, `targetMetric`, `targetUnit`, `targetValue`,
`eligiblePlayerCount`, `completedPlayerCount`, `percentComplete`,
`goalMet`, `endDate` — plus an `onSeeDetail` callback and (KB4 only) an
`isPreview` flag, see below.

**Copy, top to bottom:**

- Eyebrow row: **"Veckans mål"** 🎯 — if `goalMet: true`, a chip to its
  right, unchanged from today: **"Nått! 🎉"**
- Sub-line, unchanged: **"Satt av lagets kapten"**
- Title + description — captain's copy, verbatim, unchanged
- **NEW headline figure**, replacing today's `{progressMinutes} /
  {targetValue} minuter`:
  - Normal case (`eligiblePlayerCount > 0`): **"{completedPlayerCount} av
    {eligiblePlayerCount} lagkamrater klara"**, bold, `goldText` color
  - **Vacuous-truth edge case** (`eligiblePlayerCount === 0` — ADR-0015's
    explicit guard, "0 of 0 must never evaluate as complete"): the
    headline figure is replaced entirely, not shown as "0 av 0 klara"
    (which reads as *solved*, the opposite of the truth): **"Ingen i laget
    kan tävla om det här målet just nu."** Same copy for every viewer
    (captain or not) — this isn't consent-adjacent detail, it's a plain
    team-wide fact. The progress bar renders as an empty, neutral-grey
    track in this state (not gold-at-zero, which would read as "0%
    achieved" rather than "not currently applicable").
- Progress bar — same visual treatment as today (`meter-track`/`meter-fill
  gold`), now driven by `percentComplete = completedPlayerCount /
  eligiblePlayerCount * 100` (already computed server-side per ADR-0015
  Decision 3 — the client never derives this itself)
- Metric chip — reworded to state the **per-player** target explicitly,
  since this is the single most important meaning change in the whole
  feature and the old chip's framing (implicitly a team total) would now
  be actively misleading: **"{icon} {metricLabel} · {targetValue}
  {unitLabel} var"** — e.g. "🏃 Löpning · 20 minuter var" or "🏑
  Teknik/övning · 3 pass var". ("var" = Swedish "each" — "20 minuter var"
  reads naturally as "20 minutes each," the same construction youth sports
  already uses for e.g. divvying up drill time.)
- End date, unchanged: **"Slutar {endDate}"**
- **NEW** text link, small, low visual weight (matches the existing "Se
  tidigare mål" link's weight): **"Se vem som är klar →"** → Screen `G1D`.
  Shown whenever a goal exists, regardless of `eligiblePlayerCount` (even
  in the vacuous-truth case — a captain especially may want to see *why*
  nobody's eligible, and a teammate can at least confirm they aren't
  imagining that the roster looks thin this week).

**`isPreview` mode (KB4 only)** — see KB4 section below; swaps the
headline figure and bar for a schematic, clearly-labeled placeholder
instead of a fabricated real count.

---

## Screen K1 — Laget (tab) — updated

Only the addition, everything else in `docs/design/phase2.6-2.7-flows.md`'s
K1 spec is unchanged.

**New card**, inserted directly after the pending-joins section (if shown)
and before "Spelare i laget" — a captain scanning K1 top-to-bottom sees
"who needs approving" first, then "is the team on track," then "who's on
the team," which matches the order those things become actionable:

- Rendered only when `dashboard.weeklyGoal.current` is non-null (i.e. an
  active or draft goal exists). **When null, the card is omitted
  entirely** — no empty-state placeholder here, since `K1` already isn't
  the goal's primary home; a curious player finds the proper empty state
  (**"Inget mål just nu"**) on the "Mål" tab already, and duplicating it
  here would be one more thing to read on an already-busy screen.
- The `GoalCard` component described above, fed from
  `dashboard.weeklyGoal.current` (which per ADR-0015 gains the same new
  fields as `GoalProgressSummary`, still omitting
  `createdByPlayerId`/`teamId`/`bonusPointsAwarded` per its existing
  field-inclusion policy — none of those are needed here anyway).
- Tapping **"Se vem som är klar →"** switches to the "Mål" tab, landing
  directly on Screen `G1D` (not `G1`'s card first) — same "switch tab and
  open a specific state" pattern K1's existing "Hantera veckans mål"
  shortcut already uses for captains, just available to every viewer now,
  not only captains.

**Next:** unchanged from the existing K1 spec, plus the new link above.

---

## Screen G1 — Veckans mål (tab) — updated

Only the card changes (per the `GoalCard` redesign above); the surrounding
screen — captain actions (`Avbryt målet`/`Redigera`/`Aktivera nu`/`+ Sätt
veckans mål`), the empty state, and "Se tidigare mål" — is unchanged from
`docs/design/phase2-flows.md`.

**One addition:** the new **"Se vem som är klar →"** link (part of
`GoalCard` itself) sits between the card and the captain-only action
block, so it reads as "more about this goal," not "a captain tool."

**Next:** "Se vem som är klar" → Screen `G1D`. Everything else unchanged.

---

## Screen G1D — Lagkompisarnas status (new)

**Trigger:** "Se vem som är klar →" from `GoalCard`, wherever it's shown
(K1 or G1).
**API:** no new call — `players[]` is already present on whichever
response fetched the card (`GET .../weekly-goal` for G1, `GET
.../dashboard` for K1); `G1D` is a client-side view state on top of
already-fetched data, same "view-state machine, not a new screen route"
pattern `GoalScreen.tsx` already uses for `'card' | 'builder' | 'history'`.

**Layout — three sections, each omitted entirely when its count is 0**
(same "chip is omitted when count is 0" convention as `ConsentChips`):

1. **"✅ Klara ({completedPlayerCount})"**
2. **"⏳ Inte klara än ({eligiblePlayerCount − completedPlayerCount})"**
3. **"➖ Inte med denna vecka ({players.length − eligiblePlayerCount})"**

Row order within each section: **roster order as returned by the API,
never re-sorted by progress amount.** This matters — sorting the "Inte
klara än" section by how close each player is to the target would turn a
completion checklist into a de facto ranking, which the carried-over rule
from `phase2-flows.md` explicitly rules out ("No per-player ranked
leaderboard anywhere — a plain completion/progress number, never a named
ranking").

**Row content, per section:**

- **Klara:** avatar + `screenName` (bold), a small green chip reusing
  `colors.success` (the app's existing "confirmation state" color, per
  `style-guide.md`'s contrast rule) — **"Klar ✓"**. No further detail
  needed; "done" doesn't need a number attached.
- **Inte klara än:** avatar + `screenName` (bold), a thin mini progress
  bar (own `progressValue / targetValue`, gold fill, purely visual — no
  numbers in the bar itself) under the name, with a small muted caption
  underneath giving the exact figure: **"{progressValue} av {targetValue}
  {unitLabel}"**. A short status word above the bar: **"Inte startat än"**
  (`progressValue === 0`) or **"På gång"** (`progressValue > 0`). This is a
  deliberate softening, not a data-hiding move — the exact number is still
  there, just visually de-emphasized (small, muted, secondary line) rather
  than the row's headline, matching this app's existing "no manufactured
  urgency, no exposing a kid's shortfall as the main event" posture (same
  spirit as the plain, non-countdown end-date line elsewhere in this app).
- **Inte med denna vecka:** avatar (dimmed, ~50% opacity) + `screenName`
  (muted color, not bold), a neutral grey pill: **"Inte med denna
  vecka"**. **Row content differs by viewer**, driven entirely by whether
  `exclusionReason` arrived as `null` (per ADR-0015 Decision 4's
  captain-only gate — the client never re-derives or guesses the real
  reason when it's null, it just renders less):

  | Viewer | Row shows |
  |---|---|
  | Captain, `exclusionReason: 'joined_after_start'` | Pill + small caption: **"Gick med efter att målet redan startat"** |
  | Captain, `exclusionReason: 'consent_pending'` | Pill + caption: **"Väntar på godkännande från förälder ⏳"** |
  | Captain, `exclusionReason: 'consent_revoked'` | Pill + caption: **"Pausad ⏸️"** (same word `RosterRow` already uses for this consent state, so a captain who's seen the roster screen recognizes it instantly) |
  | Captain, `exclusionReason: 'team_join_pending'` | Pill + caption: **"Väntar på att bli godkänd i laget ⏳"** (deliberately worded differently from the consent-pending caption above — a captain seeing both a `consent_pending` row and a `team_join_pending` row needs to tell "waiting on a parent" apart from "waiting on me to approve their join request," two different next actions) |
  | Non-captain, any reason (`exclusionReason: null`) | Pill only, **no caption at all** — not a placeholder, not "unknown reason," nothing. The row simply has one less line than a captain's view of the same row. This is the "reads sensibly either way" requirement: a non-captain never sees a broken-looking blank field, because there's no field-shaped gap in the layout to notice — the caption line doesn't exist for them, rather than existing-but-empty. |

  **Never shown to anyone:** which of the four reasons applies, when
  `exclusionReason` is `null`. No icon, no color-coding by reason, no
  "hover for details" — a non-captain teammate should not be able to infer
  "oh, that probably means Kalle's mid-consent" from a color or icon
  choice alone, only from the identical, reason-agnostic muted pill every
  excluded player gets from their point of view.

**Header:** **"Lagkompisarnas status"**, sub-line: the goal's own title,
e.g. **"för '{goal.title}'"** — so it's clear which goal this list belongs
to if a player got here from a history entry later (see "Notes" below on
why this screen doesn't need to handle history goals specially, but the
sub-line keeps it self-describing regardless).

**Next:** back gesture/link (**"Tillbaka"**, same `SecondaryLink` used
elsewhere in this flow) → whichever card (K1 or G1) the player came from.

---

## Screen KB2 — Sätt målet — redesigned for the unit toggle

Replaces `docs/design/phase2-flows.md`'s KB2 spec (and
`docs/design/phase2.6-2.7-flows.md`'s Fas 2.6c-era copy on the same
screen) wholesale — both the framing (team total → per-player target) and
the new unit choice change enough of this screen that a diff-in-place
would be harder to read than a fresh spec.

**Trigger:** title/description entered (KB1 → KB2), unchanged.
**API:** none yet — client-side form state, submitted whole at KB4,
unchanged.

**New: a unit toggle, above the metric-chip grid** — two side-by-side
pill buttons, single-select, same selected-state visual language as the
metric chips (`gold` border + light gold fill when selected):

- **"⏱️ Minuter"** (default selection — the more familiar/precise unit,
  and matches every existing goal's shape so an editing captain's `draft`
  reopens onto the unit it was already using)
- **"🔁 Antal pass"**

Small helper line under the toggle, shown only once (not per-chip, to
avoid repeating "pass" three times on one screen — the "minimal reading"
brief): **"Ett pass = en loggad träning, oavsett hur lång den var."**
Shown regardless of which unit is currently selected, so switching back
and forth doesn't make the helper text flicker in and out.

**Switching units resets the numeric target field.** A captain who typed
`60` while "Minuter" was selected, then taps "Antal pass," should not see
a leftover `60` carried over as if it meant 60 sessions — the field clears
and the placeholder changes to the new unit's example. This is a small,
deliberate guard against a nonsensical goal being created by muscle
memory, not an oversight; same posture as `KB1`'s validation-before-submit
pattern elsewhere in this builder.

**Metric chips** — same five activity types, same icons/labels, **unit
choice doesn't change which chip is shown, only which of the ten
`WeeklyGoalTargetMetric` values gets submitted** (per ADR-0015 Decision 1
— `fitness-minuter`/`fitness-pass` share one "Kondition 🏋️" chip, etc.):

| Chip (unchanged) | Icon | Value when "Minuter" selected | Value when "Antal pass" selected |
|---|---|---|---|
| Kondition | 🏋️ | `fitness-minuter` | `fitness-pass` |
| Teknik/övning | 🏑 | `drill-minuter` | `drill-pass` |
| Löpning | 🏃 | `running-minuter` | `running-pass` |
| Annat | ⭐ | `other-minuter` | `other-pass` |
| Totalt (alla typer) | 🎯 | `total-minuter` | `total-pass` |

**Copy, rewritten for the per-player meaning change (Decision 2 is the
whole point of this redesign — every string that implied "the team's
total" needs to say "each player" instead):**

- Heading, **changed**: ~~"Vad ska laget samla ihop — tillsammans?"~~ →
  **"Vad ska varje spelare klara den här veckan?"**
- Sub, **changed**: ~~"Vi räknar allas loggade träningstid, inte antal
  moves..."~~ → **"Varje spelare i laget behöver nå målet på egen hand —
  välj om det räknas i minuter eller pass, och vilken typ av träning som
  gäller."**
- Input label, **changed**: ~~"Mål (minuter, hela lagets summa)"~~ →
  **"Mål per spelare ({unitLabel})"** — e.g. "Mål per spelare (minuter)"
  or "Mål per spelare (pass)"
- Placeholder, **changed and now unit-dependent**, and — importantly —
  **much smaller than before**, since per-player weekly numbers are
  nowhere near old team-total examples like 600: **"T.ex. 20"** (minutes)
  / **"T.ex. 3"** (sessions)
- Helper text under the input, **inverted in meaning** — this used to warn
  against a per-player-sized number, now it needs to say the opposite:
  ~~"Det här är hela lagets totalsumma, inte per spelare."~~ →
  **"Det här är målet varje spelare behöver nå på egen hand — inte
  lagets totalsumma."**
- Live preview line, **changed** from team-pooled framing to individual
  framing: ~~"Laget försöker tillsammans samla {targetValue} minuter
  {metricLabel} innan målet slutar."~~ → **"Varje spelare i laget behöver
  samla {targetValue} {unitLabel} {metricLabel} innan målet slutar."**
- Primary button: **"Nästa"**, unchanged, disabled until a metric and a
  positive `targetValue` are set (unchanged rule).

**Next:** → KB3, unchanged.

---

## Screen KB4 — Granska och publicera — preview updated

**Trigger/API unchanged** from `docs/design/phase2-flows.md`.

**Judgment call — the live `GoalCard` preview can't show a real
completion count, so it shouldn't fake one.** `eligiblePlayerCount` is a
*live* roster query (ADR-0015 Decision 2) — at draft-review time, before
the goal is even active, showing a specific "0 av 6 lagkamrater klara"
would assert a number (`6`) the client has no reliable source for inside
the goal-builder flow itself (which never fetches the roster), and a wrong
guess here is worse than an honest placeholder.

**Decision:** `GoalCard` renders in `isPreview` mode for this screen only:

- Title, description, metric chip (**"{icon} {metricLabel} ·
  {targetValue} {unitLabel} var"**), and end date all render normally from
  the entered form data — these *are* known and accurate at review time.
- The headline completion figure and progress bar are replaced by a single
  muted caption, visually distinct (dashed border, same treatment as the
  existing `preview-callout` box) so it's unmistakably a preview, not a
  live number: **"Så här ser kortet ut när målet är aktivt — riktiga
  lagkamrater och vem som är klar visas då."**
- The **"Se vem som är klar →"** link is **not shown** in preview mode —
  there's nothing real to link to yet.

**Next:** unchanged — either publish action → success toast → back to
K1/G1, refreshed with the real card.

---

## Screens G2/G3 — bonus celebration copy, updated

The bonus mechanic itself (lump-sum payout, idempotency, one-time
per-triggering-log) is **unchanged** per ADR-0015 Decision 2 — only two
lines of copy need to shift because they described the old *pooled*
crossing event ("your log pushed the team over the line"), which no
longer matches how a goal gets met under the per-player model (every
eligible player individually crossed their own target; the triggering
log is often simply whichever player happened to be the *last* one
remaining, not necessarily a big final push).

- **G2** (triggering player's takeover), sub-line — **changed**:
  ~~"Din logg var den som knuffade laget över målet!"~~ → **"Din träning
  var den sista pusselbiten — nu har alla i laget klarat sitt mål!"**
  (headline **"Laget nådde veckans mål!"** and the bonus figure line are
  unchanged).
- **G3** (catch-up banner, everyone else), text — **changed** to credit
  the whole team rather than imply one big pooled push: ~~"🎉 Laget nådde
  veckans mål! Laget fick +{awardedPoints} bonuspoäng."~~ → **"🎉 Alla i
  laget klarade veckans mål! Laget fick +{awardedPoints} bonuspoäng."**

Everything else about G2/G3 (timing, auto-dismiss, the client-persisted
"last seen `bonusAwardedAt`" flag, `bonusPointsAwarded` being read
directly rather than derived) is unchanged from `docs/design/
phase2-flows.md`.

---

## Judgment calls made in this doc

1. **One `GoalCard` component, shown on both K1 and G1** — closes a
   pre-existing gap (K1 fetches `weeklyGoal` but never rendered it) rather
   than inventing a second, dashboard-specific card component.
2. **The compact card omits per-player detail entirely** (no inline
   avatars/pips) — `K1` is already a busy screen; per-player detail lives
   one tap away at `G1D` instead of competing for space on the dashboard.
3. **Vacuous-truth state (`eligiblePlayerCount: 0`) gets its own copy**,
   not "0 av 0 klara" — directly protects the ADR's own explicit
   correctness guard from reading as a false "solved" state in the UI.
4. **`G1D`'s "Inte klara än" rows show progress as a visual bar +
   de-emphasized exact number, not a bold headline fraction** — the exact
   figure stays genuinely visible (nothing's hidden), just styled down, to
   avoid the row reading as calling out a kid's shortfall.
5. **Roster order, never progress-sorted, in `G1D`** — sorting by
   closeness-to-target would recreate a ranking, which this app's
   carried-over rule already forbids.
6. **Excluded rows render a *shorter* layout for non-captains (no caption
   line) rather than a caption with placeholder/empty text** — avoids the
   row ever looking broken or like missing data to a non-captain viewer.
7. **`consent_pending` and `team_join_pending` get distinctly worded
   captions**, not a shared "waiting" phrase — a captain needs to tell
   "waiting on a parent" apart from "waiting on my own approval," since
   only the second one is something they can act on immediately.
8. **Switching the KB2 unit toggle clears the numeric target field** —
   prevents a minutes-scale number from silently becoming a nonsensical
   session-count target by muscle memory.
9. **KB4's live preview shows a labeled placeholder instead of a
   fabricated "0 av N" figure** — the goal-builder flow has no roster data
   to make that number honest, so it doesn't pretend to.
10. **G2/G3 copy updated to stop implying one big pooled "push," crediting
    the whole team completing individually instead** — the old phrasing
    described the pooled-total mechanic this ADR specifically replaces.

---

## Carried over unchanged from `phase2-flows.md`/`phase2.6-2.7-flows.md`

- Screen names, never real names, on every roster/goal surface.
- Time-remaining shown as a plain end date, never a countdown/urgency
  banner.
- `gold`, not `flame`, for this meter — still a shared/team-facing number,
  now counting completed players instead of pooled minutes, but still not
  the individual-streak motif.
- The bonus mechanic, its idempotency, and the split G2 (triggering
  player)/G3 (everyone else) celebration structure.
- Target metric stays a small preset, never free text (now 10 values
  instead of 5, per ADR-0015 Decision 1, but still not an open field —
  automatic progress computation is only possible from a bounded set).
- Editing a goal's target/dates/unit is only possible while `status:
  'draft'`; once `active`, only cancel is offered.

---

## Notes for frontend-developer / backend-developer

- **`TeamScreen.tsx` (K1) currently discards `TeamDashboardResponse.
  weeklyGoal`** — this pass is what finally needs it rendered; nothing
  else about the dashboard fetch changes.
- **`GoalCard.tsx`'s prop shape changes** from
  `{progressMinutes, targetValue, percentComplete, goalMet, targetMetric}`
  to the fields listed under "Component — `GoalCard`, redesigned" above —
  this is the same breaking-contract change ADR-0015 Decision 3 already
  flags for backend-developer/frontend-developer to ship in lockstep; this
  doc doesn't introduce a second breaking change, just designs the client
  side of the one the ADR already calls for.
- **No new endpoint or extra round-trip is introduced anywhere in this
  doc** — `G1D` reuses `players[]` off whichever response already loaded
  the card it was opened from.
- **`targetUnitLabel`/`targetMetricLabel` need a small shared lookup**
  (`'minutes' → 'minuter'`, `'sessions' → 'pass'`), mirroring the existing
  `targetMetricLabel` helper in `mobile/src/goal/types.ts` — keep it next
  to the existing `TARGET_METRIC_OPTIONS` table rather than inventing a
  second source of truth for metric labels.
- **i18n note:** none of the new copy above bakes in Swedish string
  length/grammar assumptions into fixed-width layout — the headline
  figure, the metric chip, and the exclusion captions are all rendered in
  flexible (`flexWrap`/`flexShrink`) rows already used elsewhere in this
  codebase, not fixed-pixel truncated text. "Pass" happens to be
  gender/number-invariant in Swedish (no singular/plural form needed) —
  don't assume that holds for other locales' session-count copy if/when
  this app gets translated; keep the unit label itself in a translatable
  slot rather than hardcoding "pass" into a shared string template.
