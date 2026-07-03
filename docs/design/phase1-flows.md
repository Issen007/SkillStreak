# Phase 1 Flows — Onboarding & Consent, and the Core "Jag har tränat" Loop

Status: draft, ux-designer-owned, for frontend-developer to build against.
Built directly against `docs/api/phase1-contract.md` (including ADR-0002's
2026-07-03 addendum) — every screen state below is driven by a real request/
response shape from that contract, and every `consentStatus` value the
contract defines has a corresponding screen state (see the mapping table in
Part 1). Visual starting point is `docs/design/home-screen-mockup.html`
(Phase 0.5) and `docs/design/style-guide.md` — this doc doesn't redesign the
visual identity, it extends it with real states.

Companion static mockup: `docs/design/phase1-mockup.html` (same phone-frame
pattern as the Phase 0.5 mockup), covering the states where a picture earns
its keep — see "Where a mockup exists" callouts below.

## How to read this document

- Each screen/state has: **Trigger** (what causes it to show), **API**
  (the call and response fields it's driven by), **Copy** (real Swedish
  strings, not placeholders), and **Next** (what advances the flow).
- Copy is written for translation, not hard-coded layout: no string is
  assumed to fit on one line, buttons wrap rather than truncate, and no
  layout depends on Swedish word order/length. Treat every Swedish string
  here as the *first* locale, not the *only* one.
- "Judgment call" callouts flag decisions the contract left open to
  ux-designer (e.g. exact avatar catalog, whose device collects parent
  contact) — flagged explicitly rather than silently baked in, per
  CLAUDE.md's "surface, don't silently pick" rule.

---

## Part 1 — Onboarding + Parental Consent Flow

### Screen O1 — Ange lagkod (enter team code)

**Trigger:** first app open, no `sessionToken` in SecureStore.
**API:** none yet — this screen only collects input. Submitting calls
`GET /api/v1/teams/invite/:inviteCode`.

Layout: single large text input (auto-uppercase, no autocorrect), one
primary button. No navigation chrome — this is the very first thing a kid
sees, it should feel like unlocking something, not filling out a form.

Copy:
- Heading: **"Vilket lag kör du för?"**
- Sub: **"Fråga din tränare om lagets kod."**
- Input placeholder: **"T.ex. FALKEN24"**
- Primary button: **"Hitta mitt lag"**

Error state (`404 invite_code_not_found`) — shown inline under the input,
input stays filled so the kid can just edit it:
- **"Vi hittade ingen lag med den koden. Dubbelkolla med din tränare!"**

(Deliberately generic per the contract's "doesn't hint whether a code is
close to valid" — the UI must not add its own hinting on top, e.g. no
"did you mean...".)

**Next:** `200` response → Screen O2, carrying `teamId`/`teamName` in
memory (not yet persisted — nothing's created server-side yet).

---

### Screen O2 — Bekräfta lag (team preview confirmation)

**Trigger:** `200` from `GET /teams/invite/:inviteCode`.
**API:** none (read-only preview, already fetched).

This is the confirmation gate before any personal data is collected — it
exists so a kid who fat-fingered a *valid but wrong* code (e.g. a
neighboring team's) sees the name and can back out before proceeding.

Copy:
- Heading: **"Ansluter du till {teamName}?"** (e.g. "Ansluter du till IBK
  Falken P13?")
- Sub: **"Stämmer det, så kör vi!"**
- Primary button: **"Ja, det är mitt lag!"**
- Secondary button (text-style, low visual weight): **"Nej, testa en
  annan kod"** → back to O1, input cleared.

**Next:** primary tap → Screen O3.

---

### Screen O3 — Välj ditt spelarnamn och din avatar

**Trigger:** confirmed team from O2.
**API:** none yet (client-side form state) — validated server-side at
final submit (O5→`POST /players`); a duplicate name only surfaces as a
409 at that point, since there's no "check availability" endpoint in this
contract. See error handling below for how that's surfaced without making
the kid re-enter everything.

Copy:
- Heading: **"Välj ditt spelarnamn"**
- Sub: **"Det här är namnet ditt lag ser — inte ditt riktiga namn om du
  inte vill."**
- Input label: **"Spelarnamn"**, placeholder: **"T.ex. FloorballStar15"**
- Avatar picker label: **"Välj en avatar"**
- Below the grid, small helper text: **"Ingen bild behövs — välj en
  figur du gillar."**

**Judgment call — avatar catalog:** the contract only fixes `avatarId` as
a string; the actual catalog is backend-owned seed data. Proposing a
starter set of 12 kid-friendly, sport-neutral animal/character emoji so
frontend-developer has something concrete to build the grid against
(4×3, all equal size, no "cooler" option visually favored):

| `avatarId` | Emoji | | `avatarId` | Emoji | | `avatarId` | Emoji |
|---|---|---|---|---|---|---|---|
| `fox` | 🦊 | | `wolf` | 🐺 | | `owl` | 🦉 |
| `lion` | 🦁 | | `bear` | 🐻 | | `eagle` | 🦅 |
| `tiger` | 🐯 | | `shark` | 🦈 | | `dragon` | 🐉 |
| `panda` | 🐼 | | `unicorn` | 🦄 | | `robot` | 🤖 |

**Next:** "Nästa" button (disabled until both a name is typed and an
avatar is picked) → Screen O4.

---

### Screen O4 — Vilket år är du född?

**Trigger:** name + avatar chosen.
**API:** none yet (still client-side; `birthYear` submitted with
`POST /players` at O6).

Deliberately asks for **year only**, matching ADR-0002 — a big scrollable
year-wheel or a grid of the last ~12 years, not a full date-of-birth
picker (which would both over-collect and read as a "grown-up form").

Copy:
- Heading: **"Vilket år är du född?"**
- Sub: **"Vi använder det för att anpassa utmaningar till din ålder."**
- Primary button: **"Nästa"**

Validation (`400`, surfaced only if it somehow slips past a sane
client-side range check, e.g. picker bug): **"Hmm, det året ser inte
rätt ut. Testa igen."**

**Next:** → Screen O5.

---

### Screen O5 — Vi frågar en vuxen om lov

**Trigger:** birth year set.
**API:** none yet (still collecting input); submitting here is what
triggers `POST /players`.

This is the framing screen the task calls out specifically: it must read
as "we are about to ask your parent something," not as an anonymous form
field. The screen explains *why* before it asks *what*.

Copy:
- Heading: **"Vi frågar en vuxen om lov"**
- Body (two short lines, not a wall of text):
  **"Innan du kan börja logga träningar behöver en förälder eller
  vårdnadshavare säga ja."**
  **"Vi skickar dem en snabb fråga — de godkänner med ett klick."**
- Input label: **"Förälders eller vårdnadshavares e-post eller
  mobilnummer"**
- Helper text under the input (small, muted): **"Vi använder det bara
  för att fråga om lov — inget annat."**
- Primary button: **"Skicka förfrågan"**

**Judgment call — whose device fills this in:** the contract leaves this
open ("coach-facilitated ... exact UX is ux-designer's call"). Designing
for the realistic Phase 1 case — a coach walking a phone/tablet around at
practice, one kid at a time — rather than assuming every kid has their
own phone with them: the copy above is written to work either way (it
addresses the player directly, "vi frågar en vuxen", not "ange
kontaktuppgifter"), and a small line is added specifically for the coach
handing the device over:
- Tiny helper row below the button, muted/small text: **"Tränare: hjälp
  spelaren fylla i om de är osäkra på uppgifterna."**

This keeps the primary copy kid-facing (per the "minimal reading, big
targets" brief) while not pretending an adult isn't usually present for
this specific step.

**Next:** primary tap → `POST /api/v1/players` with
`{ inviteCode, screenName, avatarId, birthYear, parentContact }`.

- **`201`** → Screen O6.
- **`409 screen_name_taken_in_team`** → stay on this screen's flow but
  jump back to O3 with the name field pre-focused and an inline error:
  **"Det namnet är upptaget i laget — testa ett annat!"** (avatar, birth
  year, and parent contact stay filled; only the name needs to change).
- **`404 invite_code_not_found`** (edge case: code became invalid between
  O1 and now, e.g. a coach retired it) → back to O1 with: **"Lagkoden
  fungerar inte längre. Fråga din tränare om en ny kod."**

---

### Screen O6 — Klart! Vi har frågat

**Trigger:** `201` from `POST /players`.
**API response fields used:** `sessionToken` (stored in Expo SecureStore
immediately), `consentStatus` ("pending"), `screenName`, `avatarId`.

A short, single confirmation screen — not the home screen yet — so the
"what happens next" message actually gets read once, rather than being
buried under the home screen's other content on first load.

Copy:
- Big check/wave icon (no photo, matches the no-photo identity rule)
- Heading: **"Klart, {screenName}!"**
- Body: **"Vi har skickat en fråga till en förälder eller
  vårdnadshavare. Så fort de säger ja kan du börja logga träningar och
  tjäna poäng till laget."**
- Primary button: **"Nu kör vi"**

**Next:** tap → navigates into the app shell, home screen, which
immediately renders the waiting-for-approval state (Screen O7) because
`consentStatus` is `"pending"`.

---

### Screen O7 — Waiting-for-approval state (home screen)

**This is not an edge case — it is the expected state for every player
between onboarding and parent approval**, per ADR-0002's addendum and the
contract's explicit note to ux-designer. Every session between account
creation and approval renders this, potentially for days.

**Trigger:** `GET /players/me` (on app open/foreground) returns
`player.consentStatus` as anything other than `"approved"`.
**API:** `GET /api/v1/players/me`.

Layout: replaces the streak card + CTA area of the home screen (team pool
card and tab bar stay visible and functional — a waiting player can still
see the team's shared progress, since that's motivating and isn't gated
by consent). The badges row is omitted entirely for a brand-new player
rather than showing an empty placeholder (nothing to show yet; adding it
back once a badge exists is a later, non-consent-related concern).

Because the contract defines four `consentStatus` values, the banner has
three copy variants (not_requested and pending share one, since they're
both "nothing to do but wait" from the player's point of view — the
distinction between them is a backend/audit concern, not a UI one):

| `consentStatus` | Banner variant | Icon | Headline | Body |
|---|---|---|---|---|
| `not_requested` / `pending` | Waiting | ⏳ | **"Väntar på godkännande"** | **"Vi har frågat en förälder eller vårdnadshavare om lov. Så fort de säger ja låser vi upp knappen nedan!"** |
| `approved` | *(not this screen — see Part 2)* | | | |
| `revoked` | Paused | ⏸️ | **"Träning är pausad just nu"** | **"En förälder eller vårdnadshavare har dragit tillbaka godkännandet. Prata med din tränare om du har frågor."** |

Design notes:
- The CTA button itself is **not hidden**, it's visibly present but
  disabled/greyed, showing **"Jag har tränat"** in a muted style with a
  small lock icon — the kid should see the goal, just not be able to tap
  it yet, rather than the button vanishing (vanishing would read as "this
  feature is missing," not "you're waiting on something specific").
- A small secondary action under the banner: **"Kolla igen"** (manual
  refresh) — re-fires `GET /players/me` on tap, for the (common) case
  where a kid opens the app moments after telling a parent "just click
  the link," instead of only relying on the next natural foreground
  event. This doesn't replace the automatic poll-on-foreground from the
  contract, it supplements it for the impatient-9-year-old case.
- No streak-loss framing, no countdown, no "don't lose your streak"
  pressure — there's no streak yet to lose, and CLAUDE.md explicitly
  rules out guilt-trip framing aimed at children even where it would be
  "engaging."
- **Where a mockup exists:** this state is in `phase1-mockup.html`
  (`pending` variant).

**Next:** `consentStatus` flips to `"approved"` on a subsequent
`GET /players/me` (poll-on-foreground, or the manual "Kolla igen") → home
screen re-renders into Part 2's normal state. No screen transition
animation needed beyond the banner/CTA simply being replaced — this
already happens "next time you open the app," which is itself a small
reward moment for a returning kid.

---

### Edge case — tapping "Jag har tränat" with stale/incorrect local state

Per the contract, the client disables the button using `consentStatus`,
but the server is the actual enforcement point and can return
`403 consent_required` even if local state says `approved` (e.g. state
went stale while the app was backgrounded and consent was later revoked,
or a race between two rapid taps).

**Trigger:** `POST /training-logs` returns `403` with
`error.code: "consent_required"`.
**API:** `POST /api/v1/training-logs` → `403`.

Behavior (not a new screen — a transient interrupt on top of whichever
screen was showing):
1. Show a short, non-blaming toast/snackbar (2–3 seconds,
   dismiss-on-tap): **"Vi behöver fortfarande godkännande innan du kan
   logga. Vi uppdaterar sidan åt dig."**
2. Immediately re-fetch `GET /players/me` in the background.
3. Re-render the home screen using the fresh `consentStatus` → this lands
   the kid back on Screen O7 (waiting or paused variant, whichever is
   now accurate), CTA disabled again.

Design intent: never let the kid sit looking at a bare error message with
no path forward — the recovery (re-fetch + re-render) is automatic, the
toast just explains *why* the tap didn't do what they expected, in one
short, non-technical sentence. No blame ("you weren't allowed to") —
frame it as the app catching up, not the kid doing something wrong.

---

### Out-of-band: parent approval (not a screen in this app)

`GET`/`POST /api/v1/consent/:consentToken` is a **separate, parent-facing
web surface** — not part of the Expo app, per the contract. Nothing to
design here for the child-facing app; noting it only so the boundary is
explicit: there is no "parent approves in-app" screen in Phase 1, and the
app should never imply there might be one (e.g. no "ask your parent to
open this app" copy — the link goes to their email/SMS, not to the kid's
device).

---

## Part 2 — The Core "Jag har tränat" Screen

Real, API-driven version of the Phase 0.5 mockup's home screen. Two calls
drive the whole screen, matching the contract's "no extra round-trip"
principle: `GET /players/me` on open/foreground, `POST /training-logs`
per tap.

### State H1 — Ready to log

**Trigger:** `GET /players/me` → `player.consentStatus === "approved"`
and `streak.alreadyLoggedToday === false`.
**API:** `GET /api/v1/players/me`.

Same visual structure as the Phase 0.5 mockup (flame streak card, dark
CTA, gold team-pool card), now populated from real fields:
- Streak card: `streak.currentStreakCount` → **"{n} dagar"**, label
  **"Din personliga streak — fortsätt så!"**
- Team card: `teamPool.pointsTotal` / `teamPool.goalThreshold`,
  `teamPool.percentComplete` drives the meter fill width,
  `teamPool.seasonLabel` folded into the sub-copy: **"{percent} % till
  guldet {seasonLabel} — alla bidrar lika mycket."**
- CTA: **"Jag har tränat"**, active/tappable.

**Next:** CTA tap → Screen H2 (activity picker), not a direct API call —
the contract's `POST /training-logs` needs `activityType` and
`durationMinutes`, which don't exist yet at the moment of the tap.

---

### State H2 — Vad tränade du? (activity + duration picker)

**Judgment call:** the contract requires `activityType` and
`durationMinutes` on every log, but the brief also demands "one tap
deep." Resolving this as a single bottom sheet with big pre-set chips
(not a form, not free text, no keyboard) — it's a second tap, not a
second *screen*, keeping the loop fast while still satisfying the API
shape.

**Trigger:** CTA tap from H1 (or from H3's "log another" — see below).
**API:** none yet — this is the request-shaping step; submitting calls
`POST /api/v1/training-logs`.

Copy:
- Sheet heading: **"Vad tränade du?"**
- Activity chips (pick one, large icon + label):
  - 🏋️ **"Kondition"** (`fitness`)
  - 🏑 **"Teknik/övning"** (`drill`)
  - 🏃 **"Löpning"** (`running`)
  - ⭐ **"Annat"** (`other`)
- Duration chips (pick one, appear after an activity is picked):
  **"10 min"**, **"15 min"**, **"20 min"**, **"30+ min"**
- Primary button (disabled until both picked): **"Klart!"**

**Next:** "Klart!" tap → `POST /api/v1/training-logs` with the chosen
`activityType`/`durationMinutes`.
- `201` → Screen H5 or H6 (success moment, depending on
  `streak.alreadyLoggedToday` in the response).
- `403 consent_required` → the stale-state edge case above.

---

### State H3 — Already logged today

**Trigger:** `GET /players/me` → `consentStatus === "approved"` and
`streak.alreadyLoggedToday === true` (i.e. this is a return visit later
the same day, not right after a fresh log — that's H6).
**API:** `GET /api/v1/players/me`.

Per the contract's same-day rule, a second log still adds to the team
pool even though the personal streak count is frozen for the day — the
button must not simply be greyed out (that would falsely suggest there's
nothing left to do), but it also shouldn't look identical to H1 (that
would hide the fact today's streak is already secured).

Design: the CTA morphs from solid `flame`-filled ("go do the thing") to
an outlined/secondary treatment ("optional bonus"), with updated label
and a small checkmark badge on the streak card:
- Streak card gets a small green checkmark chip: **"Loggat idag ✓"**
- CTA label changes to: **"Logga en till träning"** (outline style, not
  solid flame fill — visually says "still tappable, but not the main
  ask anymore")

**Next:** tap → same Screen H2 flow (activity/duration picker) →
`POST /training-logs` → `201` with `streak.alreadyLoggedToday: true` in
the response → Screen H6 (smaller success moment, no streak change).

---

### State H4 — Waiting for consent

Identical to Part 1's Screen O7 — this state is defined once, not
duplicated. Documented here only to make explicit that it's reachable
from the same screen/route as H1/H3, driven by the same
`GET /players/me` call, just a different `consentStatus` value. See O7
for the full spec.

---

### State H5 — Success moment: first log of the day

**Trigger:** `201` response from `POST /training-logs` where
`streak.alreadyLoggedToday === false` (this was the day's first log —
the streak actually moved).
**API:** `POST /api/v1/training-logs` response (`streak`, `teamPool`).

This is the moment the tap needs to feel like it mattered — brief,
celebratory, then gets out of the way (no lingering modal, nothing to
dismiss manually, respecting "no infinite scroll / no dark-pattern
engagement" — celebrate and release, don't hold the kid's attention
hostage).

Sequence (roughly 2–2.5 seconds total, auto-dismissing into H3):
1. Streak card count animates from the old number to
   `streak.currentStreakCount` (e.g. "5 dagar" ticks up to "6 dagar")
   with the flame icon doing a small bounce/scale pulse.
2. A brief full-width banner slides in above the streak card:
   **"🔥 Snyggt jobbat! 6 dagar i rad."**
3. Simultaneously, the team-pool meter fill animates from its old width
   to the new `teamPool.percentComplete`, with a small **"+{duration}
   min till laget"** label floating up from the meter and fading out.
4. Banner and floating label both fade after ~2.5s; screen settles into
   Screen H3 (already-logged-today), reflecting the new reality.

No sound requirement specified (device-dependent, kids often on silent
at practice) — the animation must carry the moment on its own, not rely
on audio.

**Where a mockup exists:** this state (mid-animation snapshot) is in
`phase1-mockup.html`.

---

### State H6 — Success moment: additional same-day log

**Trigger:** `201` response from `POST /training-logs` where
`streak.alreadyLoggedToday === true` (streak count unchanged, but
`teamPool` still updated).
**API:** `POST /api/v1/training-logs` response.

Deliberately smaller than H5 — the honest signal here is "the team
pool moved, your personal streak didn't," and the celebration should
match that proportionally rather than overstating a second log as
equally momentous.

- No full-screen takeover, no streak-card animation (nothing changed
  there).
- A single toast, top of screen, ~2s: **"Grymt jobbat! +{duration} min
  till lagets pott 🥇"**
- Team meter still animates to the new `percentComplete`.
- Settles back into H3.

---

## `consentStatus` → screen state, at a glance

| `consentStatus` value | Where it shows | Screen/state |
|---|---|---|
| `not_requested` | Home screen | O7, "Waiting" variant |
| `pending` | Home screen | O7, "Waiting" variant |
| `approved`, not logged today | Home screen | H1 |
| `approved`, logged today | Home screen | H3 |
| `revoked` | Home screen | O7, "Paused" variant |
| any non-`approved` value, but `POST /training-logs` still attempted | Transient toast + re-render | "Stale state" edge case (Part 1) |

---

## Judgment calls made in this doc (flagging, not silently deciding)

1. **Avatar catalog** (12 emoji, listed in O3) — the contract only fixes
   `avatarId` as a string; the actual seed data is backend-owned.
   Proposed here so frontend-developer has something concrete to build
   the picker grid against; swap freely as long as the set stays
   sport-neutral, non-photo, and equally "cool" across options (no
   default/first option implicitly favored).
2. **Whose device collects `parentContact`** (O5) — designed for the
   realistic "coach walks a shared device around at practice" case, with
   copy that still reads correctly if the kid has their own phone.
   Flagged in-line at O5; frontend-developer/backend-developer should
   confirm this matches how coaches actually plan to run onboarding
   sessions before this is final.
3. **Activity/duration picker as a bottom sheet, not a form** (H2) — the
   contract requires two fields the CTA tap alone can't supply; resolved
   as a one-more-tap chip picker rather than a text form, to keep the
   "one tap deep" brief intact as closely as the API shape allows.
4. **Already-logged-today button stays tappable, restyled rather than
   disabled** (H3) — a deliberate reading of the same-day rule: the
   *personal* streak is frozen, but the *team* contribution isn't, so
   the button shouldn't imply there's nothing left to do.
5. **`not_requested` and `pending` share one banner copy** — the
   difference between those two enum values is a backend/audit
   distinction (has a consent request even been generated yet), not one
   a player needs surfaced differently; both mean "nothing to do but
   wait" from the kid's side.
6. **Badges row hidden (not shown empty) during onboarding/waiting** —
   avoids a dead "you have no badges yet" placeholder for a brand-new
   player; not itself a consent-gating decision, just an empty-state
   call.
7. **Age-band (13+) self-consent nuance is explicitly *not* designed
   here** — per ADR-0002's addendum, this is a legal/policy call for
   security-reviewer, not a UI branch invented ahead of that guidance.
   If/when that lands, it's a change to *who* receives the consent link
   (parent vs. player), not a new consentStatus value or a new screen —
   the O7/H4 waiting state and its copy should still hold either way.

## Open question for security-reviewer

Per ACTION_PLAN.md's Phase 1 checklist, security-reviewer still needs to
confirm the age-band self-consent nuance (judgment call #7 above) before
this phase is considered done — this doc assumes the current
"parent/vårdnadshavare always approves" copy, which may need a variant
once that's resolved.
