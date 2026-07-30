# Fas 4.2 Flows — Självbetjänad radering av konto (GDPR)

Status: draft, ux-designer-owned, for frontend-developer to build against.
Built directly against `docs/adr/0013-account-erasure.md` (Decisions 1-8,
as revised 2026-07-29 and re-confirmed by security-reviewer) — there is no
separate `docs/api/*-contract.md` for this feature; the ADR's Decision 3 is
the API surface of record, the same way `docs/adr/0006-captain-transfer.md`
stood alone without a companion contract doc. Visual language is
`docs/design/style-guide.md`; screen-ID scheme continues the existing
O/H/K/CH/LB/G/V prefixes with a new **E-prefix** ("Erasure"). Extends
`docs/adr/0012-profile-page-and-contact-email-change.md`'s already-shipped
`ProfileScreen.tsx` (its `ProfileView` step-state machine, own local state,
no navigation library) rather than introducing a new screen/navigation
pattern for this feature alone.

Companion mockup: `docs/design/phase4.2-account-erasure-mockup.html` —
five illustrative screens: the request screen with the captain-gate visible
(E2), the successor picker (E3), the confirm sheet (E4), the check-email
screen (E5), and the persistent Profile-screen status card in its
grace-period variant (E6).

**Read this first — why this doc reads as more verbose than this app's
norm, deliberately:** CLAUDE.md's "minimal reading" instruction and this
project's established "one confirmation step is enough" habit (O1c, K4,
V11) both still apply here, but the task framing for this feature is
explicit that clarity beats brevity for this one flow specifically — this
is whole-account, whole-child-data, unconditional loss, the single most
consequential action this app can perform. The extra words below are spent
on **stating consequences plainly** (what's deleted, what survives, when
it becomes permanent), not on adding friction steps for their own sake —
this doc still lands on a two-step confirm (one full screen, one sheet),
the same shape as every other "are you sure" moment in this app, see
Judgment call 3.

---

## Judgment call — these are new steps on `ProfileScreen`'s existing state
machine, not a new stack

`ProfileScreen.tsx` already models `editName`/`editAvatar`/`requestChange`/
`confirmChange` as a `ProfileView` union with local `useState`, no
navigation library — this doc adds `erasureRequest` (E2),
`erasureSuccessor` (E3), and `erasureCheckEmail` (E5) to that same union,
plus a persistent status card rendered directly inside the existing `view`
step (E6, see below) rather than as its own step. E1 (the entry point) and
E4 (the confirm sheet) aren't separate `ProfileView` values at all — E1 is
a row already on the `view` step, and E4 is a `Modal` overlay on top of
`erasureRequest`, the same `visible`-prop-driven pattern `ClipDeleteSheet`
already uses.

---

## Screen E1 — entry point (row on Profile's `view` step)

**Trigger:** none — always present on the Profile screen's default view,
mirroring exactly how "Logga ut" is reached (a plain row at the bottom of
the screen, not buried in a submenu).
**API:** `GET /api/v1/players/me/erasure/status`, fetched alongside
`getProfile()` (`Promise.all`, not a second round-trip) every time the
Profile screen loads or is returned to — this is what decides whether E1
or E6 (below) renders.

**Only shown when `GET .../erasure/status` returns `{ status: 'none' }`.**
Once any request is active (`requested` or `grace_period`), E1 is replaced
entirely by E6's status card — there is deliberately no world where both a
"Radera mitt konto" link and an active-request card are visible at once
(see Judgment call 8).

Placement and copy:
- Below the existing "Logga ut" `SecondaryLink`, separated by extra
  vertical space (no divider line needed — spacing alone is this app's
  existing idiom for "these are a different category of action" elsewhere
  on this screen).
- Label: **"Radera mitt konto"** — a plain `SecondaryLink`, **except its
  text color is `colors.error` instead of `colors.textMuted`** (see
  Judgment call 1 for why this is the right amount of visual weight here,
  not a full `DangerButton`).
- Tapping it does nothing durable by itself (per ADR Decision 2 — this is
  the whole point) — it just navigates to E2. No API call happens on this
  tap.

**Next:** tap → E2.

---

## Screen E2 — Radera ditt konto? (full screen)

**Trigger:** tapping E1.
**API:** on mount, if not already held in state from elsewhere in the app
this session, fetches `GET /api/v1/teams/:teamId/dashboard` (for
`viewerIsCaptain`) and `GET /api/v1/teams/:teamId/teammates` (for the
roster, both its count and the picker's data) — the exact same two calls
Screens K1/K4 already make, not a new read. **Flagged for
frontend-developer:** `ProfileScreen` currently only receives `screenName`
as a prop — it needs `teamId` plumbed in too (from wherever `AppShell`
already holds it) to make these two calls.

If either fetch fails, this screen shows a plain retry-only error state
(**"Kunde inte hämta laginformation. Försök igen."**, a single retry
button, primary CTA absent) rather than guessing — silently treating a
failed fetch as "not captain" would risk skipping Decision 4's mandatory
successor step for a captain who really does have one, which this doc
treats as a real risk, not an edge case to wave off.

### Layout

- Heading: **"Radera ditt konto?"**
- A short, plain bulleted list of consequences (this is the one place in
  this screen worth the extra reading — stating the truth plainly, not a
  wall of legal text):
  - **"All din träningshistorik, dina märken och dina klipp raderas för
    alltid."**
  - **"Du försvinner från laget. Dina meddelanden i lagchatten blir
    anonyma — laget och lagkompisarna påverkas inte annars."**
  - **"Det går inte att ångra så fort de 30 dagarna har gått."**
- A highlighted info row (small ℹ️ icon, **not** ⚠️ — same non-alarming
  visual language as O1c's 💡 permanence tip, `tipBg`/`tipBorder`):
  **"Vi skickar ett mejl som du (eller en förälder eller
  vårdnadshavare) måste bekräfta — bara att trycka på knappen här nedan
  gör ingenting än. Så fort mejlet är bekräftat har du 30 dagar på dig att
  ångra dig, och kontot funkar precis som vanligt under tiden."**

### Captain-gate variants (mutually exclusive with the plain case above)

**A — captain, ≥1 teammate:** an additional required section:
- Sub-heading: **"Du är lagets kapten"**
- Body: **"Du måste välja vem som tar över som kapten innan du kan gå
  vidare."**
- A row: either muted **"Ingen vald än"** or, once chosen, the picked
  teammate's avatar + screen name, with a button **"Välj"** (or
  **"Ändra"** once one is picked) → E3.
- The primary button below stays **disabled** until a successor is chosen
  — no way around this step, matching ADR Decision 4's "no optional
  fallback field" exactly.

**B — captain, 0 teammates (the last player on the team):** no successor
field (none applicable) — instead a distinctly worded, honest-about-its-
own-uncertainty warning row:
- **"Just nu är du ensam kvar i laget. Om det fortfarande stämmer om 30
  dagar försvinner hela laget när ditt konto raderas — poäng, klipp och
  allt annat."**
- Deliberately phrased as a **current snapshot**, not a promise — per ADR
  Decision 5, "last player" is re-checked fresh at execution time 30 days
  later (someone could join in the meantime), so this screen must not
  overstate certainty it doesn't have, the same discipline this app's
  copy already applies elsewhere (V3/V10's honest-limitation notes).

**C — not captain:** no extra section; the three bullets above are the
whole story.

### Buttons

- Primary (`DangerButton` — see Judgment call 2): **"Radera mitt konto"**,
  disabled until any required successor choice (variant A) is made.
- Secondary: **"Avbryt"** → back to Profile's `view` step, no state
  retained.

**Next:** primary tap (successor chosen if required) → E4. **No API call
happens at this tap** — same "lock in intent here, the sheet does the real
call" shape as O1c/K4.

---

## Screen E3 — Vem tar över som kapten? (successor picker)

**Trigger:** "Välj"/"Ändra" on E2, variant A only.
**API:** `GET /api/v1/teams/:teamId/teammates`, refetched on entry rather
than trusting E2's copy of it — same reasoning K4 already established
("staleness here would mean showing an out-of-date roster on the one
screen whose whole job is picking a valid target").

### Layout

Flat list, same row style as K1/K4's teammates section — **but, unlike
K4, the requester's own row is omitted entirely** (see Judgment call 4;
there's no ambiguity here worth a disabled "(Du)" row the way K4 has one).

- Heading: **"Vem tar över som kapten?"**
- Sub, stated carefully because this is easy to get wrong given how K4's
  transfer works (immediately) versus this one (deferred): **"Den du
  väljer blir lagets kapten den dag ditt konto raderas — inte förrän dess.
  Du är kapten som vanligt tills dess."**
- Rows: avatar + screen name, tap to select (single-select, highlighted) —
  picking **is** the action here, no separate confirm sheet on this
  screen (lower-stakes than K4's actual immediate handoff — nothing
  happens server-side yet, per ADR Decision 4, until E4's request is
  submitted).
- Primary button: **"Klar"** (disabled until one row is selected) → back
  to E2, with the chosen name now shown in E2's successor row.
- Secondary: **"Avbryt"** → back to E2, any in-progress (unconfirmed)
  selection discarded.

**Next:** "Klar" → E2 (successor now shown). "Avbryt" → E2 (unchanged).

---

## Screen E4 — confirm sheet ("Är du säker?")

**Trigger:** E2's primary button (successor chosen if required).
**API:** `POST /api/v1/players/me/erasure/request { successorPlayerId? }`.

Bottom sheet, same visual pattern as `ClipDeleteSheet`/K4's confirm sheet
— but styled with `DangerButton`, this app's reserved destructive
treatment (see Judgment call 2 for why, given this tap itself isn't
instantly irreversible the way V11's clip-delete tap is).

### Copy

- Heading: **"Är du säker?"**
- Body (deliberately **not** repeating E2's bullet list — that would just
  be re-reading the same thing twice — two facts only, the ones that
  matter most at the exact moment of committing):
  **"Vi skickar ett mejl som måste bekräftas för att sätta igång de 30
  dagarna. Ångrar du dig kan du avbryta när som helst innan de gått ut."**
- If a successor was chosen (variant A): an additional line,
  **"{successorScreenName} tar över som kapten den dag kontot raderas."**
- Buttons: **"Avbryt"** (secondary) / **"Ja, radera mitt konto"**
  (`DangerButton`).

### On confirm

- **`201` → `{ requested: true, expiresAt }`** → E5.
- **`409 erasure_blocked_pending_contact_change`** (ADR Decision 2's
  contact-change race guard): sheet closes, **routes back to Profile's
  `view` step** (not back to E2 — nothing on E2 changes by waiting), toast
  **"Du har en pågående ändring av din kontaktuppgift. Den måste bli klar
  (eller avbrytas) innan du kan radera kontot — kolla igen om en liten
  stund."** The existing contact-change grace-period banner (ADR-0012)
  is already visible on this same screen and explains the rest.
- **`429` (rate-limited)**: toast **"Du har nyss bett om det här. Vänta en
  liten stund och försök igen."**, sheet closes, stays on E2.
- **`409 erasure_successor_invalid`** (rare race — the chosen teammate
  left the team, or is themselves now mid-erasure, between E3 and this
  submit; the backend deliberately doesn't distinguish which, same
  posture as the existing captain-transfer exceptions): toast **"Den
  spelaren finns inte kvar i laget längre. Välj någon annan."**, sheet
  closes, back to E3 with the selection cleared.
- **Generic/`5xx`**: sheet stays open, inline **"Något gick fel. Testa
  igen."** — same fallback idiom as everywhere else in this app.

**Next:** `201` → E5.

---

## Screen E5 — Kolla inkorgen (one-time, after a successful request)

**Trigger:** `201` from E4.
**API:** none required from this screen itself; an optional manual
refresh calls `GET /players/me/erasure/status`.

**Deliberately has no code-input field**, unlike ADR-0012's `confirmChange`
screen it otherwise most resembles in shape (icon, heading, body). Per
ADR Decision 3, `GET/POST /players/erasure-confirm/:code` is
**unauthenticated** — mirroring the parental-consent-link pattern (a
mailed link, clickable from any device, no app session needed), not the
contact-change pattern (a code typed back into the still-open app). This
is worth stating plainly in this doc because it's the one place this
flow's actual shape diverges from the sibling feature it looks most alike
— see Judgment call 5.

### Copy

- Icon: 📩
- Heading: **"Kolla inkorgen"**
- Body: **"Vi har skickat ett mejl med en länk. Öppna mejlet och tryck på
  länken för att sätta igång de 30 dagarna — det går bra att vänta och
  göra det imorgon också."**
- A second, smaller line, closing the loop on Decision 2's core guarantee
  in a kid-legible sentence: **"Trycker du inte på länken händer
  ingenting — kontot är kvar precis som vanligt."**
- Primary/only button: **"Till profilen"** → Profile's `view` step, where
  E6's `requested`-variant card now shows.

**No "fick du inget mejl, skicka igen" link on this screen** — unlike
`confirmChange`'s equivalent, which safely routes back to its own request
screen to retry. Whether re-submitting `POST .../erasure/request` while a
`requested` row is already active resends the email or `409`s against the
partial unique index isn't settled by the ADR (see Flagged section) — this
screen doesn't guess at that behavior by adding a button whose outcome
isn't confirmed.

**Next:** "Till profilen" → Profile `view` (E6 now showing, `requested`
variant).

---

## Screen E6 — persistent Profile-screen status card

Rendered inline on Profile's `view` step, in the same position/role
`WaitingCard` occupies on the Home screen — a persistent bordered card,
**not** an auto-dismissing animated banner like `CaptainBanner`/`Toast`,
because this state needs to still be visible the next time the screen is
opened, not just in the moment right after an action. Reuses
`WaitingCard`'s exact visual language (`pendingBg`/`pendingBorder`, ⏳
icon, card shape) rather than inventing a third "waiting" style this app
doesn't otherwise have.

**Shown whenever `GET /players/me/erasure/status` returns `status !==
'none'`** (fetched alongside `getProfile()` on every load, per E1's note
above).

### Variant `requested` (confirmation email not yet acted on)

- Icon: ⏳
- Title: **"Väntar på att du bekräftar raderingen"**
- Body: **"Vi har mejlat en länk. Öppna mejlet och bekräfta för att sätta
  igång de 30 dagarna. Gör du ingenting stannar kontot precis som det
  är."**
- Action: **"Ångra begäran"** (small text link, muted-not-alarming color —
  see Judgment call 6 for why this is a single direct tap, no confirm
  sheet).

### Variant `grace_period` (confirmed, counting down)

- Icon: ⏳ — **deliberately the same icon as the `requested` variant, not
  a starker one** (see Judgment call 7 — ADR Decision 7 explicitly asks
  for "nothing about the account is restricted... no guilt," and the copy
  carries the seriousness here, not the color/iconography).
- Title: **"Ditt konto raderas den {date}."** — `{date}` formatted via
  whatever locale-aware date utility this app already uses elsewhere
  (flagged for frontend-developer — see Flagged section), not a
  hand-rolled Swedish month-name list, per CLAUDE.md's i18n instruction.
- Body: **"Kontot funkar precis som vanligt fram tills dess. Ångrar du dig
  kan du avbryta när som helst innan dess."** — plus, only if a successor
  was named: **" {successorScreenName} tar över som kapten den dagen."**
- Action: **"Ångra raderingen"** (same single-tap behavior as above).

### On tapping "Ångra begäran" / "Ångra raderingen"

Calls `POST /players/me/erasure/cancel` **immediately, no confirmation
sheet** (Judgment call 6).

- **Success (`{ cancelled: true }`)**: card disappears, a genuinely happy
  toast — this is good news, not a neutral state change: **"Klart! Ditt
  konto raderas inte. 🎉"** E1's "Radera mitt konto" link reappears (no
  active request remains).
- **Error** (rare race — already resolved by e.g. the mailed cancel link,
  or execution already ran): toast **"Något gick fel. Ladda om sidan och
  testa igen."**, re-fetch `GET .../erasure/status` (this is what
  surfaces the true current state, rather than trusting the stale local
  assumption that triggered the tap).

---

## Not designed here — the two unauthenticated web pages

`GET/POST /players/erasure-confirm/:code` and `GET/POST
/players/erasure-cancel/:code` (ADR Decision 3) are plain web pages —
same posture as ADR-0012's existing cancel-link page and the parental
consent-link pages, building/hosting them is backend-developer's job, not
an in-app screen this doc designs. **Suggestion, not spec**, for content
parity with the copy above:

- The confirm-link page should state the "30 dagar" figure plainly and,
  once known, the resulting delete date — matching E5's own framing.
- The cancel-link page should confirm success in the same relieved,
  positive tone as E6's **"Klart! Ditt konto raderas inte. 🎉"** toast, not
  a dry "Request cancelled." acknowledgment.

### Suggested email subject lines / key phrases (suggestion, not spec)

- **Request-time confirm-code email**: subject along the lines of
  **"Bekräfta radering av kontot"** — key phrase to preserve: state plainly
  that nothing has happened yet and this link is the only thing that
  starts the 30 days (mirrors this doc's E2/E5 copy, and the "state the
  true current state plainly" discipline `phase3-flows.md`'s report-email
  copy already established for this codebase).
- **Confirm-time (grace-period-start) cancel-link email**: subject along
  the lines of **"Kontot raderas om 30 dagar"** — key phrase: state the
  exact date, and that cancelling takes one tap in the app (primary path,
  per ADR Decision 7) or one tap on this link (backup path).

---

## Judgment calls made in this doc

1. **E1's entry point is a plain `SecondaryLink` colored `colors.error`,
   not a full `DangerButton`** — a small severity cue proportionate to
   "this just opens a screen and does nothing durable," not to the actual
   destructive tap itself (which lives at E4).
2. **`DangerButton` is reused for E4's "Ja, radera mitt konto" even though
   that tap alone isn't instantly, unconditionally permanent** — email
   confirmation still gates the 30-day clock, and cancellation stays
   available throughout. This is a deliberate broadening of the
   component's own documented "only for genuinely, unconditionally
   permanent actions" criterion (see `DangerButton.tsx`'s comment): the
   alternative — an ordinary primary-styled button, the same treatment
   K4's captain handoff or CH4's block use — would understate the single
   most consequential action in this entire app. Recommend
   `DangerButton.tsx`'s own doc comment gets a follow-up line
   acknowledging this second legitimate use (an action that **will**
   become genuinely irreversible unless actively cancelled, not one that
   already is the instant the button is tapped).
3. **No "type RADERA to confirm" friction step.** A two-step confirm (one
   full screen, one sheet) is treated as sufficient, matching every other
   "are you sure" moment this app has shipped (O1c, K4, V11) and
   CLAUDE.md's "minimal reading" instruction — the extra reading this doc
   asks for is spent on stating consequences plainly (E2's bullets), not
   on adding friction for its own sake.
4. **E3 never shows the requester's own row**, unlike K4's disabled
   "(Du)" row — there's no ambiguity to resolve the way there is on K4
   (obviously a captain can't name themselves), so omitting it entirely is
   less clutter, not an inconsistency with K4's pattern.
5. **E5 has no code-input field**, unlike `confirmChange`'s — the erasure
   confirm route is an unauthenticated mailed link (mirrors the
   parental-consent pattern), not a typed code (mirrors contact-change).
   Flagged explicitly because this is the one place this flow's shape
   genuinely diverges from the sibling feature it looks most alike.
6. **Cancelling (E6) is a single, immediate tap with no confirmation
   sheet** — the one deliberate exception to this app's general
   "confirm before a state-changing action" habit, because undoing an
   already-in-flight deletion is the one direction where adding friction
   would be perverse. ADR Decision 7 explicitly asks for this to read as
   an easy, low-friction "never mind," not a buried or scary option.
7. **The `requested` and `grace_period` banner variants deliberately
   reuse the same calm ⏳/`pendingBg` visual language**, not a starker
   treatment for the counting-down state — matches ADR Decision 7's
   explicit "no lockout gate, no guilt" instruction; the account is fully
   live in both states, and the copy carries the seriousness, not the
   color.
8. **E2/E1 hide themselves entirely once a request is already active**,
   replaced by E6's card, rather than allowing a confusing second
   "Radera mitt konto" entry point to sit alongside an active-request
   card — matches the backend's own "only one active request per player"
   invariant instead of just relying on the API to reject a second
   attempt after the UI already let someone start one.

---

## Flagged for others, not decided here

- **frontend-developer**: `ProfileScreen` needs `teamId` plumbed in as a
  prop (today it only receives `screenName`) so E2 can call
  `GET .../teams/:teamId/dashboard` and `GET .../teams/:teamId/teammates`
  — the same two calls K1/K4 already make elsewhere, not a new read.
- **backend-developer/architect**: whether re-calling
  `POST /players/me/erasure/request` while an active `requested`-status
  row already exists resends the confirm email (an idempotent "resend") or
  `409`s against the partial unique index — the ADR doesn't say either
  way. E5 deliberately has no "resend" button pending that answer; adding
  one later is a small follow-up if resend turns out to be supported, not
  a redesign.
- **backend-developer/architect**: whether `POST /players/me/erasure/cancel`
  is valid while `status = 'requested'` (before the email is even
  confirmed), or only once `status = 'grace_period'` — this doc assumes
  both work identically (cancelling an unconfirmed request is strictly
  the simpler case), since Decision 3 describes the cancel endpoint
  generically, without restricting it to one status. If it turns out to
  be `grace_period`-only, E6's `requested`-variant "Ångra begäran" action
  needs a fallback (most simply: still call `cancel`, and treat any
  rejection as "not started yet, nothing to cancel" — a friendly no-op,
  same idiom `ConsentService.approve`/`ProfileService.cancelContactChange`
  already use).
- **security-reviewer**: confirm Judgment calls 1-2 (the `error`-colored
  link, the broadened `DangerButton` use) don't need their own review pass
  — nothing here changes access-control or data behavior, but flagging
  since this is the one screen in the app dealing with whole-account,
  whole-child-data loss, and copy/visual tone was named explicitly in this
  task's brief.
- **frontend-developer**: E6's grace-period date formatting should go
  through whatever locale-aware date utility this app already uses
  elsewhere (if one exists), not a hand-rolled Swedish month-name list —
  flagged per CLAUDE.md's i18n instruction rather than assumed, since this
  pass didn't audit the rest of the codebase for an existing date-format
  helper.
