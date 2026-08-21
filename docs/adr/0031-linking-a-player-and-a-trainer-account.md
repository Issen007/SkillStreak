# 0031 - Linking a player account and a trainer account

## Status

Proposed, 2026-08-21. Raised by the project owner the same day:

> "If a child younger then 13, it shouldn't have that button to even sign
> in or have a trainer function. And if we have a user that want to
> create a trainer profile can do that and when link it together. And if
> a person already have both then should it be possible to link them
> together"

The first sentence is **already shipped** — the trainer entry on the
profile screen is gated on the server's `isSelfVerification` flag and is
not rendered at all below 13. This ADR covers the rest: creating a
trainer profile from inside the app, and linking two accounts that
already exist.

Supersedes nothing. Extends ADR-0023 (PT role and staff SSO/RBAC), which
established the two identities but deliberately left them unconnected.

---

## Context

### The fact that makes this an ADR rather than a feature

**A player and a trainer are two different kinds of account, with two
different authentication systems, and nothing joins them.**

| | Player | Trainer |
|---|---|---|
| Entity | `player` | `staff_account` |
| Authenticates with | JWT issued by `POST /players` | Google / Microsoft / Apple SSO |
| Session | bearer token, 180 days | `staff_session` cookie, SameSite=Strict |
| Surface | the Expo app | the web console at `/console/` |
| Identifies | a child, 9–13+ | an adult |

`staff_account` has no `player_id` column and `player` has no staff
reference. That is not an oversight — ADR-0023 built the trainer role as
a separate identity precisely so that adult access to children's data
would go through invite and per-child parental approval rather than
through anything a person could claim about themselves.

So "switch between a user and a trainer in the app" cannot be built as a
UI toggle. There is nothing for the app to switch *to*: it holds a
player's JWT, and the trainer surface requires a staff session it has no
way to obtain.

### What is shipped today, and why it looks like a stopgap

The profile screen has a self-selecting entry — *"Är du tränare? → Öppna
tränarläget"* — that opens the console in a browser. It is gated to 13+.

It is honest but unsatisfying, and the reason is exactly the gap above:
the app cannot know whether the person holding the phone is also a
trainer, so it has to ask. Every improvement to that experience requires
the link this ADR designs.

### What must not happen

Three failure modes bound the whole design, and each is worse than the
feature is valuable:

1. **An adult reaching a child's account.** If linking can be initiated
   from the trainer side against a player identified by name, code, or
   email, then a trainer who guesses or learns an identifier gains a
   child's session.
2. **A child reaching an adult's account.** The mirror. A staff account
   is what the console authenticates; a player who could attach one to
   themselves would inherit whatever that account has been granted.
3. **The link becoming an access path.** If being linked grants a trainer
   anything about the child they are linked to — or vice versa — then the
   link is a privilege escalation dressed as a convenience, and ADR-0023's
   invite-plus-approval chain is bypassed by a person who is both.

---

## Decision — 1: linking proves control of both identities in one session, and never accepts a claim

A link is created only by a flow that holds **both** credentials at once:

1. The player, signed in to the app (13+), requests a link. The server
   mints a short-lived, single-use `AccountLinkChallenge` bound to that
   `player_id`.
2. The app opens the console at `/console/link?challenge=<token>`.
3. The console completes staff SSO **normally** — the same provider flow
   as any other sign-in, with no parameter that changes what it grants.
4. With a live staff session *and* a valid unexpired challenge, the
   server writes the link.

**Neither side can name the other.** There is no "link to player X"
input, no email match, no invite code. The player identity comes from the
challenge the player's own session created; the staff identity comes from
an SSO round trip completed in that same browser. This closes failure
modes 1 and 2 together, because at no point does either side get to
assert who the other is.

That is the same shape as the existing consent flows — a token the server
issued, redeemed by someone who then proves who they are — rather than a
new pattern.

**The challenge is short-lived (10 minutes) and single-use**, and it
carries no authority of its own: possessing it lets you attach *your*
staff account to that player, and nothing else. A stolen challenge is
therefore worth attaching an attacker's own trainer account to a victim's
player account — which is why Decision 4's unlink is unilateral and
Decision 3 makes the result worthless.

## Decision — 2: the same flow covers "I already have both" and "I want to become a trainer"

The project owner named these as two cases. They are one flow with a
different starting point, and building them separately would be two ways
into the same state.

- **Already have both** — SSO in step 3 signs in to the existing staff
  account. Link written.
- **Want to become a trainer** — SSO in step 3 is the person's first
  sign-in. ADR-0023's existing behaviour applies: a staff account is
  created in whatever state that flow already produces. Link written.

The second case creates **no trainer capability whatsoever**. It creates
an identity that can sign in to the console and see nothing, because
`PtTeamLink` rows and per-child consents are what grant access and both
require other people to act. "Create a trainer profile" is therefore a
safe, self-service thing to allow, precisely because a trainer profile on
its own is powerless — the same property ADR-0023 relied on when it let a
child captain invite an adult.

## Decision — 3: the link grants nothing, in either direction

Being linked changes exactly one thing: the app knows the person also has
a staff account, so it can show the trainer surface without asking.

It does **not**:

- give the trainer any visibility of the linked player's training data,
  team, clips, chat or consents;
- give the player any staff privilege, any console tab, or any admin
  capability;
- alter `PtTeamLink`, any parental consent, or any RBAC decision;
- appear to anyone else — not to the player's team, not to their captain,
  not to families the trainer works with.

Every server-side authorisation continues to resolve from the credential
presented on the request. A staff cookie authorises staff routes; a
player JWT authorises player routes. The link is not consulted by any
guard, and this ADR forbids adding one that does.

**This is the decision that makes the other two safe.** If the link
granted anything, the challenge in Decision 1 would become worth stealing
and the unilateral unlink in Decision 4 would become a way to lock
someone out of something. Keeping it worthless keeps it simple.

## Decision — 4: one-to-one, and either side may unlink alone

A staff account links to at most one player, and a player to at most one
staff account. A one-to-many link would mean "this adult is also these
children", which is a claim the system cannot verify and has no use for.

**Either identity can break the link on its own**, without the other's
agreement and without a confirmation from anyone else. Unlinking is
always safe because the link grants nothing, so there is no reason to
make it hard, and there is one strong reason to make it easy: if the flow
in Decision 1 is ever abused, the victim's own unlink is the remedy and
must not require finding the other party.

An unlink is not an erasure. It leaves both accounts intact and either
may link again.

## Decision — 5: 13 is the age for *seeing the entry*, and it is not an adulthood check

The gate shipped today uses `isSelfVerification` — Sweden's GDPR
Article 8 digital-consent age via Dataskyddslagen (2018:218) Ch. 2 §4,
already used by the consent flow.

It is the right gate for the question "may this person be shown a control
that leads to creating an account elsewhere". It is **not** a check that
the person is an adult, and this ADR does not claim otherwise. The app
collects a birth *year* and verifies nothing about it.

That residual is acceptable only because of Decision 3 and ADR-0023: a
trainer identity confers nothing until a captain invites it to a team and
a parent approves each individual child. A fourteen-year-old who creates
a trainer profile has created an empty one. The people who decide whether
a trainer ever sees a child's data are the captain and that child's
parent, and neither of those checks is weakened here.

**Flagged for the project owner** rather than assumed: if trainer profile
creation should require a higher bar than 13 — an explicit adult
declaration, or restricting creation to accounts that already hold a
`PtTeamLink` invite — that is a product call this ADR is deliberately not
making.

## Decision — 6: the app's trainer surface stays a browser hand-off for now

Even with the link, the mobile app still holds no staff session, and the
console's authentication depends on being same-origin with the API with a
`SameSite=Strict` cookie — which is what makes it safe.

So linking improves the *entry* (the app can say "open trainer mode"
rather than "are you a trainer?"), and does not by itself produce native
trainer screens. Rendering those natively needs a staff auth path in the
app, which is a separate decision with its own security surface and is
explicitly out of scope here.

---

## Consequences

**New:** an `account_link` table (`player_id` unique, `staff_account_id`
unique, `created_at`), an `AccountLinkChallenge` (token, `player_id`,
`expires_at`, `consumed_at`), one authenticated player endpoint to start
a link, one console route to complete it, and one endpoint on each side
to break it. Both foreign keys cascade: an erased player or a revoked
staff account takes the link with it, and no sweep is needed.

**Unchanged, deliberately:** every guard, every consent, every RBAC
decision, and the entire PT invite chain. If implementing this requires
touching any of them, the implementation has departed from Decision 3 and
should stop.

**Testable invariants**, and the ones worth pinning first because each
would be silent if broken:

1. A link cannot be created without both a valid challenge and a live
   staff session.
2. A challenge is consumed exactly once and expires.
3. No authorisation path reads `account_link` — assertable by grepping
   the guards, and worth a test that fails if one starts to.
4. Unlink from either side succeeds without the other.
5. A player under 13 cannot obtain a challenge, server-side and not only
   in the UI.

**Open, for the project owner:** Decision 5's age question, and whether a
trainer profile created this way should be visibly marked as
self-created when a captain later considers inviting it.
