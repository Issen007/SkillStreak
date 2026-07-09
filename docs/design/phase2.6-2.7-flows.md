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

## Judgment calls made in this doc (flagging, not silently deciding)

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
