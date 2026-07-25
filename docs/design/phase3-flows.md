# Fas 3 Flows — Klippflödet, uppladdning & rapportering

Status: draft, ux-designer-owned, for frontend-developer to build against.
Built directly against `docs/adr/0010-video-storage-and-serving.md` (as
revised 2026-07-22) and `docs/api/phase3-contract.md` — every screen below
is driven by a real request/response shape from that contract, not a
sketch. Visual language is `docs/design/style-guide.md`; screen-ID scheme
continues the existing O/H/K/CH/LB/G prefixes with a new **V-prefix**
("Video"). Where a flow reuses an *existing* screen (CH4/CH5's block
sheet), this doc says so explicitly and gives the copy diff, rather than
inventing a parallel screen — same "diff against what exists" posture
`phase2.6-2.7-flows.md` set for itself.

Companion mockup: `docs/design/phase3-mockup.html` (same phone-frame
pattern as the earlier mockups) — four illustrative screens: the feed
(V2), the caption/challenge step of upload (V5), the report-reason sheet
(V9), and the consent-gated waiting state (V1).

**Read this first, the highest-privacy-risk phase built so far:** every
copy decision below is written with two things in mind at once: (1) ADR-0010
Decision 4's explicit, deliberate divergence from chat — a report here
**immediately hides the clip**, not a no-op pending human review — so the
report-confirmation copy must say that plainly, not reuse chat's "nothing
happens automatically yet" framing; and (2) the same unclosed gap chat's
copy already had to hold — a best-effort email to a parent/coach is not a
guaranteed or fast review, and no copy anywhere below should imply
otherwise.

---

## Judgment call — a new "Klipp" tab, placed third (Hem, Chatt, Klipp, Mål, Laget)

Following the exact precedent `phase2.6-2.7-flows.md` set for "Chatt": a
real new tab, not a section folded into "Laget" or "Hem" — the whole point
of a short-clip feed, per CLAUDE.md's own framing, is to be the thing a kid
opens in the two idle minutes that would otherwise go to TikTok/Snapchat,
which needs its own first-class entry point, not a buried sub-section.

**Tab order reasoning (same "order by realistic visit frequency, not build
order" rule Part B of the chat doc already established):**
- **Hem** stays first — the daily core loop.
- **Chatt** stays second — still the single highest-frequency surface in
  this app: text replies are expected fast, and a small team plausibly
  generates several messages a day.
- **Klipp** is new, placed **third** — a real, frequently-checked pull (new
  video from a teammate is exciting), but a small roster realistically
  posts new *clips* far less often than it posts chat *messages*, so it
  sits just behind Chatt rather than tied with it. This is also, honestly,
  the single feature in this app closest in *shape* to the apps CLAUDE.md
  names as the competition — worth being deliberate that it earns its
  placement on realistic usage, not just because it's the flashiest new
  thing this phase ships.
- **Mål** fourth, **Laget** fifth — unchanged, both lower-frequency
  check-ins/management surfaces.

This makes five tabs total. Still comfortable on a phone (four already
proved fine in 2.6b; a fifth reserved-but-unbuilt "Profil" tab was already
anticipated in this project's own earlier planning) — not revisited here.

**Unread indicator:** same `tab-dot` convention as Chatt (a plain dot, not
a numbered badge) — shown when the feed's most recent `createdAt` is newer
than a locally stored "last viewed Klipp at" timestamp, cleared the moment
the tab is opened.

---

## Judgment call — the feed is a tap-to-play card list, not a TikTok-style autoplay swipe stack

This is the single most important framing decision in this doc, because
it's the one place this phase could most easily copy the wrong thing from
the apps it's borrowing the *format* from. **Decision: clips render as an
ordinary vertical list of cards** (avatar/name row, video area, caption,
action row) that the player scrolls and taps to play — **not** a full-screen,
one-clip-at-a-time, swipe-to-advance, autoplay-on-load stack.

Reasoning, directly against CLAUDE.md's own instruction: "make training
feel like the app... not to copy its dark patterns wholesale." TikTok's
actual engagement engine is the *combination* of autoplay + swipe-to-next +
bottomless supply — the exact mechanism that turns "two minutes" into
forty. This app borrows the **content format** (short, casual, team clips)
deliberately, per CLAUDE.md's explicit instruction to use that hook — but
the *delivery mechanism* is the boring, ordinary one this app already uses
everywhere else (a scrollable list, tap to act on any one item). A kid
opening Klipp sees what's new, taps what looks interesting, and the feed
runs out — it doesn't manufacture an infinite reason to keep swiping.

**Corollary — no auto-loading "infinite scroll," an explicit "Visa fler
klipp" button instead.** The contract's `GET .../clips` does support a
`before` cursor (unlike chat's message list, which has none) — but per
CLAUDE.md's explicit "no infinite scroll" instruction, this doc doesn't use
that capability to auto-fetch on scroll-threshold. The feed loads the most
recent `limit` (default 20) clips on open; reaching the bottom of that list
shows a plain, tappable **"Visa fler klipp"** button, not an automatic
fetch-on-scroll. A kid has to make one more deliberate tap to keep going —
small, but a real, deliberate difference from the pattern this app is
explicitly trying not to reproduce.

**Corollary — the feed fetches on tab-open/foreground plus manual
pull-to-refresh, not continuous polling like Chatt.** Chat polls every ~5s
because text replies are genuinely time-sensitive; video is not, and
re-minting a fresh presigned GET for every clip on screen every 5 seconds
would be real, pointless load for no benefit. `GET .../clips` is called
once when the Klipp tab gains focus (and again on foreground-from-background,
same as every other screen's `GET /players/me` refresh), plus an ordinary
pull-to-refresh gesture at the top of the list.

**Playback details:**
- Clips play **muted by default**, with a small speaker-icon toggle to
  unmute — the same realism Screen H5's success-animation note already
  established for this app (a kid's phone is often on silent at practice),
  and it also avoids an unexpectedly loud clip blasting out of a phone in a
  locker room full of teammates.
- Tap the video area once to play, again to pause. No autoplay on scroll.

---

## Screen V0 — Så funkar Klipp (first-open guardrail, one-time)

Shown once, the first time a player ever opens the Klipp tab — same
mechanism as CH0 (a local flag, dismissed once). Shown **regardless of
consent status** — the guardrails are worth knowing before a kid even
learns *why* upload is locked, not gated behind approval themselves (this
screen is pure information, no data is read or written).

Copy:
- Heading: **"Så funkar Klipp"**
- Bullet 1: **"Bara ditt eget lag ser klippen som laddas upp här."**
- Bullet 2: **"En förälder eller vårdnadshavare måste säga ja innan du kan
  ladda upp ett klipp själv."**
- Bullet 3: **"Känns ett klipp fel? Rapportera det så försvinner det
  direkt för hela laget, medan en vuxen tittar på det."**
- Bullet 4: **"Du kan alltid ta bort dina egna klipp, när du vill."**
- Button: **"Okej, jag fattar!"** → dismiss, set local flag, proceed to V1
  or V2 depending on `consentStatus`.

---

## Screen V1 — Väntar på godkännande / Pausad (consent-gated, whole-tab state)

**This is the divergence the contract calls out explicitly**: unlike
chat's ungated reads, `GET .../clips` itself returns `403 consent_required`
for a non-`approved` player — so this state occupies the **entire** Klipp
tab, not just a disabled upload button, the same way O7 occupies the whole
home screen's streak/CTA area but here there's no team-pool-card
equivalent to leave visible underneath (there's nothing else on this tab).

**Trigger:** `GET .../clips` → `403 consent_required` (or client-side, if
`player.consentStatus` is already known non-`approved` from `GET
/players/me` — no need to wait for the clips call to fail first if the
client already knows).
**API:** `GET /api/v1/teams/:teamId/clips`.

Same three-variant table as O7/H4 (this doc doesn't reinvent that pattern,
just extends it to a new surface):

| `consentStatus` | Icon | Headline | Body |
|---|---|---|---|
| `not_requested` / `pending` | ⏳ | **"Väntar på godkännande"** | **"En förälder eller vårdnadshavare behöver säga ja innan du kan se eller ladda upp klipp. Så fort de godkänner låser vi upp Klipp-fliken."** |
| `revoked` | ⏸️ | **"Klipp är pausat just nu"** | **"En förälder eller vårdnadshavare har dragit tillbaka godkännandet. Prata med din tränare om du har frågor."** |

Design notes:
- A small secondary action: **"Kolla igen"** (manual refresh), identical
  purpose to O7's.
- The upload entry point (the floating **"+"** button, see V2) is still
  **visible but disabled/greyed**, with a small lock icon — same
  "don't hide the feature, show it disabled" rule as `TrainedButton`/CH1's
  compose box. Tapping it while locked shows a small toast: **"Väntar
  fortfarande på godkännande innan du kan ladda upp."**
- No streak-loss framing, no guilt — identical reasoning to O7.

**Next:** `consentStatus` flips to `approved` on a later fetch → V2.

---

## Screen V2 — Klippflödet (tab)

**Trigger:** tapping the "Klipp" tab (after V0, if first open), with
`consentStatus === 'approved'`.
**API:** `GET /api/v1/teams/:teamId/clips` on open/foreground/pull-to-refresh
(see the playback-mechanics judgment call above for why this isn't polled
continuously).

**Layout, one card per clip, most-recent-first (matches the contract's
ordering):**
- **Header row** (tap target 1 of 3 — see below): avatar circle +
  `uploaderScreenName`, bold, small.
- **Video area** (tap target 2 of 3): the clip itself, muted by default,
  tap to play/pause. Rounded corners, fills the card width, fixed
  aspect ratio (portrait, matching how these clips are actually shot).
- **Caption** (tap target 3 of 3, see report/delete below): `caption`
  text, small, below the video. If no caption, this row is simply absent
  (no "no caption" placeholder text).
- **Challenge chip**, shown only when `taggedPlayerId` is non-null: a
  small pill, **"🎯 Utmanar {taggedScreenName}"** — visually distinct from
  the report/delete action row below it (this is content, not an action).
- Small muted relative timestamp (e.g. **"för 2 timmar sedan"**, **"igår"**)
  — no exact clock needed, this isn't a conversation.

**Three separate tap zones on a card, deliberately, mirroring chat's
"physically separate tap targets for physically separate concerns" rule:**

1. **Avatar/name row** (only on a *teammate's* clip, never your own — same
   "no acting on yourself" rule as chat) → opens the **existing CH4 sheet**
   ("Om {screenName}"), **not a new screen** — see the TeamChatBlock
   decision below for why this is a deliberate reuse, not a coincidence.
2. **Video area** → play/pause. Never reveals any action row — this is
   the one zone reserved purely for watching, so a kid isn't afraid to tap
   the video itself for fear of accidentally reporting or deleting
   something.
3. **Caption/timestamp area** (tap anywhere in this zone; a small "⋯" is
   also rendered as an explicit visual affordance so the zone is
   discoverable without a kid having to guess that plain text is tappable)
   → reveals a small inline action row just below, collapsing again on a
   second tap elsewhere, same tap-to-reveal (not long-press) rule chat's
   report affordance already established:
   - **On a teammate's clip:** **"🚩 Rapportera"** (red/muted text link,
     same visual treatment as CH1's `msg-report-link`).
   - **On your own clip:** **"🗑️ Ta bort klippet"** — never both on the
     same clip, same "reporting yourself protects no one" reasoning chat
     already uses for why there's no report link on your own messages.

**Pagination:** after the initial batch, a plain **"Visa fler klipp"**
button at the bottom of the list — see the judgment call above for why
this is a button, not scroll-triggered auto-loading.

**Empty state, no clips exist yet for this team:**
> Heading: **"Inga klipp än"**
> Sub: **"Bli den första att dela ett klipp med laget!"**
> A prominent **"Ladda upp klipp"** button directly in the empty state
> (not just the floating "+"), since there's nothing else on screen
> competing for attention.

**Upload entry point:** a floating **"+"** button, bottom-right, present on
every state of this screen (locked per V1 if consent isn't approved yet) →
V4.

**Where a mockup exists:** this screen (populated, normal case) is in
`phase3-mockup.html`.

**Next:** tap a card's video → plays in place (no navigation). Tap "+" →
V4. Avatar/name → CH4 (updated). Caption/"⋯" → reveals report/delete
inline action → V9 or V11.

---

## Screen V3 — "Du blev utmanad!" (client-only, one-time challenge notice)

**Resolves an open question this doc had to answer itself**: the contract
gives no notification mechanism for being tagged — `taggedPlayerId` is just
a field on the clip, discovered only by opening the feed. Per
`docs/PROJECT.md`'s own framing ("de kan också 'taga' en lagkompis och
utmana dem"), being challenged is meant to feel like a moment, not a fact a
kid has to notice by scrolling past it.

**Decision: reuse the exact K5/G3 "diff a locally persisted flag" mechanism**
this codebase already has proven twice — no new backend endpoint, no push
infrastructure. On every feed fetch, the client checks for any clip where
`taggedPlayerId === own playerId` whose `clipId` isn't already in a local
"seen challenges" set; if found (and this is the first time this device has
seen it), show a small banner, then persist the flag immediately (same
"set on display, not dismissal" rule G3 established, so a killed app
doesn't re-show it).

Copy (small banner, top of the Klipp tab, auto-dismiss ~3s, same visual
weight as `CatchUpBanner`):
- **"🎯 {uploaderScreenName} utmanade dig! Kolla in klippet."**

**Honest limitation, stated plainly, not glossed over:** this only ever
fires when the tagged player *opens the Klipp tab themselves* and the
diff runs — there is no push notification, and a kid who doesn't open the
app that day simply sees it whenever they next do. This is the same
honest posture the chat unread-dot already has (presence, not a guaranteed
timely alert), extended here rather than overpromising a "you'll know
immediately" framing this app has no infrastructure to back up.

---

## Part A — Uploading a clip

### Screen V4 — Välj klipp

**Trigger:** tapping the floating "+" on V2 (only reachable when
`consentStatus === 'approved'` — locked/toast otherwise, per V1).
**API:** none yet — this is the device's native camera/media-picker
(Expo's `expo-image-picker`/`expo-camera` video mode; an implementation
detail for frontend-developer, not designed here) presenting "Spela in" /
"Välj från galleriet."

Copy:
- Heading: **"Välj eller spela in ett klipp"**
- Sub: **"Klippet får vara upp till 20 sekunder."** (matches the
  contract's recommended cap — client-side pre-check against
  `durationSeconds`/`fileSizeBytes`/`mimeType` before ever calling endpoint
  1, so an obviously-too-long or wrong-format file is caught here with a
  same-screen inline message rather than a round-trip 400.)

**Next:** a clip is picked/recorded and passes the client-side pre-check →
V5. Fails the pre-check (too long, wrong format) → inline message, same
screen: **"Klippet är för långt — max 20 sekunder. Testa ett annat!"** /
**"Den filtypen funkar inte här. Testa en video från kameran eller
galleriet."**

---

### Screen V5 — Bildtext & utmana en lagkompis (frivilligt)

**Trigger:** a valid clip picked at V4.
**API:** none yet (client-side form state); submitting triggers endpoint
1, `POST .../clips/upload-url`.

Layout:
- A small looping muted preview of the picked clip at the top (so the kid
  can confirm it's the right one before typing anything).
- Caption input, placeholder **"Lägg till en bildtext (frivilligt)…"**,
  max 140 chars, counter appears past ~100 chars (same "no clutter until
  it matters" rule as chat's compose box).
- Section: **"Utmana en lagkompis? (frivilligt)"** — a horizontal
  scrollable row of teammate avatar+name chips (reusing the teammates-list
  visual style from K1), tap one to select (highlighted), tap again to
  deselect. No teammate selected by default.
  - Small helper text under the row: **"{screenName} ser att du utmanat
    dem nästa gång de öppnar Klipp."** (shown only once a teammate is
    selected — deliberately not overpromising an instant notification, see
    V3's honest-limitation note above.)
- Primary button: **"Ladda upp"**

**On submit:** `POST /api/v1/teams/:teamId/clips/upload-url` with
`{ mimeType, fileSizeBytes, durationSeconds, caption?, taggedPlayerId? }`.

- **`201`** → client immediately `PUT`s the raw bytes directly to
  `uploadUrl` (never through the API) → V6.
- **`403 consent_required`** (stale-state edge case — consent was revoked
  between opening V2 and submitting here): same pattern as Phase 1's stale-state
  edge case — toast **"Vi behöver fortfarande godkännande innan du kan
  ladda upp. Vi uppdaterar sidan åt dig."**, re-fetch `GET /players/me`,
  land back on V1.
- **`400` validation** (mime/size/duration over cap, caption over length,
  `taggedPlayerId` not a teammate): the first three should already be
  caught by V4's client-side pre-check and shouldn't normally reach here;
  a stale-teammate-list race on the tag (the tagged player left the team
  between opening this screen and submitting) gets a small inline error
  under the challenge row: **"Den spelaren är inte kvar i laget längre.
  Välj någon annan, eller ingen."**, tag selection cleared, everything else
  preserved.
- **`422 caption_rejected_by_filter`** — inline, non-modal, under the
  caption field, **typed caption preserved** (never cleared), identical
  posture/tone to chat's filter rejection:
  > **"Bildtexten gick inte att spara — den innehöll ord som inte funkar
  > här. Skriv om den så går det bra! ✍️"**
- **`429 clip_upload_rate_limited`**:
  > **"Du laddar upp klipp lite snabbt just nu. Vänta en liten stund så
  > går det bra igen."**

---

### Screen V6 — Laddar upp klippet…

**Trigger:** `201` from endpoint 1, client now `PUT`ing bytes to
`uploadUrl`.
**API:** the raw `PUT` (not through this app's own API — direct to MinIO,
per the contract), then `POST .../clips/:clipId/complete` once the `PUT`
finishes.

Layout: a determinate progress bar (driven by the `PUT` request's real
upload-progress events, not a fake animation — this can be a genuinely
slow step on a mobile connection for even a small video file), plus:
- Heading: **"Laddar upp klippet…"**
- Sub: **"Lämna inte appen — det tar bara en liten stund."**
- A visible **"Avbryt"** button.

**Judgment call — what "Avbryt" actually does:** the contract's `DELETE
.../clips/:clipId` is stated as unconditional/uploader-only with no
status restriction mentioned — reading that literally, it should be safe
to call on a still-`pending_upload` clip, not only a `published` one.
**Decision: "Avbryt" cancels the in-flight `PUT` client-side and then
calls `DELETE .../clips/:clipId` immediately**, rather than silently
abandoning the row to be swept up to ~1 hour later by the `pending_upload`
TTL job — faster cleanup, and it means a kid who changes their mind
doesn't leave a stray row sitting around even briefly. **Flagged for
backend-developer to confirm, not assumed silently**: this depends on
`DELETE` gracefully handling a clip that's still `pending_upload` and
possibly has no object in MinIO yet (a delete-if-exists, same shape the
TTL sweep already needs) — if that's not how it behaves today, the
fallback is simply to let "Avbryt" only stop the client-side `PUT`/dismiss
this screen and rely on the existing TTL sweep, which is still correct,
just slower.

**On `PUT` success →** `POST .../clips/:clipId/complete`.
- **`200`** → V7.
- **`409 upload_not_found`** (the `HEAD` check found nothing — a dropped
  connection mid-upload): per the contract, retry from endpoint 1 with a
  fresh `clipId`, not `complete` again for this one. Copy: **"Något gick
  fel med uppladdningen. Vi provar igen från början."** → automatically
  restarts from V5's submit (caption/tag preserved from the same form
  state, just a fresh `upload-url` call) rather than making the kid retype
  anything.
- **`422 clip_processing_failed`** (the mandatory metadata-stripping remux
  failed): same automatic-retry-from-scratch behavior and copy as above —
  deliberately **not** exposing *why* processing failed (no mention of
  metadata/location/technical internals) — this is a technical hiccup from
  the kid's point of view, not something to explain in privacy-adjacent
  detail: **"Något gick fel med uppladdningen. Vi provar igen från
  början."**

**If the `PUT` itself fails** (network drop, presigned URL's ~5-minute
window expired): same automatic-retry-from-scratch path, same copy.

---

### Screen V7 — Klippet är uppe!

**Trigger:** `200` from `complete`.
**API:** `complete`'s response (`caption`, `taggedPlayerId`, `createdAt`).

Brief, not a big takeover — this is a real but ordinary moment, smaller
than H5's streak celebration since there's no number ticking up here:
- Heading: **"Klippet är uppe! 🎉"**
- Sub: **"Laget kan se det nu."**
- Button: **"Till flödet"** → V2, with the new clip visible at the top
  (list re-fetched, not locally spliced in — keeps the client honestly in
  sync with whatever the server actually has, including the fresh
  presigned `playbackUrl`).

---

## Part B — Reporting a clip

### Screen V9 — Varför rapporterar du det här klippet?

**Trigger:** tapping the revealed **"🚩 Rapportera"** link on a teammate's
clip (V2).
**API:** submitting calls `POST .../clips/:clipId/report`.

Layout: a bottom sheet, same visual pattern as CH2.

- Heading: **"Varför rapporterar du det här klippet?"**
- **Five large, tappable rows (radio-style, single-select)** — order is
  deliberate, video-specific concerns first:
  - **"Jag är med i klippet och ville inte vara det"** (`appears_without_consent`)
  - **"Mobbning"** (`bullying`)
  - **"Olämpligt innehåll"** (`inappropriate_content`)
  - **"Har inget med träning att göra"** (`not_training_related`)
  - **"Annat"** (`other`)
- Optional note field: **"Vill du berätta mer? (frivilligt)"**, 140-char
  cap, same as chat's.
- Primary button (disabled until a reason is selected): **"Skicka
  rapport"**
- Secondary: **"Avbryt"**

**On submit:**
- **`201`** → V10.
- **`404 clip_not_found`** (rare race — someone else's report already
  hid it, or the uploader deleted it, between opening the sheet and
  submitting): toast **"Det där klippet finns inte längre."**, sheet
  closes, feed refreshes.
- **`409 clip_already_reported_by_you`**: toast **"Du har redan
  rapporterat det här klippet."** (informational, not an error — they
  didn't do anything wrong).
- **`429 clip_report_rate_limited`**: **"Du har rapporterat en del på
  sistone. Vänta en liten stund innan du rapporterar igen."** (same
  neutral, not-presuming-bad-intent tone as chat's identical case.)

---

### Screen V10 — Tack för att du sa till

**Trigger:** `201` from V9.

**This copy carries more weight than chat's equivalent (CH3), precisely
because the underlying behavior is different and the copy must say so.**
Per ADR-0010 Decision 4, this report just did something concrete and
immediate — it must not read like chat's "nothing visible happens yet"
framing.

- Heading: **"Tack för att du sa till."**
- Body: **"Klippet är nu dolt för hela laget, inklusive dig själv. Ingen
  får veta att det var du som rapporterade."**
- **A second, clearly separated line, holding the same honest limit chat's
  copy already had to hold — present, not overwritten by the confident
  first line above:** **"En vuxen får reda på det här, men vi kan inte
  lova exakt när klippet granskas igen."** (Deliberately: confirms the
  *immediate* mechanical fact — the clip is gone from the feed, right now
  — without extending that same confidence to "and someone will review it
  soon," which this app genuinely can't promise. This is the same
  discipline CH3's copy already required: state plainly what's true, don't
  round up.)
- **Proactive block follow-up — shown only when the reason was
  `appears_without_consent` or `bullying`** (the two reasons where "I
  don't want to see more from this person" is the obviously relevant next
  step, mirroring CH3's exact reasoning for its own two triggering
  categories):
  > **"Vill du också slippa se fler klipp och meddelanden från den
  > personen?"**
  > Button: **"Blockera {uploaderScreenName}"** → the existing CH4 sheet
  > (updated copy, see below) — no extra sheet invented, since the
  > reporter already knows exactly why they'd want this.
  > Secondary: **"Nej tack"** → dismiss.
- Primary button (always present): **"Klar"** → back to V2 (refreshed;
  the reported clip is now absent).

---

## Part C — Self-service delete

### Screen V11 — Ta bort det här klippet?

**Trigger:** tapping the revealed **"🗑️ Ta bort klippet"** link on your
own clip (V2).
**API:** `DELETE /api/v1/teams/:teamId/clips/:clipId`.

**Judgment call — one confirmation step, styled with this app's reserved
destructive/red button, not the ordinary primary/secondary treatment.**
Every other "are you sure" moment this app has built so far (K4's captain
transfer, CH4's block) deliberately avoids red/alarming styling, because in
both those cases the action is either not truly permanent (captaincy can
be handed forward again) or a protective, personal tool that shouldn't
carry hesitation (blocking). **Clip deletion is different: it is
genuinely, unconditionally, permanently irreversible** — the object is
hard-deleted from storage, the row is gone, and per the ADR this happens
even if the clip has open reports. That's the same category of action this
app already reserves red/destructive styling for elsewhere (per the
existing "Avbryt målet" precedent named in `phase2.6-2.7-flows.md`) —
using the ordinary calm styling here would understate the one thing this
screen actually needs to communicate honestly.

Sheet:
- Heading: **"Ta bort det här klippet?"**
- Body: **"Klippet försvinner permanent för hela laget — det går inte att
  ångra."**
- Primary button (destructive/red styling): **"Ja, ta bort klippet"**
- Secondary: **"Avbryt"**

**On confirm:** `200` → sheet closes, toast: **"Klippet är borttaget."**,
feed refreshes (clip gone). No further confirmation screen — the action is
complete the moment the toast shows, matching this app's "low friction for
a player's own authority over their own content" posture (ADR-0010's own
"real self-determination" framing) while still gating it behind the one
honest confirmation step above.

Errors (rare races):
- **`404 clip_not_found`**: toast **"Klippet finns inte längre."**, sheet
  closes, feed refreshes.
- **`403 not_your_clip`**: shouldn't be reachable (the delete link only
  ever renders on your own clips) — generic fallback toast **"Något gick
  fel. Testa igen."** if it somehow is.

---

## Decision — does blocking a teammate in chat also hide their clips?

**The contract left this explicitly open. Decision: yes — a `TeamChatBlock`
also suppresses that same teammate's clips from the viewer's feed.** No new
`ClipBlock` entity; the existing block relationship is reused as a single,
per-viewer "I don't want to see content from this person" preference that
spans both surfaces, not two independent per-feature settings.

**Reasoning:**
- **A block has always been framed as being about the *person*, not the
  *medium*.** CH4's own heading is **"Om {screenName}"** — "about this
  person" — not "about their messages." A kid who blocked a teammate over
  chat harassment almost certainly wants relief from that person
  altogether, not relief specifically scoped to the one app surface where
  the bad behavior happened to occur. Splitting it into two independent
  preferences would mean the exact same teammate whose chat messages a kid
  can no longer see could still show up, talking, on video, in the next
  tab over — a genuinely confusing and undermining outcome for a safety
  tool whose entire point is "I don't want this person in my feed
  anymore."
- **This is cheap, not a new build.** The clips feed query (endpoint 3)
  already needs one filtering join for `status != 'published'`
  (mandatory, per the contract's implementer note) — extending the same
  query to also exclude clips whose `uploaderPlayerId` is in the viewer's
  blocked-players set is the identical shape of change the chat
  message-list query already made for its own block filter, not a new
  mechanism.
- **Scope, stated precisely:** the filter is on the clip's
  **`uploaderPlayerId`**, not `taggedPlayerId` — if a blocked player tags
  the viewer in someone *else's* upload, that clip still shows (it wasn't
  posted by the blocked person; being tagged by them in someone else's
  clip is a different, smaller thing than seeing their own uploads). If a
  blocked player uploads a clip that happens to tag the viewer, it's still
  filtered — the block is about not seeing *their* content, full stop,
  regardless of who else is mentioned in it.

**Flagged for architect/backend-developer, not decided by this doc
alone**: this changes `phase3-contract.md` endpoint 3's stated filtering
rule (today it only documents the `status != 'published'` exclusion) — the
contract doc should be updated to state the block-filter exclusion
explicitly, the same way it already states the status one, per this
project's "structural, not a code-review reminder" bar for exactly this
class of query.

**Consequence — CH4/CH5's already-shipped copy needs a small update, not
just new V-screens:** CH4's body currently reads **"Om du blockerar
{screenName} slutar du se deras meddelanden i lagchatten."** — now stale,
since it understates what blocking actually does once Phase 3 ships.
**New copy:**
> **"Om du blockerar {screenName} slutar du se deras meddelanden i
> lagchatten och deras klipp i Klippflödet. {screenName} får inte veta att
> du har blockerat dem."**

CH5's heading/empty-state text doesn't need to change (it's already
generic, "Blockerade lagkompisar"), but its row copy or a small header sub
should also mention both surfaces now cover the same block, e.g. a small
muted line under the CH5 heading: **"En blockering gäller både lagchatten
och Klipp."**

---

## Parent-notification email copy (report → auto-hide, ADR-0010 Decision 4)

**security-reviewer's ask, addressed directly, for backend-developer's
`MailService` template — not owned or sent by this doc, but the tone/key
phrases are specified here since a single unverified report both hides the
clip and triggers this email, and the copy must not read as an
accusation already proven true.**

Two recipients, same trigger, slightly different framing (mirrors the dual
uploader-parent/coach send ADR-0010 already specifies):

### To the uploader's own parent

> **Ämne: En video från {uploaderScreenName} har rapporterats**
>
> Hej!
>
> En lagkompis har rapporterat en video som {uploaderScreenName} laddade
> upp i lagets klippflöde i appen. Vi har ingen automatisk granskning av
> videoinnehåll, så som en försiktighetsåtgärd är klippet nu dolt för hela
> laget, i väntan på att en vuxen kan titta på det.
>
> Det här betyder inte att något är fastställt fel med videon — bara att
> en rapport kommit in. Ni behöver inte göra något just nu. Om ni vill kan
> ni titta på klippet tillsammans med {uploaderScreenName}, eller höra av
> er till lagets tränare om ni har frågor. Videon är fortfarande sparad
> (inte borttagen) om ni vill se den innan ni bestämmer er för något.
>
> Hälsningar,
> SkillStreak

Key phrases worth preserving verbatim in the implementation, per
security-reviewer's ask:
- **"som en försiktighetsåtgärd"** ("as a precaution") — frames the
  auto-hide as a safety default, not a verdict.
- **"Det här betyder inte att något är fastställt fel"** ("this doesn't
  mean anything has been established as wrong") — the single most
  important sentence in the email; explicitly pre-empts the reading a
  worried parent might otherwise jump to.
- Deliberately **absent**: the reporter's identity (never revealed, same
  anonymity guarantee as everywhere else in this app), any language like
  "your child did something wrong," any claim about what happens next
  beyond "a video is dolt (hidden), the bytes still exist."

### To the team's coach (if on file)

> **Ämne: Ett klipp i {teamName}s flöde har rapporterats**
>
> Hej!
>
> Ett klipp som laddades upp av en spelare i {teamName} har rapporterats
> av en lagkompis och är nu dolt för laget, som en försiktighetsåtgärd. Vi
> skickar också den här informationen till spelarens egen förälder eller
> vårdnadshavare.
>
> Det finns ingen åtgärd som krävs av dig just nu — det här är bara för
> din kännedom, om du vill följa upp med laget.
>
> Hälsningar,
> SkillStreak

Same "informational, not a call to action, not an accusation" posture —
the coach email deliberately doesn't name the uploader either (the coach
already knows their own roster and can ask directly if they want to; the
email's job is presence/awareness, not a formal incident report).

---

## `consentStatus` → Klipp-tab state, at a glance

| `consentStatus` value | Klipp tab shows |
|---|---|
| `not_requested` / `pending` | V1, "Waiting" variant |
| `approved` | V2 (feed), or V0 first if never dismissed |
| `revoked` | V1, "Paused" variant |

---

## Judgment calls made in this doc (flagging, not silently deciding)

1. **A new "Klipp" tab, placed third (Hem, Chatt, Klipp, Mål, Laget)** —
   ordered by realistic visit frequency; a new video wasn't judged to
   arrive as often as a new chat message in a small roster.
2. **The feed is a tap-to-play card list, not a TikTok-style
   autoplay/swipe stack** — deliberately borrows the short-clip *content
   format* CLAUDE.md asks for while explicitly not reproducing the
   autoplay/infinite-swipe *mechanism* it separately warns against copying
   wholesale.
3. **An explicit "Visa fler klipp" button, not scroll-triggered
   auto-loading** — even though the contract's `before` cursor would
   support it — per CLAUDE.md's direct "no infinite scroll" instruction.
4. **Feed fetches on open/foreground/pull-to-refresh, not continuous
   polling like chat** — video isn't time-sensitive the way a chat reply
   is, and re-minting presigned URLs every few seconds for no reason would
   be pure waste.
5. **Three physically separate tap zones per card** (avatar/name → block
   sheet; video → play/pause only, never an action menu; caption/"⋯" →
   report or delete) — extends chat's "spatial separation reinforces
   functional separation" rule to a third zone, specifically so the video
   area itself never risks a kid accidentally triggering report/delete
   while just trying to watch.
6. **A client-only "you were challenged" banner (V3)**, reusing the
   K5/G3 local-flag-diff mechanism verbatim — no new backend, but its real
   limitation (no push, only fires on next real app-open) is stated
   plainly rather than implied to be instant.
7. **Report-reason order puts `appears_without_consent` first**, ahead of
   chat's usual bullying-first ordering — the video-specific "I'm in this
   and didn't agree to be" concern is this feature's single most serious
   category and shouldn't be buried at the bottom of an otherwise-generic
   list.
8. **The block-follow-up prompt after a report (V10) only fires for
   `appears_without_consent`/`bullying`** — the two reasons where "stop
   showing me this person's stuff" is the obviously relevant immediate
   next step, mirroring CH3's own reasoning for its two triggering
   categories exactly.
9. **V10's copy states the immediate hide plainly, then separately still
   declines to promise a review timeline** — a deliberate two-part
   structure, since this is the one place this app's copy has to be both
   more confident (something real just happened) and equally cautious
   (that doesn't mean a fast human review follows) than chat's equivalent
   screen ever had to be.
10. **Self-delete (V11) gets one confirmation step, styled with this
    app's reserved destructive/red button** — the one exception to this
    project's general "don't scare kids with alarming styling" rule,
    because clip deletion is the one action in this whole flow that's
    genuinely, unconditionally permanent, unlike captaincy transfer or
    blocking.
11. **"Avbryt" during upload (V6) calls `DELETE` immediately** rather than
    silently relying on the hourly `pending_upload` sweep — faster
    cleanup for a kid who changes their mind, flagged explicitly for
    backend-developer to confirm `DELETE` tolerates a still-`pending_upload`
    clip gracefully (delete-if-exists in MinIO) before relying on it.
12. **`TeamChatBlock` now also suppresses the blocked player's clips** —
    a single per-viewer "block this person" preference spanning both
    surfaces, not two independent settings; scoped to the clip's
    `uploaderPlayerId`, not its `taggedPlayerId`. CH4/CH5's already-shipped
    copy needs a small update to say so.
13. **Parent/coach report-notification email copy is neutral and
    explicitly pre-empts the "guilt already established" reading** — per
    security-reviewer's specific ask, since a single unverified report
    both hides content and triggers this email.

## Flagged for others, not decided here

- **architect/backend-developer:** update `phase3-contract.md` endpoint 3
  to state the `TeamChatBlock` exclusion explicitly (judgment call #12) —
  this doc decides the *product* behavior, but the contract's own
  "structural, not a code-review reminder" bar means the filtering rule
  itself should be written down there too, not left implicit.
- **backend-developer:** confirm `DELETE .../clips/:clipId` behaves
  correctly when called against a still-`pending_upload` clip (judgment
  call #11) — if it doesn't, "Avbryt" on V6 falls back to just dismissing
  the screen and letting the existing TTL sweep clean up, which is still
  correct, just slower.
- **backend-developer:** implement the parent/coach report-notification
  email templates using the tone and key phrases specified above,
  particularly the "det här betyder inte att något är fastställt fel"
  sentence security-reviewer specifically asked for.
- **frontend-developer:** CH4's block-confirmation body copy needs the
  small update noted under the TeamChatBlock decision above — this is a
  change to already-shipped Phase 2.6b copy, not just new Phase 3 screens,
  easy to miss if this doc's diff isn't read against the live component.
- **security-reviewer:** confirm the block-extends-to-clips decision
  doesn't introduce any new discoverability issue for the blocked player
  (they must still never learn they've been blocked — same silent-block
  guarantee ADR-0007 already established, now extended to a second
  surface using the same underlying relationship).
