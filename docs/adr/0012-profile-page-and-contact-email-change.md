# 0012 - Player profile page & contact-email change (Fas 4.1)

## Status

Accepted — 2026-07-28.

## Context

`docs/PROJECT.md`'s Fas 4.1 (added 2026-07-28, from the project owner
directly): a profile page reachable via a profile icon in the app's
top-right corner — optionally set a real name, view the account's birth
year, and change the contact email (the player's own, for the 13+
self-verification cohort, or the parent's, for everyone else — the same
`PlayerPrivateInfo.parent_contact` field either way, per
`docs/adr/0002-data-model.md`'s addendum §2). A change should notify both
addresses.

Flagged when this was added to the roadmap, not silently scoped as
routine CRUD: **`parent_contact` is the trust root for this app's entire
account-recovery mechanism** — `docs/adr/0004-coach-auth-and-session-
reissue.md`'s session reissue emails there, and 13+ self-verification
emails there too. A feature letting a user change that value is, in
practice, "swap out the account's recovery path," the same risk class
that caused the original session-reissue vulnerability (ADR-0004's
2026-07-27 addendum). This ADR resolves the three open questions that
addition flagged.

## Decisions

### 1. Contact-email change requires confirming via the NEW address, and notifies the OLD one

**Never applied immediately from a single request.** Flow:

1. Player (already authenticated — this is a `/players/me/...` action, no
   `:playerId` path param, so there's no IDOR surface to begin with) POSTs
   a candidate new contact. Backend generates a single-use code (same
   shape/format as `session-reissue-code.util.ts`'s existing generator —
   reused directly, not reinvented) and stores it plus the candidate value
   (encrypted, same as the live column — see ADR-0011) on the player's
   `PlayerPrivateInfo` row, pending.
2. **Email to the candidate NEW address**: contains the code, explains
   what confirming it does, 15-minute expiry (mirrors session-reissue's
   window — this is a similarly short-lived, single-sitting action, not a
   week-long approval like initial parental consent).
3. **Email to the CURRENT (OLD) address on file, if one exists**:
   informational only, no code, no action possible from it — "someone
   requested to change {screenName}'s account email to a new address; if
   this wasn't you, contact your team's coach." Sent at *request* time,
   before the change takes effect — this is deliberately more useful than
   a post-change notice would be, since it gives the real owner a window
   to react *before* anything actually changes, not just a receipt after
   the fact.
4. Only step 2's code, submitted back to a confirm endpoint, actually
   applies the change (swaps `parent_contact` for the pending value,
   clears the pending fields).

**No cancellation flow from the old address.** Considered and rejected as
scope for this pass: this app has no other interactive
"dispute/cancel" mechanism anywhere (session reissue doesn't have one
either), and building a real one — validating who's allowed to cancel,
handling the race between a legitimate confirm and an cancellation, etc.
— is a meaningfully bigger feature than the notify+confirm flow above. The
old-address email's real content is "contact your coach if this wasn't
you," i.e. today's account-dispute path (out-of-band, human) unchanged. A
building a real self-service dispute flow is flagged in
`docs/BACKLOG.md` as a follow-up, not decided here.

**Rate-limited** the same way session reissue is (`ADR-0004`'s addendum):
a per-player burst cooldown, reusing `RedisService`'s existing pattern
directly rather than inventing a new one. The attack surface here is
smaller than session reissue's (the caller must already hold a valid
session for the target account — there's no unauthenticated trigger
surface the way `reissue-request` has), but a compromised/malicious
session should still not be able to hammer a real family's inbox.

**Known, accepted, pre-existing limitation, not new:** `parent_contact`
can be a phone number (`IsEmailOrPhone`), and this app has no SMS
pipeline. Requesting a change *to* a phone number, or already having one
on file as the "old" address, means that side of the flow silently can't
deliver — identical to the same accepted gap already documented for
session reissue and the original consent flow, not a new hole opened by
this feature.

### 2. Birth year is read-only on the profile page

The year drives `isSelfVerificationAge` (ADR-0002's 2026-07-27 addendum)
— whether an account requires parental approval or just the player's own
email. A free edit after account creation is a *potential parental-
consent bypass* (age the account up past 13 to stop needing a parent),
not just a typo fix. The profile page shows it, doesn't let it be changed.
A genuine typo at onboarding is rare enough, and consequential enough
given what it gates, that it should go through a manual/support
correction (the coach, or a future admin tool), not a self-service edit —
explicitly not building that admin path here either, just not blocking on
it by leaving the door open for a self-service one.

### 3. No new "login" concept — this *is* the existing session-reissue mechanism's identity anchor

The roadmap item's "email as login" framing doesn't need new
infrastructure. This app has no password system by design (ADR-0004's
explicit decision against one for this userbase) — `parent_contact`
already functions as the de facto recovery credential via session reissue
and self-verification. This feature is "let the player keep that value
current," not a new authentication mechanism. No `CoachAuthGuard`-style
second system, no password, nothing to design beyond the change flow in
decision 1.

### 4. Real name — simple, immediate, no confirmation flow

Lower risk than the email: already optional, already isolated in
`PlayerPrivateInfo` (ADR-0002 addendum §1), already encrypted at rest
(ADR-0011). A direct `PATCH`, no token/confirmation dance — there's no
account-recovery implication to a display name.

## Implementation

- New module `backend/src/profile/` (mirrors why `SessionModule`/
  `ConsentModule` are their own modules rather than folded into
  `PlayersModule`/`PlayerPrivateInfoModule` — a distinct, narrow,
  security-relevant concern touching `PlayerPrivateInfo`).
- `GET /players/me/profile` — real name (decrypted), birth year, current
  contact (decrypted, shown in full — this is the account owner's own
  settings page, not a public surface, so no masking).
- `PATCH /players/me/profile` — `{ realName?: string | null }` only.
- `POST /players/me/contact-change-request` — `{ newContact: string }`,
  same `IsEmailOrPhone` format check as onboarding's `parentContact`
  field. Starts the flow in decision 1.
- `POST /players/me/contact-change-confirm` — `{ code: string }`,
  completes it.
- New `PlayerPrivateInfo` columns: `pending_parent_contact` (nullable,
  encrypted, same as the live column), `contact_change_code` (nullable),
  `contact_change_code_expires_at` (nullable) — additive migration, no
  backfill needed.
- Two new email templates: a confirm-via-new-address template (has the
  code) and a notify-old-address template (informational only).
- Mobile: the existing top-right avatar circle in `AppHeader` (already
  rendered on the Home tab, already exactly where the roadmap item asked
  for a profile icon) becomes tappable, opening a new profile screen.

## Consequences

- Reuses, rather than reinvents, every piece of infrastructure this
  already needed: the reissue-code generator/format, `RedisService`'s
  cooldown pattern, `PlayerPrivateInfoService`'s encrypt/decrypt boundary,
  `MailService`. No new dependency, no new architectural pattern.
- Birth year becomes the first onboarding field this app deliberately
  makes permanent (everything else — screen name, avatar, real name — has
  or gets a path to change). Worth remembering if a future feature
  assumes every profile field is editable; this one isn't, on purpose.
- Self-service dispute/cancellation for a contact-email change is flagged,
  not built — tracked in `docs/BACKLOG.md`.
- Given the account-recovery-adjacent risk class, this gets the same
  independent security-reviewer pass before shipping that ADR-0004's
  2026-07-27 redesign did — not a self-review, per CLAUDE.md's blocking-
  review rule for anything touching auth.

## Addendum — 2026-07-28: 24h grace period + cancel link (decision 1 revised)

An independent security-reviewer pass, run before shipping per the
Consequences section above, found a real gap in decision 1 as originally
written.

### The finding

This app has no password, and session tokens are long-lived (180 days —
ADR-0004). "No cancellation flow from the old address" (decision 1's
original text) meant a momentarily-compromised session could complete
**both** steps — request, then confirm via the new address's code, which
an attacker who controls that new address obviously has — in two quick
authenticated calls. `parent_contact` would be permanently redirected
before the old-address notify email (sent at *request* time, informational
only) could realistically prompt a human to react. Given `parent_contact`
is this app's entire account-recovery root (this ADR's own Context
section), that's a full, silent account takeover path, not a cosmetic gap.
The "session reissue doesn't have a cancel flow either" precedent cited to
justify skipping this didn't hold up: session reissue's code is emailed to
`parent_contact` itself, so the account owner is the one who must act to
complete a hijack. This feature's flow is different — the confirm code
goes to the attacker-controlled new address, not to `parent_contact` — so
the old-address holder never gets a code to act on, only a notice, which
is materially weaker.

### The fix: a 24h grace period, with a cancel link mailed to the OLD address at confirm time

Decision 1's step 4 no longer applies the change on confirm. Instead:

1. Confirming the new-address code starts a **24-hour grace period**
   (`contact_change_apply_at`), not an immediate swap. `parent_contact`
   stays the old value throughout.
2. **A new email to the OLD address, at confirm time** (not request time —
   there's nothing concrete to act on until the new-address code is
   actually redeemed): carries a clickable cancel link, not a code — the
   old address might belong to someone without the app open on a phone
   (a parent checking email on a laptop), so this mirrors the parental-
   consent flow's GET-preview/POST-confirm web page, not an app screen.
   Same email-prefetch-safety split as `ConsentController` (GET has zero
   side effects; only the POST behind the button on that page acts).
3. Following the link and pressing cancel: reverts the pending change
   (clears `pending_parent_contact`, `contact_change_apply_at`, the cancel
   code) and **bumps `Player.token_version`**, invalidating every session
   currently live on the account — the old-address holder saying "this
   wasn't me" is exactly the moment forcing a fresh login is warranted,
   same reasoning `SessionService` already applies elsewhere.
4. If nobody cancels, the change applies **lazily**, on the next read that
   notices the grace period has elapsed (`PlayerPrivateInfoService
   .getEffective`) — not via a new cron job or scheduled task. Matches
   this codebase's preference for the boring option over new
   infrastructure; a 24h latency on a read nobody's making yet has no
   observable cost.

24h was chosen as short enough not to be an annoying delay for a genuine
change, long enough that a real account owner checking their old inbox
even once a day will see the cancel email in time.

### What stayed the same

The request-time emails (code to the new address, informational notice to
the old address) are unchanged — this addendum only revises what happens
*after* the new-address code is confirmed. Rate limiting, the `IsEmailOrPhone`
format check, and decisions 2–4 are unaffected.

### Implementation

- New `PlayerPrivateInfo` columns: `contact_change_apply_at` (nullable,
  timestamptz), `contact_change_cancel_code` (nullable, unique, not
  encrypted — same reasoning as `contact_change_code`: needs exact-match
  lookup, protected by single-use + short effective lifetime rather than
  encryption at rest).
- New `PlayersService.bumpTokenVersion` — reused by the cancel path, same
  operation `SessionService`'s reissue flow already performs.
- New unauthenticated routes, throttled like `ConsentController`:
  `GET /players/contact-change-cancel/:code` (preview page, no side
  effects) and `POST /players/contact-change-cancel/:code` (the actual
  cancel). No `JwtAuthGuard` on these by necessity — the whole point is
  that the old-address holder shouldn't have to rely on whatever session
  is currently live on the account.
- New email template (cancel link, to the old address, sent at confirm
  time) alongside the two existing request-time templates.
