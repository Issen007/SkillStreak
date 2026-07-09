# Phase 1 Flows — Onboarding & Consent, and the Core "Jag har tränat" Loop

Status: draft, ux-designer-owned, for frontend-developer to build against.
Built directly against `docs/api/phase1-contract.md` (including ADR-0002's
2026-07-03 addendum and its own **2026-07-09 addendum** for self-service
team creation) — every screen state below is driven by a real request/
response shape from that contract, and every `consentStatus` value the
contract defines has a corresponding screen state (see the mapping table in
Part 1). Visual starting point is `docs/design/home-screen-mockup.html`
(Phase 0.5) and `docs/design/style-guide.md` — this doc doesn't redesign the
visual identity, it extends it with real states.

**2026-07-09 update:** Screens O1a/O1b/O1c below are new — the ux-designer
follow-through [`docs/adr/0009-self-service-team-creation.md`](../adr/0009-self-service-team-creation.md)
explicitly left open (its Decision 4 and its "Flagged — adjacent risks"
item 4). They extend Screen O1's old dead-end `404`; O2 through O6 are
unchanged in structure, except O6 now has a second copy variant and O5
gains two new error branches — both noted inline below, not as a separate
doc, since this is a branch off an existing flow, not a new one.

Companion static mockup: `docs/design/phase1-mockup.html` (same phone-frame
pattern as the Phase 0.5 mockup), covering the states where a picture earns
its keep — see "Where a mockup exists" callouts below. Two frames were
added alongside this update: Screen O1a's branch cards, and Screen O6's
"you created your team" variant.

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

**Next:**
- `200` response → Screen O2, carrying `teamId`/`teamName` in memory (not
  yet persisted — nothing's created server-side yet).
- `404 invite_code_not_found` → Screen O1a. **No longer a dead end.** Per
  ADR-0009, an unmatched code is deliberately generic per the contract
  ("doesn't hint whether a code is close to valid") — the UI still must not
  add its own hinting on top (no "did you mean…"), but it now offers a real
  next step instead of just a blocked input. See O1a for why this is a full
  branch screen rather than the old one-line inline error.

---

### Screen O1a — Inget lag hittades (branch: fel kod, eller nytt lag?)

**Trigger:** `404 invite_code_not_found` from
`GET /teams/invite/:inviteCode`.
**API:** none — this screen only presents a choice; nothing needs
re-fetching.

**Why a full screen, not the old inline error line:** the same `404` now
covers two genuinely different situations that only the player can tell
apart — a coach who genuinely hasn't set the team's code up yet, and a kid
who mistyped a real code — and per the brief, that choice needs to be
legible without an adult standing there to explain it. Two big, equal-
weight tappable cards read more clearly to this age group than an inline
error line plus a text link competing for attention with the input field
above it.

**Judgment call:** the copy below is what's fixed; whether
frontend-developer implements this as a full navigated screen or an inline
expanding panel under O1's input is a lower-stakes implementation choice —
either satisfies "two big, clear, equal-weight options," this doc doesn't
mandate the transition mechanism.

Copy:
- Heading: **"Vi hittade inget lag med koden {inviteCode}"** (the typed
  code echoed back, e.g. in a small monospace/badge chip, so the kid can
  see exactly what didn't match)
- Sub: **"Ingen fara — välj det som stämmer för dig:"**

Two full-width option cards, stacked, deliberately equal visual weight —
neither is styled as "primary," so the UI doesn't nudge a kid toward
creating a team just because that option happens to look more inviting:

**Card A**
- Icon: 🔍
- Title: **"Jag skrev nog fel"**
- Sub: **"Testa koden igen"**
- Tap → back to Screen O1, with the input **pre-filled with the code just
  typed, text selected** (ready to be overtyped with one keystroke) —
  deliberately different from O2's "Nej, testa en annan kod" below, which
  clears the input: that button means "this is definitely the wrong team,"
  this one means "I probably just fat-fingered a character."

**Card B**
- Icon: ✨
- Title: **"Vårt lag har ingen kod än"**
- Sub: **"Skapa ett nytt lag med den här koden"**
- Tap → Screen O1b, carrying `inviteCode` (the exact string just typed,
  unchanged) in memory.

Small, muted reassurance line below both cards (not required reading,
doesn't block either choice): **"Osäker? Fråga din tränare innan du
skapar ett nytt lag."** — a safety valve for the kid who genuinely doesn't
know, without gatekeeping the kid who does.

**Next:** see per-card behavior above.

---

### Screen O1b — Namnge ditt nya lag

**Trigger:** "Skapa ett nytt lag med den här koden" tapped on O1a.
**API:** none yet — client-side form state only, same posture as O3's
`screenName`: there's no "check this name" endpoint in the contract, so
nothing is validated (including the content-safety filter) until the final
`POST /players` at the end of O5. This screen can't promise the name or
code will actually be accepted — that's exactly why O1c exists next, as an
explicit "here's what we're about to try" moment before the kid invests
time in O3-O5's personal-info screens.

Copy:
- Small chip at the top, not editable in place: **"Lagkod: {inviteCode}"**,
  with an adjacent small text link **"Byt kod"** → back to Screen O1
  (input pre-filled with the current code, editable) — the same recovery
  path reused if the code itself ever gets rejected by the content filter
  at final submit (see O5's error handling below).
- Heading: **"Vad ska ert lag heta?"**
- Sub: **"Du blir lagets första spelare — och kapten! Välj ett namn som
  resten av laget kan vara stolta över."**
- Input label: **"Lagnamn"**, placeholder: **"T.ex. IBK Falken P13"**
- Helper text (small, muted): **"Andra lag kan se namnet på topplistan."**
  (transparency about `Team.name`'s cross-team visibility per ADR-0008 —
  short enough not to read as a legal disclaimer, but the kid should know
  before naming it, not discover it later.)
- Primary button (disabled until non-empty): **"Nästa"**

**Next:** → Screen O1c.

---

### Screen O1c — Bekräfta nytt lag

**Trigger:** team name entered at O1b.
**API:** none — this is the confirmation gate ADR-0009 flagged as missing
("Flagged — adjacent risks" item 4): joining an *existing* team already
gets a "wait, are you sure?" moment at O2 before anything is created; this
screen is that same moment for the create path, placed **immediately after
naming, before O3-O5's personal-info screens** — mirroring exactly where
O2 sits relative to O3-O5 in the join path, so a kid who has second
thoughts finds out before typing a birth year or a parent's contact info,
not after.

Because there is genuinely no `POST /teams` endpoint (ADR-0009 Decision 1
— creation only ever happens inside the final `POST /players` call), this
screen can't server-verify anything; it's a gate on the kid's own stated
intent, not a preview of confirmed server state the way O2 is. The copy is
written to make the *permanence* explicit, since that's the actual risk
this screen exists to close (a fat-fingered code becoming a permanent
duplicate/junk team).

Copy:
- Heading: **"Skapa {teamName}?"**
- Sub: **"Lagkod: {inviteCode} — dela den med lagkompisar så de kan gå med
  sen."**
- Highlighted tip row (small icon, not alarming — 💡, not ⚠️): **"Namnet
  och koden går inte att ändra sen, så dubbelkolla att allt stämmer!"**
- Primary button: **"Ja, skapa laget!"**
- Secondary button (text-style, low visual weight): **"Nej, ändra
  namnet"** → back to Screen O1b, name field pre-filled and focused.

**Next:** primary tap → Screen O3, carrying `teamName` (and an in-memory
"this is a create, not a join" flag) alongside the existing `inviteCode`.
**No API call happens here** — per ADR-0009 Decision 1, the team itself
isn't created until the final `POST /players` succeeds at the end of O5;
this screen only locks in the kid's intent, it doesn't make anything
permanent server-side yet.

---

### Screen O2 — Bekräfta lag (team preview confirmation)

**Continues from Screen O1's `200` response — join path only.** The create
path (O1a's Card B) detours through O1b→O1c instead and rejoins the flow
directly at O3, skipping this screen entirely since there's no existing
team to preview.

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

**Shared by both onboarding paths, unchanged content either way.** Reached
from O2 (join) or from O1c (create) — no copy below differs between the
two; if the player is creating a team, `teamName` simply continues riding
along in memory alongside `inviteCode` all the way to O5's final submit,
per the contract (ADR-0009 Decision 1: creation isn't a separate step).

**Trigger:** confirmed team from O2, or confirmed new team from O1c.
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
`{ inviteCode, screenName, avatarId, birthYear, parentContact, teamName? }`
— `teamName` is present only if the player came through O1a's "create a
new team" branch.

- **`201`** → Screen O6, whose copy now branches on the response's
  `teamCreated`/`isCaptain` fields — see O6 below.
- **`409 screen_name_taken_in_team`** → stay on this screen's flow but
  jump back to O3 with the name field pre-focused and an inline error:
  **"Det namnet är upptaget i laget — testa ett annat!"** (avatar, birth
  year, and parent contact stay filled; only the name needs to change).
- **`404 invite_code_not_found`** (edge case: code became invalid between
  O1 and now, e.g. a coach retired it — join path only, `teamName` absent)
  → back to O1 with: **"Lagkoden fungerar inte längre. Fråga din tränare om
  en ny kod."**
- **`422 team_name_rejected_by_filter`** *(new, create path only)* → back
  to Screen O1b, team-name field pre-focused, **typed text stays in the
  input** (nothing cleared) — same posture as team chat's filter rejection
  (`docs/design/phase2.6-2.7-flows.md`'s `message_rejected_by_filter`
  copy): non-judgmental, no "banned"/"olagligt" language, since a first
  attempt might trip it on an entirely innocent word:
  > **"Lagnamnet gick inte att spara — det innehöll ord som inte funkar
  > här. Skriv om det så går det bra! ✍️"**

  Screen name, avatar, birth year, and parent contact all stay filled —
  only the team name needs to change.
- **`409 invite_code_taken_concurrently`** *(new, create path only — an
  extremely rare race, ADR-0009 Decision 8)* → back to Screen O1, input
  cleared (the code is now genuinely gone, there's nothing left to edit),
  with every other already-entered field (screen name, avatar, birth year,
  parent contact) preserved in memory so the kid doesn't have to redo
  O3-O5 once a new code resolves:
  > **"Åh nej — någon hann skapa ett lag med den koden precis före dig!
  > Testa en annan kod, så ordnar vi resten direkt."**
- **Invite-code rejected by the content filter — flagged, not yet in the
  contract** *(create path only)*: ADR-0009 Decision 3 explicitly leaves
  open whether `inviteCode` itself should also run through the content
  filter, separate from `teamName` (which is confirmed). **Designing the
  recovery path anyway**, since a rejected code can't be "edited" the way
  a rejected name can — the kid needs an entirely different code, not a
  tweak to this one. Proposed shape: → back to Screen O1, input cleared,
  same field-preservation as the race case above, with:
  > **"Den koden funkar inte som lagkod — testa en annan!"**

  Deliberately as unspecific as chat's filter copy about *why*, same
  reasoning: don't spotlight the flagged word. **Flagged for
  architect/backend-developer:** this needs a real, confirmed error code
  (and a decision on whether the check exists at all) before this branch
  can actually ship — the copy is ready the moment that's resolved, it
  isn't blocking anything else in this doc, and this restarts the flow
  from O1 exactly as the task's brief asked for.

---

### Screen O6 — Klart! Vi har frågat

**Trigger:** `201` from `POST /players`.
**API response fields used:** `sessionToken` (stored in Expo SecureStore
immediately), `consentStatus` ("pending"), `screenName`, `avatarId`,
`teamName`, `teamCreated`, `isCaptain` *(three new fields, ADR-0009's
response addendum)*.

A short, single confirmation screen — not the home screen yet — so the
"what happens next" message actually gets read once, rather than being
buried under the home screen's other content on first load.

**Two copy variants, driven strictly by the response's `teamCreated`
field — not by which screen (O1a/O1c vs O2) the client took to get here.**
See the callout below the table for exactly why that distinction matters:

| `teamCreated` | Moment | Icon | Heading | Body |
|---|---|---|---|---|
| `false` (joined an existing team) | ordinary welcome | check/wave (no photo, matches the no-photo identity rule) | **"Klart, {screenName}!"** | **"Du är med i {teamName}! Vi har skickat en fråga till en förälder eller vårdnadshavare. Så fort de säger ja kan du börja logga träningar och tjäna poäng till laget."** |
| `true` (created a brand-new team — `isCaptain` is always `true` here) | founding-captain celebration | 👑🎉 | **"Grattis, {screenName}! Du skapade {teamName}!"** | **"Du är lagets första spelare — och kapten! Så fort en förälder eller vårdnadshavare säger ja kan du börja logga träningar och bjuda in lagkompisar."** |

The `teamCreated: true` variant also shows a small code chip below the
body — the kid's only durable, in-app reminder of the code they now need
to actually recruit teammates with: **"Lagkod: {inviteCode} — dela den med
dina lagkompisar!"**

Primary button, both variants: **"Nu kör vi"**

**Edge case, no error involved, but it's exactly why O6 must be
response-driven, not path-driven:** per ADR-0009 Decision 2, a kid who
confirmed "create" at O1c can still land on the `teamCreated: false` /
joined-team variant with zero error shown, if — in the multi-screen window
between O1c and the final `POST /players` — someone else's request already
created a real team with that exact code first (that request's `teamName`,
not this kid's). This is deliberately silent per the ADR, not a bug to
patch here. If O6 were built off a locally-remembered "I came from the
create branch" flag instead of the live response fields, a kid could see
the captain-celebration screen for a team they didn't actually end up
creating — frontend-developer should build this screen strictly off
`teamCreated`/`isCaptain` from the `201` response, every time.

**Why this is a full screen, not a transient banner like Screen K5 or
G2:** those patterns exist because their trigger (a captain transfer, a
team goal being hit) is discovered *asynchronously* — the app diffs a
freshly fetched value against a locally-stored "last known" flag to notice
a change happened after the fact. Becoming a founding captain isn't
asynchronous here: it's known **synchronously**, in the exact same `201`
response that ends onboarding. There's nothing to detect on a later app
open, so there's no K5-style local-flag mechanism to build — O6 *is* the
moment, in full, right now. This also means **no second captain
announcement is designed for the first real home-screen open that
follows** — showing it again immediately after O6 would just repeat the
same fact, not mark a new one.

**Not overclaiming what's actually gated:** ADR-0009 flags (under
"Flagged — adjacent risks," item 1, unresolved) that a brand-new captain
can exercise every captain-only action immediately, *before* their own
parental consent is approved — today's backend gates captain actions on
team membership + the `isCaptain` flag only, never on the acting
captain's own `consentStatus`. The body copy above deliberately only
promises what's actually true today (logging training is consent-gated;
captain tools currently are not) rather than implying captain tools are
locked until approval too. **If security-reviewer's eventual answer to
that flagged risk changes what's actually gated, this copy needs a
matching update** — noted here so the two don't silently drift apart.

**Where a mockup exists:** the `teamCreated: true` variant is in
`phase1-mockup.html`.

**Next:** tap → navigates into the app shell, home screen, which
immediately renders the waiting-for-approval state (Screen O7) because
`consentStatus` is `"pending"` — true for both variants; a founding
captain waits for their own consent exactly like anyone else.

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
8. **O1a as a full navigated screen, not an inline reveal under O1's
   input** — chosen for legibility given the audience (two big, equal
   cards read more clearly than an inline error + link competing with a
   text input the kid is still looking at). The copy is what's fixed;
   frontend-developer can build it as an inline expanding panel instead
   if that measures better, as long as the two options stay equal-weight
   and full-size.
9. **O1a's "wrong code" card pre-fills and selects the input, instead of
   clearing it like O2's "wrong team" button does** — a deliberate,
   different recovery for a deliberately different situation: O2's "no"
   means "this is definitely not my team," clearing makes sense; O1a's
   "I probably mistyped" means the kid likely just needs to fix one
   character, so pre-filling (selected, ready to overtype) is less
   re-typing for the same outcome.
10. **The create-path confirmation (O1c) sits immediately after naming
    (O1b), before O3-O5** — one of two shapes ADR-0009 explicitly left
    open ("its own screen right after" vs. "folded into a final review
    before O5→submit"). Chosen because it mirrors exactly where O2 sits
    relative to O3-O5 for the join path, and because it means a kid who
    has second thoughts finds out *before* typing a birth year or a
    parent's contact info, not after filling in four more screens only
    to back out at the last moment.
11. **O6's "joined an existing team" copy now names `teamName` in the
    body** ("Du är med i {teamName}!"), which the original Phase 1 copy
    didn't do — a small, optional enhancement made possible by
    `teamName` now being reliably present on every `201` response (not
    just inferred from the O2 preview, which never ran for the create
    path). Low-risk, but flagging it as a change to previously-shipped
    copy, not something ADR-0009 asked for directly.
12. **No K5-style "async catch-up" mechanism for the new-captain
    moment** — unlike K5 (an existing captain discovers a transfer on a
    *later* app open, via a locally-diffed flag), a founding captain's
    status is known synchronously in the same `201` response that ends
    onboarding, so O6 alone carries the celebration; no second mechanism
    is designed for a later home-screen open. See the callout under O6
    for the full reasoning.
13. **Invite-code content-filter rejection copy is designed ahead of a
    confirmed contract decision** — ADR-0009 Decision 3 explicitly left
    open whether `inviteCode` (not just `teamName`) runs through the
    moderation check. The recovery flow and copy are drafted at O5's
    error list so this doesn't block a future implementation, but the
    error code itself, and whether the check exists at all, needs
    architect/backend-developer sign-off before it ships.

## Open question for security-reviewer

Per ACTION_PLAN.md's Phase 1 checklist, security-reviewer still needs to
confirm the age-band self-consent nuance (judgment call #7 above) before
this phase is considered done — this doc assumes the current
"parent/vårdnadshavare always approves" copy, which may need a variant
once that's resolved.

## Open questions carried over from ADR-0009, not resolved by this doc

Per CLAUDE.md's "surface, don't silently pick" rule — these are explicitly
not this doc's call, listed here so they aren't lost between the ADR and
implementation:

- **Whether `inviteCode` runs through the content-safety filter at
  creation, alongside `teamName`** (ADR-0009 Decision 3, "flagged, not
  decided"). Judgment call #13 above designs the recovery path
  speculatively; the actual product/architecture decision is still open.
- **Whether captain-only actions should also require the acting
  captain's own parental consent to be `approved`** (ADR-0009, "Flagged —
  adjacent risks" item 1) — referenced explicitly in O6's copy above,
  since a founding captain's `consentStatus` is `pending` at the exact
  moment they're first told they're captain. security-reviewer sign-off
  needed; O6's body copy will need a matching update if this changes.
- **Team-creation abuse/rate-limit posture** (ADR-0009, "Flagged —
  adjacent risks" item 2) — no UI consequence identified for this pass
  (the existing `POST /players` throttle behavior is invisible to the
  player either way), but noted here so it isn't assumed silently closed
  just because this doc doesn't design anything for it.
