# Fas 2.6a–2.7 Flows — Kapten-synlighet, lagchatt, målpolish, VM-Guld-tabellen

Status: draft, ux-designer-owned, for frontend-developer to build against.
Built directly against `docs/adr/0006-captain-transfer.md` +
`docs/api/phase2-contract.md`'s 2026-07-08 addendum (Part A),
`docs/adr/0007-team-chat.md` + `docs/api/phase2.6b-contract.md` (Part B),
`docs/design/phase2-flows.md`'s existing goal screens (Part C), and
`docs/adr/0008-vm-guld-cross-team-leaderboard.md` +
`docs/api/phase2.7-contract.md` (Part D). Every screen below is driven by a
real request/response shape from those docs, not a sketch. Visual language
is `docs/design/style-guide.md`; screen-ID scheme continues
`docs/design/phase2-flows.md`'s (K-prefix for captain/roster, new CH-prefix
for chat, new LB-prefix for the leaderboard).

Companion mockup: `docs/design/phase2.6-2.7-mockup.html` (same phone-frame
pattern as `phase1-mockup.html`/`phase2-mockup.html`) — four illustrative
screens, not a full redraw of every state described below.

**Addendum, 2026-07-31 (ADR-0016):** Part D below is extended with a second,
fairness-adjusted ranking ("Bästa laginsats") added to Screens LB1 and LB2 —
see the "Addendum" subsection at the end of Part D. This does not redesign
the ranking math (that's `docs/adr/0016-cross-team-leaderboard-fairness.md`,
already decided) — only the UX built on top of it. Its own companion mockup:
`docs/design/phase2.7-effort-leaderboard-mockup.html`.

**Addendum, 2026-07-31 (ADR-0017):** a new **Part E**, at the end of this
doc (after Part D), extends Part B's chat flow (CH0-CH5, unchanged) with the
ability to attach one of the team's existing Shorts clips to a chat message
— one new screen (CH6, the compose-time clip picker) plus diffs to CH1's
composer and message-list rendering. Built directly against
`docs/adr/0017-chat-clip-attachments.md` and reuses `docs/design/
phase3-flows.md`'s Screens V9/V10 (clip report/confirmation) unmodified.

**Read this first if you're frontend-developer:** three of the four parts
below touch code that already exists (`mobile/src/team/TeamScreen.tsx`,
`mobile/src/home/components/TeamPoolCard.tsx`, `mobile/src/goal/`) — this
doc calls out exactly what changes on each existing screen versus what's
new, so treat it as a diff against the current implementation, not a
from-scratch spec.

---

## Part A — Fas 2.6a: teammates + captain visibility, self-service transfer

### Judgment call — the teammates list is a new baseline section on K1, not folded into K2

`GET /teams/:teamId/teammates` (ADR-0006 Decision 2) was deliberately built
**open to everyone**, precisely so "who's on the team, who's captain" stops
being locked behind K2's captain gate. Putting it inside K2 would waste that
— it would still only be one captain per team who ever sees it. **Decision:
a new "Spelare i laget" section lives directly on K1 (the "Laget" tab),
visible to every player**, right alongside the consent chips that are
already baseline content there.

This also answers a smaller, previously-noted problem in
`phase2-flows.md`'s own judgment call: K1 was flagged as "dead chrome" for
the ~14-in-15 non-captain players on a team, since its only captain-specific
content doesn't apply to them. A real, always-populated teammates list gives
every player, not just the captain, a reason to open "Laget" — the tab
becomes "who's on my team," not "the captain's tab that occasionally shows
me a number."

### Screen K1 — Laget (tab) — updated

**Trigger:** tapping the "Laget" tab (unchanged).
**API:** `GET /api/v1/teams/:teamId/dashboard` (unchanged) **+**
`GET /api/v1/teams/:teamId/teammates` (new call, fetched alongside the
dashboard on the same screen load — one extra request, not a second
round-trip visible to the player as a loading state, same "fire both,
render when both resolve" pattern this screen already uses for its single
call).

**Baseline content, every player — new section inserted between the consent
chips and the VM-Guld-tabellen card (Part D):**

- Small heading: **"Spelare i laget"**
- One row per teammate (reuses the avatar-circle treatment from K2's
  `RosterRow`, not `RosterRow` itself — this list has no consent chip, no
  "last trained" line, and no tap action, since none of that data exists on
  this response):
  - Avatar emoji + `screenName` — never real name.
  - If `isCaptain: true`: a small 👑 badge, right-aligned. No text label
    needed ("captain" in words) — the crown alone reads instantly and keeps
    the row scannable at a glance, matching the "minimal reading" brief.
- **Rows are not tappable, for anyone, including the captain viewing their
  own list.** This is a deliberate safety margin, not an oversight: the
  captain-transfer action is real and slightly irreversible-feeling (see K4
  below), and this list is exactly the kind of thing every player casually
  glances at multiple times — burying a "make this person captain" action
  behind a casual tap on a list everyone browses is how a fat-finger
  mistake happens. The transfer flow gets its own explicit, separate entry
  point instead (K4), reached only via a clearly-labeled button, never via
  a tap on this list.

**Captain-only card — one new button added, order matters:**

- Small header row: **"👑 Du är kapten"** (unchanged)
- Button: **"Se laget i detalj"** → K2 (unchanged)
- Button: **"Hantera veckans mål"** → G1 (unchanged)
- **New button: "Byt kapten"** → K4

**Next:** "Byt kapten" → K4. Everything else unchanged from the existing
K1 flow.

---

### Screen K4 — Välj ny kapten

**Trigger:** "Byt kapten" from K1's captain card. **Captain-only** — same
defensive posture as K2 (a non-captain who somehow reaches this route gets
bounced back with the same quiet-toast pattern K2 already uses: **"Den här
sidan är bara för lagets kapten."**).
**API:** `GET /api/v1/teams/:teamId/teammates` (reuses the same call K1
already made — refetch on entry rather than trusting K1's cached copy, since
staleness here would mean showing an out-of-date captain badge on a
screen whose whole job is "who can I hand this to").

Layout: a flat list, same row style as the K1 teammates section, but **now
tappable** — this is the one place in the app where tapping a teammate's row
does something, and it's reached deliberately, not stumbled into.

- Own row: shown but disabled/greyed, with a small **"(Du)"** label instead
  of a tap target — visible for completeness ("where am I in this list")
  without inviting a confusing self-transfer attempt (the server would
  reject it anyway with `409 captain_transfer_target_is_self`, but the UI
  shouldn't offer a button whose only outcome is an error).
- Any other row: tap → confirm sheet (below), not an immediate call — this
  is the "real, slightly irreversible-feeling action" the task called out,
  and it gets exactly one confirmation step, not a bigger multi-screen
  ceremony (a second confirmation would be friction without adding real
  safety, since the sheet's copy already states the consequence plainly).

Copy:
- Heading: **"Välj ny kapten"**
- Sub: **"Den du väljer blir lagets nya kapten direkt."**

**Confirm sheet** (same visual pattern as K2's existing
`ReminderActionSheet`/session-reissue confirm — a bottom sheet, not a
full-screen interrupt):

- Heading: **"Gör {screenName} till kapten?"**
- Body, honest about what happens immediately, but deliberately **not**
  styled or worded as a warning/destructive action — handing off captaincy
  is a normal, positive team-management moment, not something to scare a
  kid out of: **"{screenName} får kaptensknapparna direkt. Du är
  fortfarande med i laget som vanligt — och om {screenName} vill kan de
  alltid lämna tillbaka det till dig sen, precis som du gör nu."** (This
  last clause is a deliberate, honest reassurance: the action is immediate
  and the server enforces it strictly, but it is *not* a one-way door for
  the team as a whole — captaincy can always be handed forward again. This
  keeps the copy truthful without needing scarier "this cannot be undone"
  framing that isn't actually accurate at the team level.)
- Buttons: **"Avbryt"** (secondary) / **"Ja, gör {screenName} till
  kapten"** (primary — ordinary `flame`/`gold`-adjacent primary-button
  styling, explicitly **not** the red/destructive treatment this app
  reserves for things like "Avbryt målet." This is a judgment call worth
  stating plainly: a destructive-red confirm button on a positive action
  would teach a wrong lesson about what's risky in this app.)

**On confirm:** `POST /api/v1/teams/:teamId/captain-transfer { newCaptainPlayerId }`.

- **`200`** → back to K1, toast: **"Kaptensskapet är överlämnat till
  {screenName}. 👑"** K1 re-fetches both the dashboard and the teammates
  list, so the captain card disappears (this device's own `viewerIsCaptain`
  is now `false`) and the crown visibly moves to the new captain's row in
  the baseline teammates list — the same list every player already sees,
  so nothing about "who's captain now" needs a separate announcement to the
  rest of the team (see the judgment call below on why bystanders get no
  banner).
- **`409 captain_transfer_target_is_self`** — unreachable in practice (own
  row is disabled), kept as a generic-error fallback only: toast
  **"Något gick fel. Testa igen."**, sheet closes, list re-fetches.
- **`404 player_not_found`** / **`403 captain_transfer_target_not_on_team`**
  — a race (the target left the team or the list was stale): toast
  **"Kunde inte hitta den spelaren längre. Listan uppdateras."**, re-fetch
  the teammates list.
- **`409 captain_transfer_conflict`** (the defensive backstop) — toast
  **"Något gick fel. Testa igen."**, re-fetch both dashboard and teammates
  list (in the vanishingly unlikely case this device's own captain status
  changed mid-flow, the re-fetch is what surfaces that correctly, not a
  stale assumption).

**Next:** `200` → K1 (refreshed). Any error → stays on K4 with an updated
list.

---

### Screen K5 — "Du är kapten!" (client-only, one-time celebratory banner)

**This resolves ADR-0006's explicitly-flagged open question**: yes, the
*incoming* captain gets an active, in-app moment — not just a passive
`viewerIsCaptain` flip discovered on next load. Reasoning:

- Becoming captain is a real, positive role change for a kid — exactly the
  kind of moment CLAUDE.md asks this app to treat as a small reward, not
  a silent state change a player has to notice for themselves by opening
  the right tab.
- It costs nothing new on the backend: no push infrastructure, no new
  endpoint, no server-side "has this player seen their promotion" flag —
  it's built the same way Screen G3 (the weekly-goal bonus catch-up
  banner) already works in this app: a **locally-persisted "last known
  `viewerIsCaptain` value" flag**, compared on every app open/foreground
  against the freshly-fetched value from `GET .../dashboard`. When it flips
  `false → true` and the local flag hasn't recorded that transition yet,
  show a small banner once, then persist the flag immediately (same
  "set on display, not dismissal" rule G3 already established, so a killed
  app never re-shows it).
- This is a genuinely "boring," already-proven pattern in this exact
  codebase (`AppShell.tsx`'s `checkForCatchUp`) — reusing it here is less
  new surface area than inventing a different mechanism.

Copy (small banner, top of whichever tab is open, auto-dismiss ~3s, same
visual weight as `CatchUpBanner`, not a full-screen takeover — this is a
nice moment, not a huge one):

- **"👑 Grattis! Du är nu lagets kapten."**
- Sub: **"Du hittar dina nya verktyg i Laget-fliken."**

**Symmetric case, optional/cuttable:** the reverse flip (`true → false`)
on a device that *wasn't* the one that just performed the transfer (e.g. a
captain's second device, or the same captain regaining the role later) can
reuse the identical diff mechanism to show a small, neutral, non-blaming
banner: **"Kaptensskapet gick vidare till en lagkompis."** This only
matters for the rare multi-device case — the device that actually tapped
"Ja, gör ... till kapten" already gets its own direct toast from K4 and
doesn't need this too. Flagged as a nicety, same as `phase2-flows.md`'s own
"Du är kapten" badge — cut it if frontend-developer judges it not worth the
extra local-flag bookkeeping for Fas 2.6a.

**Why no banner for bystanders (every other teammate):** K1's teammates
list already shows the crown on whoever currently holds it, every time
anyone opens the tab — that's a real, always-visible answer to "who's
captain now," which is all a non-captain, non-outgoing-captain teammate
actually needs. Adding a push-style "X is now captain!" announcement to
everyone would be manufacturing urgency around a routine housekeeping
event — the opposite of what CLAUDE.md asks for.

---

## Part B — Fas 2.6b: Team chat

This is the highest child-safety-risk screen in the app so far. Every copy
decision below is written with ADR-0007 Decision 3's stated, unclosed gap
in mind: reporting is a real signal that reaches a human (a parent, maybe a
coach) by best-effort email, not a guaranteed or fast review path. **No
copy anywhere in this section should imply a faster or more certain
response than that.**

### Judgment call — a new "Chatt" tab, not a section inside "Laget"

The tab bar today (`mobile/src/AppShell.tsx`) has three built tabs
(Hem/Mål/Laget); a fourth, "Profil," was reserved in concept back in
`phase2-flows.md` but was never built and isn't on the current roadmap.
**Decision: add "Chatt" 💬 as a real fourth tab**, not a section folded
into "Laget."

Reasoning:
- Chat is genuinely a different *kind* of surface than "Laget" (team
  roster/management) — it's the one place in this app that's meant to be
  opened repeatedly through the day, the same "pick up the phone for two
  minutes" behavior CLAUDE.md explicitly wants to compete with
  TikTok/Snapchat for. Burying it as a sub-section of a low-frequency
  management tab works against that goal.
- Four tabs on a phone is still comfortable (this app's own earlier
  planning already assumed four slots); a fifth ("Profil") isn't being
  built now, so this doesn't crowd the bar today. If Profil is ever built
  later, that's its own sequencing question — not solved here.

**Tab order — a judgment call, not neutral:** **Hem, Chatt, Mål, Laget**
(chat placed second, ahead of Mål). Reasoning: expected visit frequency.
Hem is the daily core loop and stays first. Chat is the one surface a kid
plausibly opens several times a day (peer conversation, same engagement
shape as the apps this project explicitly wants to pull attention away
from — see CLAUDE.md's instruction to borrow that hook deliberately). Mål
is a weekly check-in at most. Laget (roster/captain tools/leaderboard
entry) is the least frequently opened of all. Ordering by real usage
frequency, not build order, is the point.

**Unread indicator:** a small dot on the "Chatt" tab (reusing the existing
`tab-dot`/`goalTabDot` pattern verbatim, not a red badge with a number —
consistent with this app's existing "presence, not count" convention),
shown when the poll (below) returns any message newer than a locally
stored "last viewed this team's chat at" timestamp, cleared the moment the
Chatt tab is opened (not on scrolling to the bottom — opening the tab is
enough of a signal).

### Screen CH0 — first-open guardrail explainer (one-time, client-only)

Shown once, the very first time a player opens the Chatt tab (tracked via
a local flag, same mechanism as everywhere else in this app) — **the
guardrails need to be known before the first message is typed, not
discovered by accident after something goes wrong.** A light card, not a
scary consent-form-style modal:

- Heading: **"Så funkar lagchatten"**
- Bullet 1: **"Bara ditt eget lag ser det du skriver här."**
- Bullet 2: **"Känns något fel? Du kan rapportera ett meddelande, eller
  blockera en person så du slipper se fler av deras meddelanden."**
- Bullet 3: **"Vissa ord funkar inte här. Om ett meddelande inte går att
  skicka, testa att skriva om det."**
- Button: **"Okej, jag fattar!"** → dismiss, set local flag, show CH1.

### Screen CH1 — Lagchatt (tab)

**Trigger:** tapping the "Chatt" tab (after CH0, if first open).
**API:** `GET /api/v1/teams/:teamId/chat/messages` on open, then **polled
every ~5 seconds while this screen is focused** (paused entirely when the
app is backgrounded or a different tab is active — ADR-0007 Decision 5's
"boring, no WebSocket" choice, at a cadence appropriate for a "handful of
players" team). `after` is set to the newest message's `createdAt` already
held by the client, so each poll only asks for what's new.

**No backward pagination exists in the contract (`after`/`limit` only, no
`before`/offset)** — this screen shows a rolling window of the most recent
messages (`limit` default 50), not a searchable full archive. **Deliberate
design consequence, not a bug to patch around:** there is no "load older
messages" button anywhere on this screen, because the API has nothing to
serve it. This also happens to line up cleanly with CLAUDE.md's explicit
"no infinite scroll" instruction — a chat that only ever shows "what's
recent," full stop, rather than an endlessly scrollable history, is the
right shape for this app regardless of the API constraint. **Flagged for
architect**, not silently worked around: if a real product need for
"find that old message from last month" ever comes up, that's a genuine
new endpoint (a `before`/offset param), not something to fake client-side.

Layout:
- Message list, chronological, oldest at top, auto-scrolls to the newest
  message on open and on every new poll result.
- Each row: avatar emoji circle + `senderScreenName` (bold, small) above a
  message bubble containing `content`, with a small muted timestamp
  (clock time only for today's messages, date + time if older).
- **The viewer's own messages are visually distinguished from everyone
  else's** (right-aligned, or a distinct bubble fill) — ordinary,
  well-understood chat-app convention every kid this age already knows
  from other apps, so no new copy is needed to explain it.
- **Own-message bubble fill: deliberately not `flame` or `gold`.** Both
  colors are protected motifs (style-guide.md: "mine"/"ours" for
  streak/team-pool specifically) — reusing either for "which chat bubbles
  are mine" would blur that rule the style guide explicitly asks to
  protect. **Recommendation for frontend-developer:** reuse the
  already-existing `colors.pausedBg`/`pausedBorder` tokens (a soft neutral
  lavender, currently only used for the "paused consent" roster chip) for
  own-message bubbles — no new token needed, and it's visually unrelated
  to flame/gold. Confirm it doesn't read as alarming in context (it
  currently signals "paused," a mildly negative state) before committing;
  if it clashes, a new small neutral token is a fine alternative, just
  flag it as a style-guide addition rather than inventing it silently.

**Per-message report action — tap-to-reveal, not long-press:**
Tapping a **teammate's** message bubble (never your own — there's no
report affordance on your own messages, since reporting yourself protects
no one) reveals a small inline **"🚩 Rapportera"** text button just below
that bubble; tapping elsewhere collapses it again. **Deliberately not a
long-press/hold gesture**, even though that's the more common pattern in
adult chat apps (Snapchat/Messenger) — long-press is a hidden,
"advanced-user" gesture that a meaningful fraction of 9-year-olds won't
reliably discover on their own, and this is a safety action that needs to
be *findable*, not just technically present. A single, ordinary tap is the
lower-friction, more age-appropriate choice.

**Per-sender block action — a different tap target entirely, on purpose:**
Tapping the **avatar or screen name** (not the message body) of a
teammate's message opens a small sheet about that *person*, not that
message — see CH4. This physical separation (bubble body = "about this
message," avatar/name = "about this person") is the UI's answer to the
contract's explicit instruction not to conflate report and block into one
"flag this" affordance: they're reached from different, adjacent parts of
the same row, so the distinction is spatial as well as functional.

**Compose box** (bottom-fixed):
- Placeholder: **"Skriv något till laget…"**
- Multi-line, up to 500 characters; a small character counter appears only
  once the message passes ~400 characters (no counter clutter for an
  ordinary short message).
- Send button disabled while empty/whitespace-only or over the limit.

**Consent gate** (`403 consent_required` on send — a player whose parent
hasn't approved yet): the compose box is **visible but locked**, same
"don't hide the feature, show it disabled" rule Phase 1's `TrainedButton`
already established for the exact same consent-gate situation. A small
lock icon in place of the send button, with an inline note under the
compose box: **"Väntar på godkännande innan du kan skicka meddelanden. Du
kan fortfarande läsa vad laget skriver."** — reading stays available
(matches the contract: no consent gate on `GET`), only sending is locked,
and the copy says so plainly rather than leaving a kid guessing why the
button won't respond.

**Filter rejection (`422 message_rejected_by_filter`):** inline, small,
non-modal error under the compose box (this is expected to happen
occasionally, especially on a first attempt at working around it —
it doesn't deserve a full-screen interrupt). **Typed text stays in the
input**, per the contract's explicit instruction — nothing is cleared.

> **"Meddelandet skickades inte — det innehöll ord som inte funkar här.
> Skriv om det så går det bra! ✍️"**

Deliberately avoids "banned," "forbidden," "olagligt," or any language
that reads as an accusation — a kid's very first message might trip the
filter on an entirely innocent word caught by the evasion-normalization
logic (repeated letters, inserted spaces), and the copy needs to hold up
in that common case, not just the deliberate-swearing case. "Doesn't work
here, try again" is a correction, not a judgment.

**Send rate limit (`429 chat_send_rate_limited`):**
> **"Du skickar meddelanden lite snabbt just nu. Vänta en liten stund så
> går det bra igen."**

**Empty state, first-ever team chat** (no messages exist yet at all):
> Heading: **"Inga meddelanden än"**
> Sub: **"Skriv det första meddelandet till laget!"**

**Next:** no further navigation — this is a check-in/live view, same
"not a flow" pattern as G1.

---

### Screen CH2 — Varför rapporterar du det här?

**Trigger:** tapping the revealed **"🚩 Rapportera"** button under a
teammate's message.
**API:** submitting calls `POST .../chat/messages/:messageId/report`.

Layout: a bottom sheet, not a full screen (this should feel quick and
low-friction to use, since a real report shouldn't have to clear a lot of
steps to be filed).

- Small muted excerpt at the top, so the reporter can confirm they're
  reporting the right message without the sheet re-displaying the full
  content prominently: **"Du rapporterar: '{first ~60 characters of
  content}…'"**
- Heading: **"Varför rapporterar du det här meddelandet?"**
- Four large, tappable rows (radio-style, single-select — not a dropdown,
  per this app's "big obvious targets" rule):
  - **"Mobbning"** (`bullying`)
  - **"Olämpligt språk"** (`inappropriate_language`)
  - **"Skräppost"** (`spam`)
  - **"Annat"** (`other`)
- Optional note field, label: **"Vill du berätta mer? (frivilligt)"**,
  placeholder **"Valfritt…"**, 140-character cap with a counter.
- Primary button (disabled until a reason is selected): **"Skicka
  rapport"**
- Secondary: **"Avbryt"**

**On submit:**
- **`201`** → CH3.
- **`404 chat_message_not_found`** (rare race — the message was hidden by
  an out-of-band admin action between opening the sheet and submitting):
  toast **"Det där meddelandet finns inte längre."**, sheet closes, list
  refreshes.
- **`409 chat_message_already_reported_by_you`** — this viewer already
  reported this message: toast **"Du har redan rapporterat det här
  meddelandet."** (informational tone, not an error banner — they didn't
  do anything wrong).
- **`429 chat_report_rate_limited`** — **"Du har rapporterat en del på
  sistone. Vänta en liten stund innan du rapporterar igen."** (Neutral,
  not accusatory — a real spike of genuine reports could also trip this,
  and the copy shouldn't presume bad intent either way.)

---

### Screen CH3 — Tack för att du sa till (report confirmation)

**Trigger:** `201` from CH2's submit.

This is the single most important piece of copy in this whole feature to
get right, per ADR-0007 Decision 3's explicit, unclosed gap: **reassure
without promising anything this app cannot guarantee.**

- Heading: **"Tack för att du sa till."**
- Body: **"Vi har tagit emot din rapport. Du behöver inte göra något mer –
  och ingen får veta att det var du som rapporterade."**
- **Deliberately absent:** any promise of review time, any "we'll look at
  it right away," any claim that the message will be removed. The honest
  answer, per the ADR, is "a best-effort email goes to a parent and
  possibly a coach; there's no guaranteed timeline" — the copy simply
  doesn't make a claim it can't back up, rather than softening that gap
  with false reassurance.
- **A proactive, constructive follow-up — the one thing this player can
  act on immediately**, shown only when the reason was `bullying` or
  `inappropriate_language` (the categories where "I don't want to see more
  from this person" is the obviously relevant next step):
  > **"Vill du också slippa se fler meddelanden från den personen?"**
  > Button: **"Blockera {senderScreenName}"** → same action as CH4, no
  > extra sheet needed since the reporter already knows exactly why they'd
  > want this right now.
  > Secondary: **"Nej tack"** → dismiss.
- Primary button (always present): **"Klar"** → back to CH1.

---

### Screen CH4 — Om {screenName} (block)

**Trigger:** tapping a teammate's avatar or screen name on any of their
messages in CH1 (or the follow-up prompt from CH3).
**API:** `POST /api/v1/teams/:teamId/chat/blocks { blockedPlayerId }`.

Because a blocked sender's messages are filtered out server-side and never
appear in the list again, **this sheet — reached from a live message in
CH1 — can only ever offer "Blockera," never "Sluta blockera."** (Logically:
if you could still see their message to tap it, they weren't already
blocked.) The reverse action only exists in CH5 below.

- Heading: **"{screenName}"**
- Body: **"Om du blockerar {screenName} slutar du se deras meddelanden i
  lagchatten. {screenName} får inte veta att du har blockerat dem."**
  (States the silent-blocking behavior plainly and accurately — no copy
  anywhere should imply the blocked player is notified, since ADR-0007 is
  explicit that they never are.)
- Button: **"Blockera {screenName}"** — styled as this app's ordinary
  **secondary** button (the same visual weight as "Avbryt målet"), not a
  red/destructive button. This is a judgment call: blocking is a personal,
  protective action, not a punitive one being inflicted on the blocker —
  it doesn't need alarming styling, and alarming styling would make a kid
  hesitate to use a tool that's meant to give them fast, easy relief.
- Secondary: **"Avbryt"**

**On confirm:** `200` (idempotent — succeeds even if already blocked,
though that path is unreachable from this entry point as noted above) →
sheet closes, toast: **"Du ser inte längre meddelanden från
{screenName}."** Also: **write `blockedPlayerId` + `screenName` +
`avatarId` into a local device cache** (see CH5) — this is the only place
the client ever learns this information, since there's no `GET` endpoint
listing a player's own blocks (see the flagged gap below).

---

### Screen CH5 — Blockerade lagkompisar (block management — client-cache-backed, flagged limitation)

**Trigger:** a small, clearly labeled link in CH1's header: **"🚫
Blockerade"** (a text+icon combo, not an unlabeled gear icon — an icon
alone risks not being recognized as "settings" at this age).
**API:** `DELETE /api/v1/teams/:teamId/chat/blocks/:blockedPlayerId` per
row's unblock action.

**Real, stated gap, not silently designed around:** the contract has no
`GET .../chat/blocks` endpoint listing who a player has blocked — only
`POST` (block) and `DELETE` (unblock), targeted by a player ID the caller
already has to know. This screen is therefore **backed entirely by a local
device cache**, populated the moment a block succeeds (CH4). It works
correctly for the common case (block someone, later change your mind, on
the same device) but has a real limitation: **a fresh install or a new
device has no record of who was previously blocked**, even though the
block itself keeps working forever server-side (the block is enforced by
the backend's own query, not by client memory). This is stated plainly,
per this project's own established practice of naming a real gap instead
of quietly working around it — **flagged for architect**: a small
`GET /teams/:teamId/chat/blocks` endpoint (returning just
`{ blockedPlayerId, screenName, avatarId }` per row, resolvable against
the existing `teammates` endpoint's data) would remove this limitation
outright and is a reasonable, small fast-follow, not something to build
silently as part of this pass.

Copy:
- Heading: **"Blockerade lagkompisar"**
- Empty state: **"Du har inte blockerat någon."**
- Row: avatar + screenName + button **"Sluta blockera"** →
  `DELETE .../chat/blocks/:blockedPlayerId` → `200` → remove from local
  cache and from the list, toast: **"Du ser meddelanden från {screenName}
  igen."**

---

## Part C — Fas 2.6c: goal builder/history polish (small, not a redesign)

Per the project owner's decision this session: KB1–KB4 and G1/history
already satisfy Fas 2.6c's ask ("an easy way to create goals... and see
the goals that are created"). Reviewed `phase2-flows.md`'s Part 2/3 and
`mobile/src/goal/` directly. Four small, concrete polish items — nothing
here is a new screen or a new endpoint.

1. **Show which activity type counts toward the goal, on the goal card
   itself.** `GoalCard.tsx` today shows title, description, a plain
   `"{progressMinutes} / {targetValue} minuter"` bar, and an end date —
   but **never surfaces `targetMetric`** (Kondition/Teknik/Löpning/
   Annat/Totalt). A player reading "420 / 600 minuter" has no way to tell
   *what kind* of training counts unless the captain's free-text
   description happens to spell it out. This is a real, concrete point of
   first-use confusion for exactly the audience this app is built for —
   add a small icon+label chip (reusing KB2's existing metric table: 🏋️
   Kondition / 🏑 Teknik/övning / 🏃 Löpning / ⭐ Annat / 🎯 Totalt) next to
   the progress bar on both `GoalCard` (G1) and KB4's live preview, so the
   meter reads "420 / 600 minuter 🏃 Löpning" rather than a bare number.
2. **Reorder "Se tidigare mål" above captain-only actions, not below
   them.** Today (`GoalScreen.tsx`), the history link renders *after* the
   captain-action block — for a non-captain viewer this is already the
   first thing after the card (fine), but for the captain themselves it's
   pushed below their own management buttons. Since Fas 2.6c's own wording
   treats "see the goals that are created" as a first-class ask, not a
   footnote, move the link to sit directly under the goal card/empty-state
   card, before any captain-only buttons — same destination, just
   consistently prominent regardless of who's looking. While reordering,
   also bump it from a small underlined text link to the existing
   `SecondaryButton` treatment (still lower-emphasis than the primary
   goal actions, but more visually findable than fine print) — a purely
   cosmetic change, no new component.
3. **Show the final tally on completed history rows, not just a status
   pill.** The history list (`GoalScreen.tsx`'s `history` view) currently
   shows only title, a status pill (`Avslutad`/`Avbruten`), and dates. The
   underlying data (per `phase2-contract.md` endpoint 8) already includes
   `progressMinutes`/`targetValue`/`bonusPointsAwarded` for every row — add
   a small muted recap line for `completed` rows only: **"{progressMinutes}
   / {targetValue} minuter · +{bonusPointsAwarded}p bonus"**. This costs
   nothing new to fetch (the field is already in the response and simply
   unused today) and turns "Tidigare mål" from a flat administrative log
   into a small trophy-case list — directly serving CLAUDE.md's
   "reinforce the reward loop" instinct, at near-zero build cost.
4. **Give the "Inget mål just nu" empty card a small icon**, not just two
   lines of text (`GoalScreen.tsx`'s `emptyCard`) — e.g. a muted 🎯 or 💤
   accent next to the heading. Minor, but consistent with this app's
   general preference for a glance-able visual over reading a full
   sentence to understand a state.

Nothing above changes the API, the state machine, or any existing copy not
listed here.

---

## Part D — Fas 2.7: VM-Guld-tabellen (cross-team leaderboard)

### Judgment call — new name: "VM-Guld-tabellen"

"Lagets VM-Guld-pott" ("the team's VM-Guld pot") described a *container
filling up toward a goal* — accurate for the old goal-threshold framing,
wrong for a leaderboard. **Decision: rename to "VM-Guld-tabellen"** ("the
VM-Guld table/standings").

Reasoning: **"tabellen"** is the ordinary Swedish word for a sports league
table (Allsvenskan-tabellen, SHL-tabellen, etc.) — every kid who follows
real football/hockey/floorball already knows exactly what this word means
without any explanation. It preserves the "VM-Guld" brand equity this app
has already built (the aspirational "chasing World Championship Gold"
framing stays intact — this isn't a rename away from that idea, just an
honest update to "how you check your standing" now that there's no fixed
goal). It's also a small, real, deliberate example of "borrow the
psychological hook, not the dark pattern": a league table is exactly the
kind of comparative, always-checkable number Duolingo/sports-app
leaderboards use to keep people coming back — legitimately motivating here
since it's team-vs-team, never player-vs-player, and never shows anything
but a name and a number.

### Screen LB1 — the VM-Guld-tabellen card (replaces `TeamPoolCard`, everywhere it's used)

This is a rewrite of the existing shared `TeamPoolCard` component, shown in
the same places it already appears (`HomeScreen`/H1, `TeamScreen`/K1) — not
a new, additional card living alongside the old one. **The old
percent-fill progress bar is removed entirely, not reinterpreted** — there
is no threshold left for a bar to represent, and drawing one anyway (e.g.
against the leader's score) isn't buildable from the data these compact
card locations receive (`GET /players/me` and the dashboard only carry
`rank`/`teamCount`, deliberately not the whole leaderboard — see the
contract's hot-path reasoning). A plain number and rank, no bar, is the
honest reflection of "no maximum anymore."

**The whole card becomes tappable** (it wasn't before) → opens LB2.

Copy, normal case:
- **"🥇 VM-Guld-tabellen"**
- Big figure: **"{pointsTotal} poäng"**
- Rank line: **"{rank as Swedish ordinal} plats av {teamCount} lag"** (e.g.
  "3:e plats av 4 lag")
- Small trailing affordance signaling tappability, since the old bar's
  implicit "there's more here" cue is gone: **"Se tabellen →"**

**Between-seasons case** (`teamPool.rank`/`teamCount` absent — this team
currently has no active pot): reads gracefully, not broken:
- **"🥇 VM-Guld-tabellen"**
- **"Ingen aktiv säsong just nu"**
- Sub: **"Ni är med igen så fort en ny säsong startar."**
- Still tappable → LB2 (which can still show every *other* team's
  standings, per the contract's graceful `requestingTeam: null` behavior).

**Swedish ordinal suffix — a real i18n detail, flagged for
frontend-developer:** Swedish ordinals aren't a single fixed suffix —
1:a, 2:a, 3:e, 4:e, ... 11:e, 12:e, 21:a, 22:a, 23:e... A hardcoded `":e"`
appended to every rank will read wrong for 1st/2nd/21st/22nd place. Build
this as a small, isolated ordinal-formatting helper (input: an integer,
output: the correct suffixed string), not an inline string template — both
so the Swedish rule is actually correct across all realistic team counts,
and so a future locale can supply its own ordinal-formatting function
instead of this one being baked into a layout string, per CLAUDE.md's
i18n instruction.

---

### Screen LB2 — VM-Guld-tabellen (full leaderboard)

**Trigger:** tapping LB1 from either Home or the "Laget" tab (each hosts
its own local `view` toggle to reach this screen, same lightweight
"no navigation library" pattern `GoalScreen`/`TeamScreen` already use for
their own sub-views — not a new nav dependency).
**API:** `GET /api/v1/teams/:teamId/leaderboard`.

Layout: a plain ranked list — deliberately no fancy visualization, matching
the project's own "boring, no impressive-but-unnecessary" posture, and
matching how a real sports table actually looks:

- Heading: **"VM-Guld-tabellen 🥇"**
- One row per team: **rank · team name · points**, e.g. **"1:a — IBK
  Härnösand P12 — 2 200 p"**.
- **The viewer's own team's row is visually highlighted** (a tinted
  background/border, e.g. a gold-tinted edge) **in its natural sorted
  position**, not pinned to the top separately — this reads exactly like a
  real league table with "your team" highlighted, a familiar convention
  from real sports apps, rather than an artificial "you" row bolted on
  above the real list.
- **Tie handling — shown by simple repetition, not extra decoration.**
  Two teams tied at the same points both show the same rank number back to
  back (e.g. both rows read **"2:a"**), and the next distinct score skips
  accordingly (**"4:e"**, never "3:e") — exactly the contract's own
  example. **A small, one-line, conditionally-shown caption** appears
  above the list **only when the current list actually contains a tie**:
  **"Delad poäng ger samma placering."** ("A shared score gives the same
  rank.") This is a cheap, one-time explanation so a kid seeing two "2:a"
  rows back-to-back reads it as "that's how ties work," not "this looks
  broken" — shown only when relevant, never as permanent chrome on a list
  that has no ties.
- **This team's own missing-season case** (`requestingTeam: null`): a
  banner at the top of the list, plain and non-alarming (no red/error
  styling): **"Ert lag har ingen aktiv säsong just nu — men kolla in de
  andra lagens poäng!"** The rest of the list still renders normally below
  it, with no row highlighted (there's nothing to highlight).
- **Whole-leaderboard-empty case** (no team anywhere currently has an
  active pot — realistic in an early beta with only one or two pilot
  teams): **"Ingen tabell att visa än."** / sub: **"Kom tillbaka när fler
  lag har en aktiv säsong."** Not an error state — just early-beta reality,
  stated plainly.
- **Single-team case** (only this team has an active pot; no other teams
  registered yet) reads correctly as-is — **"1:a plats av 1 lag"** — this
  is not a bug to hide or a state to special-case away, just an accurate,
  boring reflection of where the beta currently is.

**Next:** no further navigation — a check-in view, same "not a flow"
pattern as G1/CH1.

---

### Addendum (2026-07-31, ADR-0016) — "Bästa laginsats" fairness-adjusted ranking

Adds a second ranking, additive only — **nothing above this line changes.**
Built against `docs/adr/0016-cross-team-leaderboard-fairness.md`'s Decision
5 response shape (`requestingTeamEffort`/`effortLeaderboard` on the same
`GET /teams/:teamId/leaderboard` call LB2 already makes, plus
`effortRank`/`eligiblePlayerCount` on the dashboard/`me` `teamPool` block
LB1 already reads). No new endpoint, no new network round-trip anywhere in
this addendum.

**Naming call:** tab labels are **"Mest poäng"** (existing raw view,
unchanged) and **"Bästa laginsats"** (new). "Laginsats" ("team effort") is
plain, warm, ordinary Swedish a 9-year-old already understands without
explanation, and it reads like something you'd genuinely be proud of, not
like a stats-nerd label — consistent with this app's "reads as celebration,
not algorithm output" brief. Kept it over the alternative "Poäng per
spelare," which is more literally accurate but frames the tab around a
number rather than a feeling, and over "Rättvis tabell" ("fair table"),
which invites the (unhelpful) implication that the other tab is *unfair*.

#### Screen LB2 — updated: tab/segmented control

**Layout, top of the existing list, directly under the "VM-Guld-tabellen
🥇" heading:** a two-segment pill control, equal width, big tap targets
(this app's "big obvious targets" rule applies here as much as anywhere —
this is the one new interactive control this addendum introduces):

- **"🥇 Mest poäng"** (default/initial tab — preserves today's behavior for
  a player who's never seen this control before)
- **"💪 Bästa laginsats"**

Active segment: `gold` fill, `ink` text (reusing the existing `btn-gold`
treatment already in this app's component vocabulary — no new button
variant). Inactive segment: plain `white`/`paper` fill, `ink` text,
`border` outline. **Switching tabs is instant, client-side only** — both
rankings already arrived in the one `GET .../leaderboard` response LB2
already fetches, so there is no loading state on tab switch, ever. Worth
stating explicitly because every other state transition in this screen
today *does* show a spinner (initial load) — this one deliberately doesn't,
and should read as snappy, not broken.

**Why gold, not flame, for the active-tab fill:** both rankings are
team-level ("ours") data per style-guide.md's flame/gold distinction —
neither view is "mine" in the streak sense, so flame is never a candidate
color anywhere on this screen, unchanged from today.

##### "Mest poäng" tab (selected)

Unchanged, byte-for-byte, from the existing LB2 spec above — same list,
same tie caption, same banners. **One small optional addition, flagged as
a nicety, cuttable:** if `requestingTeamEffort` is non-null and its `rank`
is numerically better than `requestingTeam.rank` (a genuine "you're doing
better than the raw total suggests" fact, not shown for its own sake but
because it's the one thing this tab can't otherwise tell a small team), a
single small tappable line appears below the tab control, above the list:

> **"🌟 Era spelare kämpar bra! Kolla Bästa laginsats →"**

Tapping it switches to the effort tab (same as tapping the segment
directly) — this is a discovery nudge, not a new destination. Skip this
entirely if it adds meaningful complexity to build; the tab itself is
always visible and reachable regardless.

##### "Bästa laginsats" tab (new)

**API data:** `effortLeaderboard` (the list) + `requestingTeamEffort` (own
team's row data — used only for the nudge above and LB3's sheet, not
rendered as a separate summary block; the own-team row is highlighted
in-place, same convention as "Mest poäng," not pinned to the top).

A permanent, non-conditional one-line caption directly under the tab
control (unlike the raw tab's tie caption, which only appears when
relevant — this one always appears here, because *every* row on this tab
needs the same one-time framing, not just rows involved in a tie):

> **"Ett rättvist snitt — så kan även mindre lag vinna."**

Followed by a small, always-visible text link, right-aligned or directly
under the caption: **"ⓘ Så räknar vi ut det"** → opens Screen LB3.

**Row layout — deliberate choice of what's prominent vs. secondary,**
directly answering the task's central question:

- **Rank** (same `swedishOrdinal` cell as today), **prefixed with 🏆 when
  `rank === 1`** — for *whichever* team currently holds the top spot, not
  only the viewer's own. This is the one small addition to a row that
  isn't the viewer's own team, and it's deliberate: a trophy on the actual
  leader is an ordinary, universally-understood sports-table convention
  (a kid who's never touched this app before still reads "🏆 1:a" as
  "this team is winning right now"), and it costs nothing extra to build —
  same `rank === 1` check either way, no viewer-specific branch. When the
  viewer's own team happens to be that row, the trophy + the existing
  gold-tinted "own row" highlight + the existing "Ditt lag" tag combine
  into a genuine "we're the effort champions" moment **without a single
  new string** — celebration by composition, not by new copy.
- **Team name** (unchanged treatment) **+ a small muted inline count**
  directly after it, reusing the "·" separator this app already uses
  elsewhere (`GoalScreen`'s history recap line): **"IBK Falken P13 · 1-2
  spelare."** Shown as a bucketed range (`'1-2'` / `'3-5'` / `'6+'`,
  `eligiblePlayerCountRange`), not an exact number — a raw count for a very
  small team would double as that team's exact consent/approval status,
  which is a per-child fact this app never surfaces across a team boundary
  (per ADR-0016's 2026-07-31 addendum). The bucket still earns its place on
  every row: it's the piece of context that makes "how can a small team
  rank above a 15-player team" self-explanatory at a glance, not a mystery.
- **`pointsPerPlayer` is the visually prominent number** on the right,
  same visual weight/position `pointsTotal` has on the raw tab (bold,
  `goldText`, right-aligned): **"{value} p/spelare"** (one decimal,
  sv-SE formatting, e.g. "72,5 p/spelare"). This is a deliberate call: it's
  the "honest, unadjusted" number per the ADR, and — worth naming
  explicitly — **"points per player" is exactly the same shape of stat as
  the "poäng per match" a floorball-following kid already sees in real
  league tables**, so this isn't a new kind of number to learn, just a
  familiar sports-stat framing applied to training effort.
- **`adjustedScore` does not appear on the row at all.** This is the
  answer to the task's central question: it's the number that actually
  decided the rank, but showing an abstract "shrunk toward the mean" value
  next to the honest per-player average on every single row would invite
  exactly the confusion the task worries about ("why does the order not
  match the number I can see") for no real benefit to a 9-year-old
  glancing at a list. It's fully available — see LB3 — but only for anyone
  who deliberately goes looking for the explanation, not thrust in front
  of every row by default. Prominent-number and de-emphasized-number,
  concretely: `pointsPerPlayer` is a first-class row field; `adjustedScore`
  is one sentence inside an opt-in help sheet.

**Tie handling:** identical mechanism to the raw tab (`hasTie()` over
`.rank`, same caption **"Delad poäng ger samma placering."**) — this
function already operates generically on any list with a `rank` field, so
it's reused verbatim against `effortLeaderboard`, not reimplemented.

**Empty/graceful states, mirroring the raw tab's own posture exactly:**

- `requestingTeamEffort === null` (own team currently has 0 eligible
  players — every player still consent-pending, or a brand-new
  self-created team): a plain, non-alarming banner at the top of the list,
  same visual treatment as the raw tab's "no active season" banner:
  > **"Ert lag är inte med i den här listan än — det behövs minst en
  > godkänd spelare."** The rest of the list still renders normally below
  > it, nothing highlighted.
- `effortLeaderboard.length === 0` (no team anywhere currently qualifies):
  > **"Ingen laginsats att visa än."** / sub: **"Kom tillbaka när fler lag
  > har godkända spelare."**
- Single-qualifying-team case reads correctly as-is, same posture as the
  raw tab's own single-team case — not specially hidden.

---

#### Screen LB3 — "Så räknar vi ut Bästa laginsats" (info sheet)

**Trigger:** the "ⓘ Så räknar vi ut det" link on the effort tab. **Not**
gated by a one-time local flag, unlike CH0 — this is reference material a
player might want to re-check any time curiosity strikes (e.g. after their
team's rank changes), not a one-time onboarding moment, so it stays
reachable forever rather than being shown once and hidden.

Layout: a bottom sheet, same visual pattern as CH2/K4's confirm sheets —
quick to open, quick to dismiss, not a full-screen interrupt for what is,
after all, just an explanation, not a decision.

- Heading: **"Så räknar vi ut Bästa laginsats"**
- Body, three short lines, deliberately not one dense paragraph (skimmable
  in the "two minutes between picking up the phone and getting bored"
  window this app is designed for):
  > **"Vi jämför hur många poäng varje lag får per spelare — inte bara
  > lagets totalsumma. Så kan även ett litet lag vinna genom att alla
  > kämpar på."**
  >
  > **"Om ett lag är litet räknar vi lite försiktigt, så att några enstaka
  > riktigt bra dagar inte råkar ge förstaplatsen av en slump. Ju fler
  > spelare ett lag har, desto mer litar vi på deras eget snitt."**
- **Own-team transparency line — shown only when `requestingTeamEffort` is
  non-null**, the one place `adjustedScore` is actually surfaced, in
  context, attached to a number the player already trusts
  (`pointsPerPlayer`) rather than floating on its own:
  > **"Ditt lag: {pointsPerPlayer} p/spelare med {eligiblePlayerCount}
  > spelare → {adjustedScore} p när vi räknar rättvist."**
  >
  > (This line reads `requestingTeamEffort.eligiblePlayerCount` — the
  > requesting team's own exact count, never bucketed. Only `'1-2'`/`'3-5'`/
  > `'6+'` on *other* teams' effort-tab rows is bucketed; a team always sees
  > its own exact number here, unaffected by ADR-0016's 2026-07-31
  > addendum.)
- Button: **"Okej, jag fattar!"** (identical copy to CH0's dismiss button —
  deliberate reuse, not a new phrase to write/translate for the same
  "got it, thanks" moment).

**Next:** dismiss → back to the effort tab, unchanged.

---

#### Screen LB1 — updated: dashboard/"Laget" home-card gets a compact effort line

The card stays compact by design — this is a teaser, not the leaderboard
itself, and the task's own brief is explicit about not cluttering it. Exact
placement, in order (top to bottom, nothing above this line changes):

1. "🥇 VM-Guld-tabellen" (unchanged)
2. Big points figure (unchanged)
3. Rank line, **"{rank} plats av {teamCount} lag"** (unchanged)
4. **New, small, muted line — only rendered when `effortRank` is present**
   (i.e., an active season exists **and** the team has at least one
   eligible player; absent in both the "between seasons" case and the
   "0 eligible players" case, same graceful-omission convention the rank
   line itself already uses for "between seasons"):
   > **"🌟 {effortRank as ordinal} bäst i laginsats"** — e.g. "🌟 2:a bäst i
   > laginsats."
5. "Se tabellen →" tap hint (unchanged)

**Deliberately not shown on the card:** `eligiblePlayerCount`,
`pointsPerPlayer`, `adjustedScore` — none of those numbers earn a place on
a glanceable teaser card; they live on LB2/LB3 for anyone who taps through.
One small emoji-prefixed line is the entire footprint this feature gets on
the home card, styled visually secondary to the existing rank line (smaller
size, same `goldText`/muted family, not competing with the big points
figure for attention).

**Tap target unchanged:** the whole card is still one `Pressable`, opening
LB2 on the default "Mest poäng" tab, same as today. **Considered and cut:**
making the new effort line its own nested tap target that deep-links
straight to the effort tab — technically awkward (nested `Pressable`s) for
a low-value shortcut, and this app already has a documented aversion to
multiple tap targets on a small, frequently-glanced card (see K1's
teammates-list judgment call). One tap target, one destination, stays true
here too.

---

## Part E — Fas 2.6b addendum (ADR-0017): chat message clip attachments

Extends Part B above — **CH0-CH5 are unchanged**, this only adds one new
screen (CH6) and diffs to CH1. Built directly against
`docs/adr/0017-chat-clip-attachments.md`'s Decisions 1-6 and the `clipId`/
`clip` fields it adds to `docs/api/phase2.6b-contract.md`'s endpoints 1-2.
Also reuses two Fas 3 screens **verbatim, unmodified**: V9 (the clip
report-reason sheet) and V10 (its confirmation), `docs/design/
phase3-flows.md` — see "Report affordance" below for why no new report UI
is designed here at all.

No new companion mockup — this addendum is small enough, and close enough
to `phase2.6-2.7-mockup.html`'s existing chat-bubble language and
`phase3-mockup.html`'s existing clip-card language, that a third mockup
file wasn't judged worth building; flagged as optional if
frontend-developer wants one before implementing.

### Judgment call — one small icon button in the compose row opens the picker; attaching is not a separate "mode"

CH1's compose box (Part B) is a single text input + send button. **Decision:
add one small icon button, "🎬," to the left of the text input**, same row,
same height — tapping it opens CH6 (below). This keeps the composer a
single, familiar row rather than introducing a second input mode a kid has
to switch into and out of (e.g. a "text vs. clip" toggle) — a player can
type, attach, remove, and retype in any order, exactly like attaching a
photo in an ordinary messaging app already works, a pattern this age group
already knows from outside this app.

**Locked exactly like the rest of the compose box under `consent_required`**
(Part B's existing rule for the text input/send button) — the 🎬 button is
**visible but disabled**, greyed, same lock treatment. Tapping it while
locked shows the same existing toast: **"Väntar på godkännande innan du kan
skicka meddelanden. Du kan fortfarande läsa vad laget skriver."** No new
copy needed for this case. This is also, conveniently, never actually
reachable in practice: `GET .../teams/:teamId/clips` (the endpoint CH6
calls, per ADR-0017 Decision 3) is itself consent-gated per
`docs/adr/0010-video-storage-and-serving.md`'s Decision on gated reads, so
a consent-pending player couldn't successfully open the picker even if the
button weren't disabled — the composer lock and the picker's own data
dependency agree with each other for free, not a coincidence worth
re-deciding.

### Screen CH6 — Bifoga ett klipp (compose-time clip picker)

**Trigger:** tapping the 🎬 button on CH1's compose row (only reachable when
consent is approved, per above).
**API:** `GET /api/v1/teams/:teamId/clips` (`docs/api/phase3-contract.md`
endpoint 3) — **the exact same call and response shape the Klipp tab's own
feed (Screen V2) already uses**, per ADR-0017 Decision 3: team-scoped,
`published`-only, the viewer's own block list already filtered out
server-side, paginated, freshly-presigned `playbackUrl` per item. No new
backend capability — this screen is a second *renderer* of data V2 already
fetches the same way, not a new data source.

**Layout:** a near-full-height sheet (not a small bottom sheet like CH2/K4
— this needs real browsing room), header **"Bifoga ett klipp"** with a
close **"✕"** (dismiss, no selection made, returns to CH1 with the composer
exactly as it was).

Below the header: a **two-column grid of clip cards** (not a vertical list
like V2) — a grid reads faster for "scan and pick one," the same reason a
native photo/video picker on a phone already uses a grid, a metaphor this
age group already knows without any explanation needed. Each card:

- The clip itself, **paused at its first frame** (no separate thumbnail
  asset exists or is generated — see the in-message embed section below for
  why this is the deliberate, consistent choice across this whole
  addendum), muted, **not tappable to preview-play inside the picker** — a
  single tap on a card **selects and attaches it immediately**, closing the
  sheet and returning to CH1 with the clip now shown in the composer's
  preview chip (below). No separate "confirm" step — exactly as low-friction
  as picking a photo from a native gallery picker, and nothing is
  irreversible yet: the composer's own preview chip has its own remove
  button before Send is ever tapped.
- Small caption below the thumbnail: avatar emoji + `uploaderScreenName`
  (any teammate's clip is pickable, not just the player's own — per ADR-0017
  Decision 3 — so this label matters, it's often not "your own" clip) + a
  short relative timestamp (**"igår," "för 3 dagar sedan"**), same format
  V2 already uses.

**Pagination:** identical convention to V2 — the initial `limit` batch
(default 20), then a plain **"Visa fler klipp"** button at the bottom of the
grid, not scroll-triggered auto-loading (same CLAUDE.md "no infinite
scroll" instruction V2 already follows; reusing the identical mechanism
here rather than inventing a picker-specific one).

**Empty state (a team with zero published clips yet)** — reads as an
invitation, not an error, same posture as V2's own empty state:

> Heading: **"Inga klipp att bifoga än"**
> Sub: **"Ingen i laget har laddat upp ett klipp än. Gå till Klipp-fliken
> för att ladda upp det första!"**
> Button: **"Gå till Klipp"** → closes CH6, switches the active tab to
> "Klipp" (V2/empty state, which itself has its own **"Ladda upp klipp"**
> entry point) — reuses the app's existing tab-switch mechanism, not a new
> navigation concept, and gives the player a real next step instead of a
> dead end.

**Next:** tap a card → attaches it, closes CH6, back to CH1 (composer now
shows the preview chip below). Tap **"✕"** or the empty state's "Gå till
Klipp" → back to CH1/Klipp tab, composer unchanged.

### Screen CH1 — updated: composer gains a removable clip-preview chip

**Trigger:** returning from CH6 with a clip selected.

A small horizontal chip appears directly above the text input (below any
already-typed text, part of the same compose area, not a separate screen):

- A small thumbnail (paused first frame, same treatment as CH6's grid
  cards, ~60×80dp — big enough to recognize which clip it is, small enough
  not to crowd the compose row).
- **"Från {uploaderScreenName}"** label next to it.
- A small **"✕"** in the thumbnail's corner — tapping it removes the
  attachment and returns the composer to a plain text-only state, typed
  text untouched.

**Send button enablement — updated rule** (per ADR-0017 Decision 4's
combined validation): the send button is enabled when **either** the text
input has non-empty, non-whitespace-only content **or** a clip is attached
(or both) — not text alone, as Part B originally specified. Still disabled
if text is over the 500-character cap, unchanged.

**On send:** `POST .../chat/messages { content, clipId? }`. New/updated
responses, on top of Part B's existing ones:

- **`201`** → message appears in the list (per CH1's existing "re-fetch/
  optimistic append" behavior, unchanged) with its `clip` block populated
  (per Decision 5, always populated on a successful send — see the embed
  rendering below). **Composer clears both the text and the attached-clip
  chip together** on success, same as it already clears text alone today.
- **`404 clip_not_found`** (new — a rare race: the picked clip was deleted,
  hidden, or its uploader got blocked between picking it in CH6 and hitting
  Send): **the typed text is preserved** (same existing rule for every
  other CH1 send error) **and the clip chip is automatically removed**,
  with a small toast: **"Klippet gick inte att skicka — det finns inte
  längre. Nu kan du skicka resten själv."** The player can immediately tap
  Send again for the text alone (if any), or reopen CH6 to pick a different
  clip. This is a deliberate, non-punishing recovery: the player didn't do
  anything wrong, so nothing about the rest of their message is lost.
- **`422 message_rejected_by_filter`** (unchanged trigger — only ever runs
  against non-empty `content`, per Decision 5's check order; a clip-only
  message with empty `content` can never trigger this) — **both the typed
  text and the attached-clip chip are preserved**, extending Part B's
  existing "typed text stays in the input" rule to the clip attachment too,
  so a filter rejection on the text never forces re-picking the clip.
- All other existing CH1 send errors (`consent_required`,
  `chat_send_rate_limited`, `400` empty-message) are unchanged in behavior;
  the `400` case's trigger condition is simply widened per Decision 4 (both
  empty text **and** no clip attached, rather than empty text alone) — no
  new copy needed, the send button being disabled already prevents a player
  from reaching it in the newly-widened case.

### CH1 — updated: in-message clip-embed rendering

**The central open question ADR-0017 hands off: autoplay, static
first-frame, or something else. Decision: static first-frame, tap to play,
muted by default — identical playback philosophy to Screen V2's feed, not
a new one invented for chat.**

Reasoning:

- **Consistency with the one other place this app already renders these
  exact bytes.** V2 (`docs/design/phase3-flows.md`) already answered this
  question for clips generally: "clips render as an ordinary vertical list
  of cards... not a full-screen, one-clip-at-a-time, swipe-to-advance,
  autoplay-on-load stack," muted by default, tap to play/pause, **no
  autoplay on scroll**. The same video bytes, reached from a second screen,
  autoplaying there while requiring a tap here would be an inconsistent,
  confusing double standard for identical content — a kid shouldn't have to
  learn two different rules for "does this video just start playing."
- **Chat is arguably the *worse* place to autoplay, not a neutral one.**
  CH1 polls every ~5 seconds and auto-scrolls to new messages (Part B,
  unchanged) — a chat screen a kid keeps open while chatting is exactly the
  surface where an autoplaying video embed would come closest to
  reproducing the autoplay-plus-constant-new-content mechanic CLAUDE.md
  explicitly names as the dark pattern to avoid, worse than V2's own
  deliberately-static list.
- **No new thumbnail concept is needed.** This app has no thumbnail image
  or thumbnail-generation pipeline today (ADR-0010 never built one, and
  ADR-0017's hand-off explicitly flags this as open) — "static first frame"
  means literally rendering the same `<Video>` element paused at position
  0, exactly the technique V2's own cards already rely on implicitly (no
  separate thumbnail asset exists there either). Reusing this costs nothing
  new to build; a thumbnail-generation service would be new infrastructure
  this phase has no evidence it needs (the same "boring, no new primitive"
  reasoning ADR-0010 already applied to deciding against on-device
  thumbnail extraction as a separate step).

**Layout inside a bubble that carries a clip** (text and a clip render
together, per Decision 3/4 — never either/or):

1. Sender row (avatar + `senderScreenName`) — unchanged from Part B.
2. **If `content` is non-empty:** the text, in the ordinary bubble-fill
   treatment — unchanged from Part B.
3. **If `clip` is populated:** a compact video card below the text (or in
   the bubble alone, if `content` is empty) —
   - Rounded corners, portrait aspect ratio (matches V2's own clips —
     that's genuinely how these are shot), but **capped to a smaller
     max-height than V2's full-width feed card** (recommend roughly
     220-260dp tall, frontend-developer's exact call) — this is a chat
     bubble in a scrolling conversation, not a dedicated feed, and a
     single embedded clip shouldn't dominate the visible screen the way
     it's allowed to on the Klipp tab itself.
   - A visible centered ▶️ play-button overlay on the paused first frame —
     called out explicitly here (V2's own spec doesn't state one, though
     frontend-developer may already have added one there) because a small
     embed sitting inside a dense chat bubble needs an unambiguous
     "this is a video, tap it" cue more than a full-width feed card does;
     worth retrofitting to V2 too if it isn't already there, but that's not
     this addendum's screen to redesign.
   - Tap the video area once → plays in place, muted, small speaker-icon
     toggle to unmute (identical control to V2's). Tap again → pause. No
     navigation away from CH1, ever.
   - **Recommended, not contract-required: only one embedded clip plays at
     a time across the visible chat.** Starting playback on one message's
     embed auto-pauses any other currently-playing embed in the same list
     — ordinary, expected behavior in any app with multiple inline videos,
     and avoids overlapping audio from two clips at once. Flagged as a
     recommendation for frontend-developer to confirm is cheap to build
     (a single "currently playing message id" ref), not a hard requirement.
   - **Below the video, only when relevant (kept compact when not):**
     - If `clip.caption` is non-empty: the caption text, small, muted.
     - If `clip.uploaderPlayerId !== message.senderPlayerId`** (any
       teammate's clip is attachable, so the clip's uploader and the
       message's sender are frequently different people) — a small,
       muted, **tappable** line: **"Klipp av {uploaderScreenName}"** →
       opens the existing CH4 sheet ("Om {screenName}") for **the clip's
       uploader**, not the message's sender. When uploader and sender are
       the same person, this line is omitted entirely (the sender's own
       avatar/name at the top of the row already covers it — no redundant
       second name shown).

**Technical flag for frontend-developer — polling must not interrupt
playback.** CH1 polls `GET .../chat/messages` every ~5 seconds (Part B,
unchanged), and per ADR-0017 Decision 5, every response mints a **fresh**
`playbackUrl` for every clip, every time. If the client naively replaces
each message object wholesale on every poll, a clip a player is actively
watching mid-scroll could have its underlying `<Video>` component
re-mounted (new `playbackUrl` treated as a new source) every ~5 seconds,
interrupting playback repeatedly. **Recommendation:** key message rows by
`id`, and for a message whose embed is currently playing, don't swap its
`playbackUrl` mid-playback on a poll refresh — the existing URL is still
valid for its own short presigned window regardless of what a later poll
re-mints. This is a genuinely new interaction between two mechanisms that
never had to coexist before this ADR (chat's 5-second poll cadence, and
clips' per-request-fresh presigned URLs) — flagged explicitly rather than
assumed to be handled implicitly by whatever list-rendering approach gets
built.

### The "clip unavailable" placeholder

**One single, generic, non-alarming placeholder, shown in place of the
video card, for every reason a `clip` can resolve to `null`** — self-delete,
retention expiry, report-hide, or the viewer having blocked the clip's
uploader (ADR-0017 Decision 2). The client cannot and structurally should
not try to distinguish which — a single, calm placeholder that reveals
*that* a clip is gone without ever implying *why*, exactly matching how V2
and V10's own copy already avoid ever asserting a specific cause to a
viewer who wasn't the reporter.

**Copy, adapted from the ADR's own placeholder suggestion, kept short and
non-alarming:**

> **"🎬 Videon är inte längre tillgänglig."**

Rendered as a compact, muted box roughly the height of one text line plus
the icon — **deliberately not the same tall footprint as a real video
card** — a small, unremarkable "nothing to see here" note, not a big empty
frame drawing extra attention to an absence. Neutral fill (`paper`/`border`
tones, `ink`-muted text), never red/alarming — the same "don't scare a kid
with styling that implies something went wrong" posture this doc already
applies to blocking (CH4) and captain transfer (K4), extended here since
this state is a routine content-lifecycle outcome (a clip aged out, or the
uploader deleted it themselves), not evidence of anything the *viewer* did
wrong.

**When the placeholder renders — a real, honest gap, stated plainly rather
than silently worked around:**

Per Decision 2, `clip: null` is the *identical* response shape for "this
message never had a `clipId` at all" and "this message had a clip that's
now gone" — the API contract as written gives the client no separate
signal distinguishing the two. Showing the placeholder on every plain
text-only message would obviously be wrong (every ordinary message would
sprout a broken-video note). The design below gets this right in two of
three cases without needing any new backend field, and is explicit about
the one narrower case it can't:

1. **`clip` is `null` and `content` is empty/whitespace-only** → **always
   show the placeholder.** This is a free, purely logical inference, not a
   heuristic: per Decision 4's own send-time validation ("both
   content-empty and clipId-absent is a `400`, rejected before it can ever
   be sent"), a message that reaches the client with empty `content` **and**
   a null `clip` can only have existed in the first place because it
   originally carried a clip that's since become unavailable — there is no
   other way such a message could have ever been successfully sent. Always
   correct, no gap.
2. **`clip` is `null`, `content` is non-empty, and this device previously
   saw this exact `messageId` with a populated `clip`** (i.e., during this
   same app session, an earlier poll rendered the embed, and a later poll's
   response for the same message now shows `clip: null`) → **show the
   placeholder**, tracked via a small in-memory "messages seen with a clip
   this session" set, not persisted. Correctly covers the common, real-time
   case: a clip gets self-deleted, hidden, or its uploader gets blocked
   *while the player has the chat open*.
3. **`clip` is `null`, `content` is non-empty, and this device never saw a
   populated `clip` for this `messageId`** (a fresh app open, or a device
   that never had the chat open while the clip was still resolvable — most
   likely after a **hard delete**, since ADR-0017 Decision 1's `ON DELETE
   SET NULL` FK genuinely erases the message's own `clip_id` column on
   self-delete/retention-expiry, indistinguishable at the database layer
   from "never had one") → **no placeholder is shown; the message renders
   as an ordinary text-only message.** This is a real, narrower gap than
   case 1/2 cover, not glossed over: a message that originally had *both*
   text and a now-hard-deleted clip will, after a cold start, silently lose
   any indication a clip was ever attached.

**Flagged for architect, not decided here:** case 3's gap would close
completely with one small addition — a `hadClip: boolean` on the message
response, set once at write time whenever `clipId` was present and **never
cleared**, independent of `clip_id`'s own nullability. This carries zero
content (no caption/thumbnail/uploader-name, just a single fact bit), so it
doesn't reopen the exact leak Decision 2 argues against avoiding (a
*content* snapshot) — it only ever answers "was a clip attached here,"
never "what was it or why is it gone," which is the same generic-placeholder
guarantee this design already relies on for cases 1 and 2. Recommended as a
small, low-risk follow-up; this addendum ships correctly without it (cases
1 and 2 are the common ones — a clip vanishing while the chat is closed
*and* the message had non-empty text is the narrow remainder), so it's not
treated as blocking.

### Report affordance — clip vs. message, resolved (ADR-0017 Decision 6)

**Decision: yes, offer both, as two separately-labeled options reached from
the existing tap-to-reveal zone on the bubble — not a new action sheet, and
not two new screens.** Both underlying flows already exist and are reused
completely unmodified:

- **"Rapportera meddelandet"** → opens the existing **CH2** (Part B),
  unchanged, calling the existing `POST .../chat/messages/:messageId/report`.
- **"Rapportera klippet"** → opens the existing **V9**
  (`docs/design/phase3-flows.md`), unchanged, calling the existing
  `POST .../clips/:clipId/report` with the `clipId` already known from the
  message's `clip` block — exactly the "no backend change needed, only a UI
  affordance decision" case the ADR's hand-off section names directly.

**Why a combined reveal, not a full action-sheet menu**: CH1 already has an
established "tap the bubble body, a small text-button reveals below it"
interaction (Part B) — reusing that shape and simply letting it reveal
**up to two** buttons instead of always exactly one is a smaller change than
introducing a new menu/sheet pattern for one feature. It also preserves the
existing spatial-separation rule (bubble body = "about this content," which
now sometimes means two pieces of content instead of one; avatar/name =
"about a person") rather than blurring it with a generic "..." menu.

**Which button(s) show — driven by two independent, pre-existing rules
("reporting yourself protects no one"), applied to the message's sender and
the clip's uploader separately, since Decision 3 means they're frequently
different people:**

| Message sender is... | Clip present & resolvable, uploaded by... | Reveal shows |
|---|---|---|
| a teammate | no clip / clip unavailable | **"🚩 Rapportera meddelandet"** only (unchanged from Part B) |
| a teammate | a teammate (uploader ≠ viewer) | both: **"🚩 Rapportera meddelandet"** and **"🚩 Rapportera klippet"** |
| a teammate | the viewer's own clip | **"🚩 Rapportera meddelandet"** only (can't report your own clip) |
| the viewer | a teammate (uploader ≠ viewer) | **"🚩 Rapportera klippet"** only (can't report your own message) |
| the viewer | no clip / the viewer's own clip / clip unavailable | **no reveal at all** — tapping your own plain bubble does nothing, same as today |

A clip in its **unavailable/placeholder state offers no report action at
all** — there's nothing for the client to report (no `clipId` is even known
to it in that state), which also means the placeholder can never
accidentally become a second, confusing path to "report a clip that
already isn't visible to anyone."

**The clip-uploader-attribution line ("Klipp av {uploaderScreenName}") stays
a *separate*, third tap target from this reveal**, opening CH4 (block) for
the uploader specifically — kept spatially distinct from the report reveal
for the identical reason Part B already keeps "report" (bubble body) and
"block" (avatar/name) apart: reporting and blocking are different actions
with different consequences, and this app's own established convention is
that the distinction should be spatial, not just textual, so a kid never has
to read carefully to tell them apart.

**No new screen, no new endpoint, no new tap-target *type*** — this
resolves Decision 6 by composition of what already exists (CH2, CH4, V9,
V10), the same "celebration/action by composition, not new build" instinct
Part D's ADR-0016 addendum already used for its own 🏆 trophy marker.

---

1. **Teammates list is a new, always-visible baseline section on K1**, not
   folded into the captain-only K2 — the whole point of `GET
   .../teammates` being open to everyone is wasted if only the captain
   ever sees it rendered.
2. **K1's teammates rows are never tappable, for anyone** — the
   captain-transfer action gets its own explicit entry point (K4) instead,
   so a casual glance at the roster can never accidentally trigger it.
3. **The incoming captain gets an active, one-time celebratory banner
   (K5)**, reusing the exact client-side "diff against a locally persisted
   flag" mechanism this codebase already built for the weekly-goal bonus
   catch-up (`AppShell.tsx`'s `checkForCatchUp`) — no new backend surface,
   answers ADR-0006's explicitly-flagged open question rather than
   re-deferring it. Bystanders get no banner (the always-visible crown
   badge already answers "who's captain now"); the outgoing captain's own
   device gets its confirmation directly in-flow from K4, not from this
   banner.
4. **The transfer confirm sheet is deliberately styled as an ordinary
   positive action, not a destructive/red one** — handing off captaincy is
   a normal team-management moment, and red "danger" styling on it would
   teach a wrong lesson about what's actually risky in this app.
5. **New "Chatt" tab, placed second (Hem, Chatt, Mål, Laget)** — ordered
   by realistic visit frequency, not build order; chat is the one surface
   meant to be opened many times a day, matching the attention this app is
   explicitly trying to compete for.
6. **Chat's report affordance is tap-to-reveal, not long-press** — a
   safety action needs to be reliably *findable* by a 9-year-old, not
   dependent on a gesture that's easy to never discover.
7. **Report and block are reached from physically different tap targets
   on the same message row** (bubble body vs. avatar/name) — the spatial
   separation reinforces the functional one the contract insists on.
8. **Report confirmation copy makes no promise about response time or
   outcome** — the honest answer, per ADR-0007 Decision 3, is a
   best-effort email with no guaranteed review path; the copy doesn't
   paper over that with reassurance it can't back up, but does proactively
   surface the one remedy the reporter can act on immediately (block).
9. **Blocking is styled as an ordinary secondary action, not a
   destructive/red one** — it's a personal, protective tool, and alarming
   styling would create hesitation to use it.
10. **Block-management (CH5) is client-cache-backed, with the limitation
    stated plainly** — no `GET .../chat/blocks` endpoint exists yet, so
    unblocking only works reliably on the device that performed the
    block. Flagged for architect as a small, reasonable fast-follow, not
    solved by inventing an endpoint here.
11. **No "load older messages" affordance in chat** — the contract has no
    backward-pagination param, and this happens to line up with CLAUDE.md's
    own "no infinite scroll" instruction; flagged plainly as a real
    capability limit, not silently designed around.
12. **New name: "VM-Guld-tabellen"**, replacing "Lagets VM-Guld-pott" —
    reuses the real Swedish sports-table term every kid already knows,
    preserves the existing VM-Guld brand framing rather than discarding it.
13. **Own-team's leaderboard row is highlighted in its natural sorted
    position, not pinned to the top** — matches how real sports-table apps
    already present "find yourself in the standings," rather than
    inventing a new convention.
14. **Ties are shown by simple, correct repetition of the rank number**,
    with a one-line explanatory caption shown only when a tie is actually
    present in the current list — cheap, non-permanent, and answers the
    task's explicit "show tie handling clearly to a kid" ask.
15. **Swedish ordinal-suffix formatting must be a real helper function, not
    a hardcoded string** — 1:a/2:a/3:e is a genuine grammar rule, not a
    fixed suffix, and baking it into a template string would both be wrong
    and violate CLAUDE.md's i18n instruction.

**Addendum (2026-07-31, ADR-0016):**

16. **Tab name "Bästa laginsats," not "Poäng per spelare" or "Rättvis
    tabell"** — the first names a feeling worth being proud of, matching
    this app's "reads as celebration" brief; the second frames the tab
    around a stat, not a feeling; the third implies the other tab is
    unfair, which isn't a message this app wants to send about a number
    (raw total) it also wants teams to stay proud of.
17. **`pointsPerPlayer` is a first-class, prominent row field;
    `adjustedScore` never appears on a row at all**, only inside the opt-in
    LB3 explainer sheet, attached to the player's own team's already-
    trusted numbers — directly answers the task's "does the abstract
    ranking number need a tooltip, or should it be de-emphasized" question
    in favor of full de-emphasis over a tooltip-per-row.
18. **`eligiblePlayerCountRange` — a bucketed range (`'1-2'`/`'3-5'`/`'6+'`),
    not an exact count — is shown inline on every effort-tab row** (unlike
    `adjustedScore`). It's still the piece of context that makes "how did a
    small team out-rank a big one" legible at a glance without requiring the
    explainer sheet; it's bucketed rather than exact because, on any other
    team's row, an exact small count would double as that one child's
    consent/approval status (ADR-0016's 2026-07-31 addendum) — the range
    keeps the row's legibility purpose intact while not exposing that. The
    requesting team's own numbers (LB3's transparency line, the dashboard
    home-card) are unaffected and stay exact.
19. **A 🏆 marks whichever team is rank 1 on the effort tab, not only the
    viewer's own team** — an ordinary, universally-read sports-table
    convention that costs no viewer-specific branch, and produces a
    genuine "we're the effort champions" moment purely by composition
    (trophy + existing own-row highlight + existing "Ditt lag" tag) when
    it does land on the viewer's team, with zero new copy needed for that
    case specifically.
20. **The dashboard home-card's new effort line is one small, emoji-
    prefixed string, with its own nested tap target explicitly considered
    and cut** — the card stays a single `Pressable` to one destination,
    consistent with this doc's own earlier judgment call (item 2) against
    stacking multiple tap targets on a small, frequently-glanced surface.

**Addendum (2026-07-31, ADR-0017 — Part E):**

21. **Clip attachment is one small 🎬 icon button in CH1's existing compose
    row, not a separate mode or screen** — a player can type, attach,
    remove, and retype in any order, matching how attaching a photo already
    works in ordinary messaging apps this age group already knows.
22. **The in-message clip embed uses the identical playback philosophy as
    the Klipp feed (V2): static first frame, muted, tap to play, no
    autoplay** — chosen for consistency (the same bytes shouldn't behave
    differently on two screens) and because CH1's 5-second poll plus
    auto-scroll would make autoplay here a *closer* approximation of the
    autoplay-plus-constant-new-content mechanic CLAUDE.md warns against
    than V2's own already-static feed.
23. **The "clip unavailable" placeholder is one generic, non-alarming line,
    shown correctly in two of three cases without any new backend field** —
    always correct when `content` is empty (a free logical inference from
    Decision 4's send-time validation) and when the client observed the
    clip live during the current session; the one narrower, honestly-stated
    gap (a hard-deleted clip on a message with non-empty text, discovered
    cold) silently renders as plain text rather than guessing — flagged for
    architect as a small `hadClip` boolean that would close it outright.
24. **Reporting a clip attached to a message reuses the existing CH2
    (report message) and V9 (report clip) screens unmodified, offered as
    two labeled options from the same tap-to-reveal zone CH1 already has**
    — resolves ADR-0017 Decision 6 by composition, no new screen, no new
    endpoint, no new tap-target *type*; which button(s) show is driven by
    "reporting yourself protects no one" applied independently to the
    message's sender and the clip's uploader, since Decision 3 means they
    can be different people.
25. **The clip-uploader attribution line ("Klipp av {screenName}") is a
    third, spatially separate tap target opening CH4 (block)** — kept apart
    from the report reveal for the same reason Part B already keeps report
    and block on physically different parts of a row: different
    consequences shouldn't share one tap target, even when they both start
    from the same message.

## Flagged for others, not decided here

- **Architect:** consider a small `GET /teams/:teamId/chat/blocks`
  endpoint — removes CH5's stated client-cache limitation outright (item
  10 above). Not urgent, not built here.
- **Architect/product:** if a real need for searchable/older chat history
  ever emerges, that's a genuine new `before`/offset pagination param on
  `GET .../chat/messages` — not something to fake client-side (item 11).
- **Frontend-developer:** the Swedish ordinal-suffix helper (item 15) and
  the own-message chat-bubble color recommendation (reusing
  `colors.pausedBg`, Part B) are both concrete enough to build directly,
  but worth a quick gut-check against the actual rendered screen before
  committing, per the notes inline above.
- **Security-reviewer:** Part B (chat) carries this doc's own copy for the
  filter-rejection/report/block flows written specifically with ADR-0007
  Decision 3's residual risk in mind — worth confirming the *copy*, not
  just the endpoints, doesn't accidentally overpromise a review guarantee
  this app can't deliver.
- **Frontend-developer (ADR-0016 addendum):** `pointsPerPlayer`/
  `adjustedScore` need a one-decimal, sv-SE-formatted number helper
  (`Intl.NumberFormat('sv-SE', { minimumFractionDigits: 1,
  maximumFractionDigits: 1 })` or equivalent) distinct from the existing
  whole-number `numberFormatter` both `LeaderboardScreen.tsx` and
  `TeamPoolCard.tsx` already use for `pointsTotal` — don't reuse the
  existing formatter as-is, it would drop the decimal. The "Mest poäng"
  tab's optional discovery nudge (this addendum's cuttable nicety) is a
  judgment call for build-time, not required for this feature to ship.
- **Architect (ADR-0017 Part E):** consider a small, content-free
  `hadClip: boolean` on the chat message response, set once at write time
  and never cleared by the `clip_id` FK's `ON DELETE SET NULL` — closes the
  one honestly-stated gap in the "clip unavailable" placeholder logic (item
  23 above: a hard-deleted clip on a message with non-empty text, seen
  cold by a client that never observed it live). Not blocking — the design
  ships correctly without it, this only tightens the one narrow remaining
  case.
- **Frontend-developer (ADR-0017 Part E):** the poll-refresh-must-not-
  interrupt-playback note under CH1's updated embed section is a real,
  new interaction between chat's 5-second poll and clips' per-request-fresh
  `playbackUrl` that didn't exist before this feature — worth confirming
  directly against however the message list ends up keyed/re-rendered, not
  assumed to be handled automatically.
- **Frontend-developer (ADR-0017 Part E):** the "only one embedded clip
  plays at a time" recommendation under CH1's updated embed section is a
  nicety, not a hard requirement — confirm it's cheap before committing to
  it, same posture as this doc's other explicitly-flagged niceties.
- **Security-reviewer (ADR-0017 Part E):** per the ADR's own hand-off, a
  confirmation pass on Decision 1's team-scoping and Decision 2's
  no-snapshot claim is warranted before merge; worth also confirming this
  doc's own placeholder-logic recommendation (case 2, the in-memory
  "seen with a clip this session" set) never itself becomes a place a
  cached caption/thumbnail could accidentally get stored — it's specified
  here as message-id-keyed presence tracking only, no clip content, and
  should stay that way in the implementation.
