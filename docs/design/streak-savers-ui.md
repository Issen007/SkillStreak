# Streak savers — client UI (badge, gap banner, celebration)

Scope: the three client-UI pieces `docs/adr/0024-streak-savers.md`'s
hand-off note assigns to ux-designer — the banked-saver badge on the
streak card, the pending-gap banner, and the one-time "streak saved!"
celebration — plus the exact Swedish/English copy and component-tree
placement needed to implement them. **Design only, no backend change**:
the backend is already merged (`ccad2a3`, `90efa09`) and confirmed by
reading `backend/src/players/players.controller.ts` and
`backend/src/training-logs/training-logs.service.ts` directly, not just
inferred from the ADR's prose (see §0 — the ADR's own Decision 3 text
undersells one real backend behavior this design depends on). Written for
**frontend-developer** to implement against `mobile/src/home/`.

**Read first:** `mobile/src/home/components/StreakCard.tsx` (today's
badge-free card this design extends), `mobile/src/home/components/
GoalBonusTakeover.tsx` and `mobile/src/home/components/SuccessOverlay.tsx`
(the two existing celebratory-moment patterns this design reuses rather
than reinventing), `mobile/src/home/components/WaitingCard.tsx` (the
existing "persistent contextual banner, no dismiss control" pattern the
gap banner follows), `mobile/src/home/HomeScreen.tsx` (owns the
`goalBonus`/success-moment precedence chain and the local `me`-state patch
after a training-log POST — both need small additions), `mobile/src/theme/
colors.ts` (token conventions — `flame`/`gold` motif split,
`goldText`-style "safe as text on white" derived tokens), and
`mobile/src/i18n/locales/sv/home.json` + `en/home.json` (key structure and
the codebase's existing "no plural forms, count always paired with a
plural-form noun" simplification, which this design follows rather than
introducing new i18n machinery).

---

## 0. What the backend actually returns (confirmed by reading the code)

`GET /api/v1/players/me` — `PlayersController.getMe`
(`backend/src/players/players.controller.ts` lines ~125–176):

```ts
const hasOpenGap =
  !alreadyLoggedToday &&
  player.lastTrainedDate !== null &&
  player.lastTrainedDate !== yesterday;

pendingStreakGap = hasOpenGap
  ? { missedDayCount, coverableWithBankedSavers: preview.streakSaversSpent > 0 }
  : null;
```

**This matters for the design:** `pendingStreakGap` is non-null for
**any** open gap of 1+ missed days, whether or not it's coverable —
`coverableWithBankedSavers` is what actually distinguishes the two cases.
ADR-0024's Decision 3 prose only narrates the coverable case ("shown ...
whenever ... the missed-day count is still within the banked balance"),
which reads as if the too-large case simply never surfaces the field —
but the real implementation clearly returns it either way, and the ADR's
own API sketch already types `coverableWithBankedSavers` as a `boolean`
that would be pointless if it were always `true`. **This design treats
both as real, reachable states** (§2 covers both), which is the resolution
the ADR hands off to ux-designer to make.

`POST /api/v1/training-logs` — `TrainingLogsService.logTraining`
(`backend/src/training-logs/training-logs.service.ts` lines ~31–33,
193–195) confirms the exact response field name this design's celebration
trigger (§3) depends on: **`streak.streakSaverSpent`** (singular — the
response field; the internal `computeStreakUpdate` result field is
`streakSaversSpent`, plural, but that's an internal/backend-only name).
`streak.bankedStreakSaverCount` (post-transaction balance) and
`streak.currentStreakCount` are both on the same response, so the
celebration (§3) needs no extra round-trip.

**Client type gap, flagged for frontend-developer:** `mobile/src/api/
types.ts`'s `PlayerMeResponse.streak` and `TrainingLogResponse.streak` do
not yet have `bankedStreakSaverCount` / `pendingStreakGap` /
`streakSaverSpent` / `streakSaverEarned` — the backend ships them, the
mobile client types just haven't caught up. Adding these four fields is a
prerequisite for everything below, not a separate task.

---

## 1. Banked-saver badge — `StreakCard`

**Always visible whenever the streak card renders** (i.e. whenever
`isApproved` is true in `HomeScreen.tsx` — same condition that already
picks `StreakCard` over `WaitingCard`), showing the current
`bankedStreakSaverCount` (0–4). Lives inline inside `StreakCard.tsx`, the
same way `checkChip` (the existing "Loggat idag ✓" pill) is inline rather
than a separate component — this is its sibling, not a new pattern.

**New prop:** `StreakCardProps.bankedStreakSaverCount: number`.

**Placement:** a second absolute-positioned corner pill, mirroring
`checkChip` but on the opposite corner so the two can never collide even
when both are shown at once (`alreadyLoggedToday` + a nonzero banked
count are unrelated and can co-occur):

```
saverBadge: {
  position: 'absolute',
  bottom: -10,
  right: -4,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 3,
  paddingVertical: 4,
  paddingHorizontal: 10,
  borderRadius: 999,
}
```

**Two visual states — this is a deliberate design call, not an oversight:**
the badge is *always rendered* (per the ADR's own instruction), but a
count of `0` must never read as "you failed at something." Rather than
hide the badge at `0` (which would contradict "always visible") or show a
bare unstyled "0" (which reads as a deficit), it gets a visually
*recessive*, not negative, treatment:

| State | Fill | Border | Icon | Text |
|---|---|---|---|---|
| `count > 0` — "protected" | `colors.white` | none | 🛡️ full opacity | bold, `colors.flameText` (**new token**, see below) |
| `count === 0` — "not yet earned" | `rgba(255,255,255,0.22)` | `1pt rgba(255,255,255,0.55)` | 🛡️ at `opacity: 0.75` | bold, `colors.white` at `opacity: 0.85` |

Content: `🛡️ {{count}}` — icon plus bare digit, deliberately **no text
label** on the pill itself (a translated word here risks the same
i18n string-length problem `clip-library-grid.md` flagged for its own
corner badges — a digit is language-agnostic). The full explanation lives
in the accessibility label and, optionally, the info sheet below.

**New color token needed** (`mobile/src/theme/colors.ts`), following the
exact precedent `goldText` already sets ("a darker gold-family tone usable
as *text* on white ... distinct from `gold` itself, which stays fill-only"):

```ts
/** A darker flame-family tone usable as *text* on white (e.g. the
 * banked-saver badge's count) — distinct from `flame` itself, which
 * stays fill-only per the contrast rule. Same role as `goldText`, for
 * the individual-streak motif instead of the team one. */
flameText: '#B84A1E',
```

**Accessibility label** (`accessibilityLabel` on the badge's `Pressable`,
not visible text):

| Key | Swedish | English |
|---|---|---|
| `streakCard.saverBadgeA11y` (`{{count}}`) | "Du har {{count}} sparade dagar. De skyddar din streak om du missar en träningsdag." | "You have {{count}} saved days. They protect your streak if you miss a training day." |
| `streakCard.saverBadgeA11yZero` | "Du har inga sparade dagar än. Träna 7 dagar i rad så får du en!" | "You don't have any saved days yet. Train 7 days in a row to earn one!" |

Terminology note: this design calls the mechanic **"sparade dagar"**
("saved days") in all player-facing copy, not a literal translation of
"streak saver" — concrete and self-explanatory for a 9–13-year-old without
needing the badge/sheet to define a new piece of jargon first. Kept
consistent across §1–§3.

### Recommended addition: tap → `SaverInfoSheet` (not mandatory, cheap to add)

The ADR's hand-off note leaves a "history screen" as an optional
not-needed-for-v1 nice-to-have. A full history screen isn't needed, but a
one-tap explainer costs nothing extra (all the data it needs —
`bankedStreakSaverCount` — is already on the badge) and directly serves
Decision 2's own reasoning ("agency ... satisfied by visibility"): a kid
who notices the badge and taps it should get an answer, not a dead end.

**New component**, `mobile/src/home/components/SaverInfoSheet.tsx` — a
small bottom sheet, same RN `Modal` primitive/pattern as `ActivitySheet`/
`ClipDeleteSheet`. Wrap the badge in a `Pressable` (`hitSlop: 10` — the
visible pill is small, the tap target shouldn't be) that opens it.

| Key | Swedish | English |
|---|---|---|
| `saverInfoSheet.heading` | "Vad är sparade dagar?" | "What are saved days?" |
| `saverInfoSheet.bodyHasSavers` (`{{count}}`) | "Du har {{count}} sparade dagar. Missar du en träningsdag använder vi automatiskt en sparad dag så din streak fortsätter. Du får en ny sparad dag för varje 7 dagar du tränar i rad, upp till 4 stycken." | "You have {{count}} saved days. If you miss a training day, we automatically use one to keep your streak going. You earn a new saved day every 7 days you train in a row, up to 4." |
| `saverInfoSheet.bodyNoSavers` | "Du har inga sparade dagar än. Träna 7 dagar i rad så får du din första! Den skyddar din streak om du någon gång missar en dag." | "You don't have any saved days yet. Train 7 days in a row to earn your first one! It protects your streak if you ever miss a day." |
| `saverInfoSheet.close` | "Okej!" | "Got it!" |

No new endpoint, no new fetch — `bankedStreakSaverCount` is already in
scope wherever `StreakCard` renders.

---

## 2. Pending-gap banner — new `StreakGapBanner`

**New component**, `mobile/src/home/components/StreakGapBanner.tsx`.
Rendered in `HomeScreen.tsx`'s `content` block directly **below
`StreakCard`, above `TrainedButton`** — visually tied to the streak it's
about, and positioned right before the one button that actually resolves
it, keeping the "one tap deep" loop intact (the banner itself carries no
CTA of its own; `TrainedButton` right underneath is the CTA).

```
{isApproved ? (
  <>
    <StreakCard ... bankedStreakSaverCount={me.streak.bankedStreakSaverCount} />
    {me.streak.pendingStreakGap ? (
      <StreakGapBanner
        missedDayCount={me.streak.pendingStreakGap.missedDayCount}
        coverableWithBankedSavers={me.streak.pendingStreakGap.coverableWithBankedSavers}
        longestStreakCount={me.streak.longestStreakCount}
      />
    ) : null}
  </>
) : ( <WaitingCard ... /> )}
```

Only rendered when approved (same gate as `StreakCard` itself — a paused/
waiting player has no streak to protect yet) and only while
`pendingStreakGap` is non-null. **Persistent, no dismiss control** — same
posture as `WaitingCard`: it reflects a real, currently-true state and
disappears on its own the moment that state changes (the player logs
training), not on a tap.

### 2.1 — Coverable (`coverableWithBankedSavers: true`)

Reassuring, forward-nudging, per ADR Decision 3.1's own copy direction.
Reuses **existing** tokens — no new colors needed here:
`backgroundColor: colors.flameTint`, `borderColor: colors.flame` (the
`flameTint` token's own comment already anticipates exactly this pairing:
"paired with `flame` border").

```
┌─────────────────────────────────────────┐
│  🛡️  Din streak är skyddad!              │
│  Du missade 2 dagar, men det är okej —   │
│  vi använder 2 sparade dagar automatiskt │
│  så streaken fortsätter. Logga din       │
│  träning idag!                           │
└─────────────────────────────────────────┘
```

| Key | Swedish | English |
|---|---|---|
| `streakGapBanner.coverable.headline` | "Din streak är skyddad! 🛡️" | "Your streak is protected! 🛡️" |
| `streakGapBanner.coverable.body` (`{{missedDayCount}}` used twice) | "Du missade {{missedDayCount}} dagar, men det är okej — vi använder {{missedDayCount}} sparade dagar automatiskt så streaken fortsätter. Logga din träning idag!" | "You missed {{missedDayCount}} days, but that's okay — we're using {{missedDayCount}} saved days automatically so your streak continues. Log your training today!" |

The number is stated plainly here (both instances) — in the coverable
case it's genuinely good news ("only 2, and it's handled"), so naming it
reinforces reassurance rather than undermining it.

### 2.2 — Not coverable (`coverableWithBankedSavers: false`) — the edge case the ADR left open

**This is the judgment call the ADR explicitly hands to ux-designer.**
Resolution: **a visually and tonally distinct third state**, not a scarier
version of §2.1 and not silence. Two things this must never do, given the
audience: (a) imply savers are covering the gap when they aren't (that's
actively misleading, and it's the thing "the streak resets anyway and the
kid feels tricked" complaints would be about), and (b) frame the reset as
a failure, countdown, or loss.

**Design:** drop the shield/"protected" framing entirely (it would be a
false promise) and reframe forward, using the one genuinely reassuring
fact this response already carries for free — `longestStreakCount`
(`me.streak.longestStreakCount`, no new API field needed) — never gets
erased by a reset, so naming it gives the player something concrete to
hold onto instead of a bare "you lost your streak."

**New color tokens** (`colors.ts`) — deliberately *not* reusing
`pendingBg`/`pendingBorder` or `pausedBg`/`pausedBorder`: this repo's own
convention (see `tipBg`/`tipBorder`'s comment) is a new token pair per new
*meaning*, even when the visual weight is similar, so an unrelated future
change to "waiting for consent" styling can't accidentally reskin this
too:

```ts
/** "Fresh start" banner fill + border — the not-coverable branch of the
 * pending-streak-gap banner (docs/design/streak-savers-ui.md §2.2).
 * Deliberately its own calm, desaturated green-neutral — distinct from
 * `success` (a saturated confirmation-only fill) and from
 * `pendingBg`/`pausedBg` (a different meaning: waiting/blocked, not
 * "nothing to wait for, just start again"). */
freshStartBg: '#F1F7F1',
freshStartBorder: '#CFE3CF',
```

```
┌─────────────────────────────────────────┐
│  🌱  Dags för en nystart!                │
│  Det var ett tag sedan sist — helt okej! │
│  Logga din träning idag så börjar en ny  │
│  streak. Ditt rekord på 14 dagar finns   │
│  kvar för alltid. 💪                     │
└─────────────────────────────────────────┘
```

| Key | Swedish | English |
|---|---|---|
| `streakGapBanner.tooLarge.headline` | "Dags för en nystart! 🌱" | "Time for a fresh start! 🌱" |
| `streakGapBanner.tooLarge.body` (`{{longestStreakCount}}`) | "Det var ett tag sedan sist — helt okej! Logga din träning idag så börjar en ny streak. Ditt rekord på {{longestStreakCount}} dagar finns kvar för alltid. 💪" | "It's been a while — totally okay! Log your training today to start a new streak. Your record of {{longestStreakCount}} days stays yours forever. 💪" |

**Deliberately omits `missedDayCount` from the copy** in this branch —
unlike §2.1, here the number is not good news, and a raw "you missed 11
days" reads as a scoreboard of shame with no offsetting reassurance. The
banner is still honest about *what's about to happen* (a new streak
starts today) without quantifying the miss. `missedDayCount` stays
available on the prop/response for anyone who wants it later (e.g. a
coach-facing view), just not surfaced in this child-facing copy.

**Icon: 🌱 (seedling), not 🛡️** — reusing the shield here, even
dimmed, would still visually associate this state with "protected,"
which is exactly the false impression to avoid.

---

## 3. "Streak saved!" celebration — new `StreakSaverCelebration`

**Trigger:** the training-log POST response whose `streak.streakSaverSpent
> 0` (§0 confirms this is the real, singular field name on
`TrainingLogResponse`). Exactly once — it fires from that one API
response, not from any polled/derived state, so there's no risk of it
re-appearing on a later `me` fetch.

**New component**, `mobile/src/home/components/StreakSaverCelebration.tsx`
— modeled directly on `GoalBonusTakeover.tsx` (per the task's own
instruction to reuse that pattern, not invent a new one): same full-width
absolute-positioned takeover at the top of `content`, same animation
timing verbatim (`260ms` fade+spring in, `3150ms` hold, `300ms` fade out,
fully auto-dismissing, no tap-to-close), same four-line structure (icon,
headline, sub, a bolded detail line). The one thing that changes is the
color and the words: **`colors.flame`, not `colors.gold`** — this is
purely an individual-streak event, and the app's own style-guide color
split (flame = "mine", gold = "ours") already exists precisely to keep
that distinction legible at a glance. White text throughout, same
contrast rule as `GoalBonusTakeover`.

```
┌─────────────────────────────────────────┐
│              🛡️🔥                        │
│        Din streak är räddad!             │
│  Du var borta ett tag, men dina sparade  │
│  dagar täckte det automatiskt.           │
│  🔥 9 dagar i rad — 1 sparad dag kvar    │
└─────────────────────────────────────────┘
```

**Props:** `currentStreakCount` and `bankedStreakSaverCount`, both read
straight off the same training-log response (`response.streak
.currentStreakCount`, `response.streak.bankedStreakSaverCount` — no
extra fetch, matching `GoalBonusTakeover`'s own `awardedPoints` prop
pulling from the same response it's triggered by).

| Key | Swedish | English |
|---|---|---|
| `streakSaverCelebration.headline` | "Din streak är räddad!" | "Your streak is saved!" |
| `streakSaverCelebration.sub` | "Du var borta ett tag, men dina sparade dagar täckte det automatiskt." | "You were away for a bit, but your saved days covered it automatically." |
| `streakSaverCelebration.detail` (`{{currentStreakCount}}`, `{{bankedStreakSaverCount}}`) | "🔥 {{currentStreakCount}} dagar i rad — {{bankedStreakSaverCount}} sparade dagar kvar" | "🔥 {{currentStreakCount}} days in a row — {{bankedStreakSaverCount}} saved days left" |

### 3.1 — Precedence in `HomeScreen.handleSubmitLog`

Extends the existing `goalBonus` → first-log (H5) → extra-log (H6)
if/else chain in `handleSubmitLog` with one new branch, inserted **second**
(after `goalBonus`, before H5/H6):

```ts
if (response.goalBonus) {
  // existing G2 takeover — unchanged, still wins outright
} else if (response.streak.streakSaverSpent > 0) {
  setStreakSaverMoment({
    currentStreakCount: response.streak.currentStreakCount,
    bankedStreakSaverCount: response.streak.bankedStreakSaverCount,
  });
} else if (response.streak.alreadyLoggedToday === false) {
  // existing H5 SuccessOverlay
} else {
  // existing H6 extra-log toast
}
```

Wired into the same mutually-exclusive overlay ternary `HomeScreen.tsx`
already uses for `goalBonusMoment`/`successMoment`, with
`streakSaverMoment` as a third branch between them.

**Why `goalBonus` still wins outright** (kept from the existing code,
not changed): the rare case where a saver-bridged log is *also* the log
that crosses the team's weekly goal is possible but genuinely rare, and
`goalBonus` is already established in this codebase as the
highest-priority moment ("deliberately supersedes H5/H6 entirely"). Losing
the individual celebration in that one overlapping case is an acceptable,
explicitly-flagged trade — nothing about the spend is actually hidden:
the badge (§1) already reflects the new, lower `bankedStreakSaverCount`
the instant the player next sees the streak card, which is the same
"visible after the fact even without an in-the-moment prompt" reasoning
ADR-0024 Decision 2 already applies to the spend itself.

### 3.2 — Required local-state patch fixes in `HomeScreen.tsx`

Two small, easy-to-miss additions to the existing `setMe(prev => ...)`
patch inside `handleSubmitLog` (today it only copies
`currentStreakCount`/`longestStreakCount`/`alreadyLoggedToday`):

1. **Also copy `bankedStreakSaverCount`** into `prev.streak` — otherwise
   the badge (§1) shows a stale count until the next full `me` fetch
   (app foreground), even though the number the player should see updated
   immediately (spent or earned) already came back on this very response.
2. **Explicitly set `pendingStreakGap: null`** on every successful log —
   today's patch doesn't touch this field at all, so without this fix the
   gap banner (§2) would keep rendering with stale (now-resolved)
   `missedDayCount`/`coverableWithBankedSavers` values after the very log
   that resolved it, which would look broken (a "we'll cover this"
   reassurance still showing after it's already been covered, or a
   "fresh start" banner still showing after the fresh start already
   happened).

Both are cheap (values already on the response or trivially `null`), but
neither happens today without this being called out explicitly, since
neither field exists on `TrainingLogResponse` today (`bankedStreakSaverCount`
is copied; `pendingStreakGap` has no equivalent on that response at all —
it's just always cleared to `null`, which is always correct, since a
successful log by definition just resolved whatever gap existed).

### Out of scope, flagged not silently dropped

- **No separate "you earned a new saved day!" moment** — the task's three
  deliverables don't ask for one, and ADR-0024 Decision 1 already frames
  earning as low-key/no-special-handling even at the cap. The badge (§1)
  updating is the only signal, which is consistent with the mechanic's
  overall "silent but never invisible" design already established for the
  *spend* side by Decision 2. Flagging this as a considered omission, not
  an oversight, in case a future pass wants a small "+1 🛡️" toast on the
  7-day milestone — cheap to add later, reusing this same `Toast`
  component, no new backend field needed (`streakSaverEarned` already
  exists on the response).

---

## 4. Component boundaries — what's new vs. changed vs. reused

| Component | Status |
|---|---|
| `mobile/src/home/components/StreakCard.tsx` | **Changed.** New `bankedStreakSaverCount` prop, new inline badge (§1), optionally wrapped in a `Pressable` opening `SaverInfoSheet`. |
| `mobile/src/home/components/SaverInfoSheet.tsx` (new, recommended) | Small bottom sheet, §1's explainer copy. Same `Modal` pattern as `ActivitySheet`. |
| `mobile/src/home/components/StreakGapBanner.tsx` (new) | §2's two-variant banner. Takes `missedDayCount`, `coverableWithBankedSavers`, `longestStreakCount`. |
| `mobile/src/home/components/StreakSaverCelebration.tsx` (new) | §3's takeover, modeled on `GoalBonusTakeover.tsx`. Takes `currentStreakCount`, `bankedStreakSaverCount`. |
| `mobile/src/home/components/GoalBonusTakeover.tsx` | **Unchanged.** Still the highest-priority overlay (§3.1). |
| `mobile/src/home/HomeScreen.tsx` | **Changed.** New `streakSaverMoment` state + overlay branch; `handleSubmitLog`'s precedence chain and local `me`-state patch both need the additions in §3.1/§3.2; `StreakGapBanner` inserted into the `isApproved` render branch (§2). |
| `mobile/src/api/types.ts` | **Changed.** Add `bankedStreakSaverCount`/`pendingStreakGap` to `PlayerMeResponse.streak`; add `bankedStreakSaverCount`/`streakSaverSpent`/`streakSaverEarned` to `TrainingLogResponse.streak` (§0). |
| `mobile/src/theme/colors.ts` | **Changed.** New tokens: `flameText`, `freshStartBg`, `freshStartBorder`. |
| `mobile/src/i18n/locales/sv/home.json` + `en/home.json` | **Changed.** New keys under `streakCard.*` (2), `saverInfoSheet.*` (4), `streakGapBanner.*` (4), `streakSaverCelebration.*` (3) — see §1–§3's tables. Other 6 locales get the same best-effort-AI-then-native-review pass the rest of `home.json` already uses (per `clip-library-grid.md`'s established convention for this repo). |

---

## 5. Explicit interaction/state checklist (for implementation + QA)

- [ ] `bankedStreakSaverCount = 0` — badge renders in the recessive/
      outline treatment, not hidden, not alarming.
- [ ] `bankedStreakSaverCount` 1–4 — badge renders in the "protected"
      white-pill treatment with the correct digit.
- [ ] Badge tap (if `SaverInfoSheet` is built) → correct body copy for
      zero vs. nonzero count.
- [ ] `pendingStreakGap: null` — no banner rendered, `StreakCard` sits
      directly above `TrainedButton` as today.
- [ ] `pendingStreakGap.coverableWithBankedSavers: true` — §2.1 banner:
      shield icon, `flameTint`/`flame` colors, states `missedDayCount`
      twice.
- [ ] `pendingStreakGap.coverableWithBankedSavers: false` — §2.2 banner:
      seedling icon, `freshStartBg`/`freshStartBorder` colors, states
      `longestStreakCount`, never states `missedDayCount`.
- [ ] Gap banner never rendered when `!isApproved` (waiting/paused
      players see `WaitingCard` only, same as today).
- [ ] Log training while a gap banner is showing (either variant) →
      banner disappears immediately on the response (§3.2's
      `pendingStreakGap: null` patch), regardless of which success/
      celebration moment follows.
- [ ] `POST /training-logs` response with `streakSaverSpent > 0` and no
      `goalBonus` → `StreakSaverCelebration` shows, auto-dismisses
      ~3.7s later, no manual close needed.
- [ ] `POST /training-logs` response with both `goalBonus` and
      `streakSaverSpent > 0` → `GoalBonusTakeover` shows instead (§3.1);
      badge (§1) still reflects the new balance on next render.
- [ ] `POST /training-logs` response with `streakSaverSpent > 0` →
      `StreakCard`'s badge updates to the new `bankedStreakSaverCount`
      immediately (§3.2's patch), not just after the next `me` fetch.
- [ ] `streakSaverEarned: true` on a response — no dedicated UI moment
      (intentional, §3's "out of scope" note); badge still updates.
- [ ] All new copy reads correctly with `{{count}}`/`{{missedDayCount}}`/
      `{{longestStreakCount}}` at both `1` and higher values — this
      design deliberately does not introduce i18next plural forms
      (`_one`/`_other`), following `streakCard.count`'s existing
      "{{count}} dagar" precedent, so no new i18n infra is needed here
      either.
