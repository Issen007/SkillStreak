# 0029 — Adult-mediated cross-team sharing: a coach drill library and team-to-team kudos

## Status

Proposed — 2026-08-11. **Blocking `security-reviewer` pass required before
ux-designer draws a screen or backend-developer writes a migration**, per
CLAUDE.md's standing rule. This ADR touches child data (Decision 7 lets a
child's tap cross a team boundary) even though it deliberately touches no
child *content*, and that is enough to make the pass blocking rather than
advisory.

**What this ADR is, in one sentence**: the version of the project owner's
*"different teams can give each other cred but also share ideas of cool
tricks and training ideas"* that can be built **without** amending
CLAUDE.md's closed-team-bubble non-negotiable.

**What this ADR is not, stated first because it is the whole reason it
exists.** Taken literally, that request is
[`docs/adr/0019-public-shorts-feed.md`](0019-public-shorts-feed.md) — a
cross-team feed of children's clips. ADR-0019 has had its full blocking
security review and is **blocked on one thing only: the project owner
amending CLAUDE.md's *"a user only ever sees their own verified team"*
themselves** (ADR-0019 Status; Consequences, "Blocking prerequisite the
project owner alone can close"). The owner chose not to weaken the
constraint and asked for the version that keeps it intact. **This ADR
therefore proposes nothing that would require that amendment, does not
argue for it, does not partially pre-build it, and does not move ADR-0019
one inch in either direction.** ADR-0019 stays exactly as blocked as it was
before this file existed.

**And it must not become ADR-0019 by increments.** Decision 1 defines the
line and names the five specific moves that would cross it. Any future
change that makes one of those five true is a new ADR plus the owner's
CLAUDE.md amendment — never a follow-up ticket on this one.

**Three things for security-reviewer to scrutinise hardest**, named up
front so they are not buried:

1. **Decision 7's kudos is the only thing in this ADR that a child
   initiates and that crosses a team boundary.** It carries no content and
   no identity — but it is a child causing something to appear in another
   team's app, once a week, and the sharpest case is a kudos aimed at a
   team the leaderboard already labels `'1-2'` players
   (ADR-0016's `eligiblePlayerCountRange`), where "a team" is plausibly
   one child. Decision 7 argues this is acceptable; it does not assume it.
2. **Decision 4's read gate.** The drill library makes adults' names
   readable by other adults. The gate proposed is "holds at least one
   active `PtTeamLink`, or is `admin`" — argue whether a captain's code
   (a twelve-year-old's decision, per
   `docs/design/phase8-trainer-invitations.md`) is the right thing to be
   gating an author-name list on.
3. **Decision 5's honesty about moderation.** ADR-0027's security review
   (2026-08-11, finding F1) rejected exactly the move of calling an
   operator-mediated content path "moderated by construction". Decision 5
   is written to not repeat that mistake; check that it succeeded, rather
   than that it claims to have.

**Verification note.** Every code claim below was checked against the
source on 2026-08-11 and is cited with a path. Two things are stated as
**unverified**: whether any push-notification infrastructure exists (this
ADR adds no notification either way, so the question does not bind), and
what the operator's real appetite is for hand-curating a drill library,
which is Open Question 1 and is not an engineering fact.

## Context

### The ask, and the two halves it splits into

The owner's words: *"different teams can give each other cred but also
share ideas of cool tricks and training ideas."* Two halves with completely
different risk shapes:

- **"Share ideas of cool tricks and training ideas"** — this is adults
  exchanging coaching material. It needs no child data at all, and it is
  the half the owner most concretely described.
- **"Give each other cred"** — this is the emotional half, and it is the
  one that only works if children feel it.

They are separated throughout because conflating them is how this design
would drift into ADR-0019.

### The invariant everything here is measured against

**Nothing a child creates — clip, caption, chat message, screen name,
streak, or training log — crosses a team boundary.** And it must hold
*under composition*: two individually-safe features must not combine into
cross-team visibility of a child. Decision 1 turns this into a testable
rule rather than a slogan.

### Who the adults actually are — checked, not assumed

There is **no coach login in this app**. Phase 2's kapten pivot removed
adult accounts deliberately (ADR-0004's addendum; restated in ADR-0028
Decision 5: *"There is no coach login to put it behind... A captain is a
child."*). The only adult identities are ADR-0023's `StaffAccount` rows
(`backend/src/staff-auth/entities/staff-account.entity.ts`, verified:
`role` enum `admin`/`pt`, `revoked_at`, SSO-provisioned, never
password-based).

A `pt` account reaches a team only one way: a **captain generates an
invite code and hands it over** (ADR-0023 Decision A2;
`backend/src/pt/pt-team-links.service.ts` — `generateInvite`,
`redeemInvite`, `listForTeam`, `revoke`). A `pt` account with no
`PtTeamLink` can read nothing about anyone — verified structurally:
`PtDataService` resolves everything from `PtTeamLink`/`PtPlayerConsent`
and consults no other relationship table
(`backend/src/pt/pt-data.service.ts`).

Two facts that changed recently and matter here, both verified in
`backend/src/staff-auth/guards/pt-auth.guard.ts`: as of 2026-08-11
`PtAuthGuard` **does** perform a per-request `StaffAccount` lookup
(so `revoked_at` is a real, immediate lever on this surface, which it was
not before), and it **admits `admin` alongside `pt`** so the owner reaches
the trainer surface from their own account.

So "coaches share with coaches" cannot mean "coach accounts", because
there aren't any. It means `StaffAccount`s, and Decision 4 has to say
which ones.

### Direction of discovery — the invariant this could accidentally invert

ADR-0023 Decision A2's rule is *the team invites, never the reverse*.
`docs/design/phase8-trainer-invitations.md` states precisely what that
protects, and this ADR adopts its formulation verbatim rather than
re-deriving it:

> The thing being prevented is **an adult browsing children**. […] The
> invariant is not "no discovery" — it is "children are never the
> browsable side."

That single sentence is what makes a browsable library of *coach-authored
drills* safe and a browsable directory of *teams* unbuildable. Decision 4
leans on it directly.

### What already exists that this is built out of

- **ADR-0008's leaderboard** already makes `Team.name` + `pointsTotal`
  cross-team-visible, via a query that structurally cannot reach `Player`.
  Endpoint verified live at
  `backend/src/weekly-goal/weekly-goal.controller.ts:245`. Decision 7
  adds no new team-discovery surface because it addresses exactly the set
  of teams a captain can already see there.
- **ADR-0016** buckets the cross-team eligible-player count into
  `'1-2'`/`'3-5'`/`'6+'` after a blocking finding, and confirms **no
  minimum-roster-size concept exists anywhere in this codebase**. Both
  facts bear on Decision 7.
- **The app's only text filter** is a 33-entry Swedish keyword list
  (`backend/src/team-chat/swedish-filter-wordlist.json`, verified length
  33), applied via `CHAT_MODERATION_CHECK` to chat messages, clip
  captions, and — checked, and often forgotten — team names and invite
  codes at team creation (`backend/src/teams/teams.service.ts:80-81`).
  Decision 5 explains why it does not transfer to coach-authored text.
- **ADR-0028 Decision 6's RAG corpus**: owner-authored Markdown drill
  material under a top-level `ai/` directory, version-controlled, no child
  data, explicitly *not* scraped. Unbuilt — `ai/` does not exist yet
  (verified). Decision 3 decides whether that corpus and this library are
  the same thing.
- **`docs/TRAINERS.md`** promises a trainer reputation direction and says
  in its own words that it is *"not built yet and not yet designed"*.
  `docs/internal/BACKLOG.md`'s trainer-marketplace entry lists what must
  be decided first. Decision 6 is written to stay strictly on this side of
  that line.
- **ADR-0027 Decision 3's** shape — a server-curated, fixed catalogue with
  no child-supplied input — and its **2026-08-11 security review**, whose
  finding F1 is the cautionary tale Decision 5 is written against.

## Decision — 1: the line, stated as a rule that can be checked, and the five moves that cross it

**The rule this ADR holds itself to**: a cross-team surface may carry
**facts about teams** and **material authored by identified adults**. It
may never carry **anything a child authored, recorded, typed, earned or is
depicted in**, and it may never make **children or teams browsable by
adults**.

Applied to the two mechanisms adopted below: a drill is adult-authored
text about floorball; a kudos is a team-level fact with a fixed,
contentless payload. Neither is a child's work product, neither names a
child, neither has a reply channel.

**The five moves that would cross the line.** Each one converts this ADR
into ADR-0019's question and therefore requires the project owner's
CLAUDE.md amendment plus a new ADR — none of them is a config change, a
follow-up ticket, or a UI iteration:

1. **Any child-created artifact on a cross-team surface** — a clip, a
   caption, a chat message, a screen name, a streak number, a badge, a
   training log. Including "just one, curated". Including "just the
   captain's".
2. **Any per-child or per-team reference inside the drill library** — a
   drill that names a player, links a clip, or credits a team. Decision 2
   makes this structurally impossible rather than forbidden.
3. **Any free text on kudos** — a note, a message, a custom label, an
   emoji picker wide enough to spell. Decision 7's payload is a closed
   enum for exactly this reason.
4. **Any browsable list of teams or children offered to an adult**, or any
   path by which an adult initiates contact with a team that did not
   invite them. This is ADR-0023 A2's invariant, and
   `phase8-trainer-invitations.md`'s trainer-directory question, neither
   of which this ADR reopens.
5. **Any app-wide media surface**, however adult-authored — because the
   step from "an adult's video plays here" to "and one great team clip"
   is a one-line change and a much easier argument to lose. Decision 9.

Writing these down is the point. A future contributor who wants one of
them is not blocked by taste; they are blocked by a named gate that
belongs to the project owner.

## Decision — 2: adopt Mechanism 1 — a coach drill library, operator-curated, with no database presence at all

**Adopted, and it is the strongest of the three candidates by a wide
margin**: it is the closest thing to what the owner literally asked for
("share ideas of cool tricks and training ideas"), and it involves no
child data of any kind, at any point, in any table.

**Shape**: a set of plain Markdown files in this repository, each one drill
or short session, with a small fixed front-matter block. A read-only
listing and detail view in the staff console (ADR-0022's, the one PTs
already sign into). Filtering by age band, focus and locale, done in
memory.

```
---
title: "Kortpassningar under press"
ageBand: "9-11" | "11-13" | "13+"        # fixed enum
focus: "teknik" | "fys" | "skott" | "passning" | "spelforstaelse"   # fixed enum
durationMinutes: 15
locale: "sv"                              # reuses PlayerLocale (ADR-0014)
author: "Anna Lindqvist"                  # or "Anonym tränare" — Decision 6
authorConsentedNamed: true
sourceNote: "Delad av författaren, 2026-08-11"
---

Body: plain Markdown prose. No images, no links, no embeds.
```

**Why files and not a table — argued, because a `SharedDrill` entity is
the obvious first instinct:**

- **A drill has no mutable state worth a row.** No status machine, no
  ownership transfer, no per-viewer state, no counters (Decision 6 refuses
  counters deliberately). A table would exist only to hold text that never
  changes without a human editing it.
- **The structural property is the real prize**: with no table, there is
  **no `drill` row for any query in this app to join to a `player`,
  `team`, `video_clip` or `training_log_entry`**. Decision 1's move 2 is
  not forbidden by policy, it is unrepresentable. Compare ADR-0022
  Decision 5's *"no `teamId`/`playerId` in the method signature at all"* —
  this is the same bar, achieved more cheaply.
- **It is free under ADR-0013.** No new entity, so no new row in
  ADR-0013 Decision 6's per-entity erasure table, and no erasure question
  to answer — there is nothing about a child to erase. The same property
  ADR-0019 and ADR-0023 Part A each demonstrated for their own tables,
  obtained here by not having tables.
- **Review is `git` review.** Every change to the library arrives as a
  diff on a branch, gets read, and merges through the existing flow. That
  is the moderation control (Decision 5), and it costs nothing to build.
- **The precedent already exists in this codebase**: the Swedish wordlist
  is static, reviewable, version-controlled data loaded once per process
  and shipped into the image via `nest-cli.json`'s `assets` entry
  (verified — `backend/nest-cli.json`, and the `readFileSync` +
  `join(__dirname, ...)` loader in
  `backend/src/team-chat/keyword-chat-moderation-check.ts`). The drill
  library is the same shape of thing and should use the same mechanism.

**Where the files live — constrained by a verified build fact.** The API
image's Docker build context is `./backend`
(`.github/workflows/ci-cd.yml:370, 580, 662` — all three build steps), so
files outside `backend/` are **not** available to that image. Two honest
options: move the API build context to the repo root (the `site` image
already does this, `context: .` at `:390`), or keep the library inside
`backend/`. **Recommendation: keep it inside `backend/`** —
`backend/src/drills/library/*.md`, with a `nest-cli.json` assets entry
alongside the wordlist's. Rationale: changing a working image's build
context to gain a directory placement is churn with a real chance of
breaking a build, for zero functional gain. Decision 3 handles what this
means for ADR-0028.

**Loading**: parse front-matter once at module init (the wordlist's
"loaded once per process, not per call" reasoning applies unchanged),
hold the parsed set in memory, filter in the service. At tens of
documents this is not a performance question. **No Redis, no Postgres, no
search index** — the same call ADR-0008 Decision 1 and ADR-0028 Decision 6
already made for their own "don't stand up a store for data that fits in a
list" cases. **Trigger to revisit**: a library in the low hundreds, or the
first genuine need for per-viewer state (favourites, "I ran this"), which
is a table and a new decision.

**Versioning is free and already correct**: the library ships inside the
API image, which is already stamped with `APP_VERSION` and reported by
`GET /health` (CLAUDE.md's environment-parity section). "Which drills does
this cluster have" is answerable from a running pod, with no new
mechanism.

**Environment parity**: the content is environment-independent — no URLs,
no hostnames, no deep links, nothing per-cluster. Both clusters get the
same files by getting the same image. Nothing to bake per environment,
and — deliberately — **no `ConfigMap` mount**, avoiding the hand-applied
staleness `admin-planning-docs` already documents for its own curated
files (`backend/src/admin/admin-planning-docs.service.ts` — its `syncedAt`
marker exists specifically to warn when an operator's ConfigMap has gone
stale).

**Accepted cost, stated plainly**: adding a drill requires a commit and a
release. At this project's cadence (a release counter that bumps per merge
into `main`, with the `ubuntu01` poller redeploying automatically) that is
days, not weeks — and it is exactly how translations and the wordlist
already work. **The trigger to move to a table**: the operator is adding
drills faster than the release cadence tolerates, or self-service
submission is genuinely wanted (Decision 11's v2 sketch).

## Decision — 3: one corpus, two consumers — the drill library *is* ADR-0028's Phase 1 RAG corpus, with one amendment ADR-0028 must make

The brief question is real: ADR-0028 Decision 6 already defines a
version-controlled Markdown corpus of floorball drills, for the training-
plan generator. Building a second body of drills here would be a genuine,
avoidable cost — two places to add a drill, two places for it to go stale,
and the eventual discovery that the good drills are in the wrong one.

**Decided: one corpus of drill content, two consumers.** The Markdown
files described in Decision 2 are the same files ADR-0028's Phase 1 RAG
service embeds. What differs is what each consumer *adds*, and neither
addition belongs to the content:

| | Staff console (this ADR) | RAG service (ADR-0028) |
|---|---|---|
| Reads | the same `.md` files | the same `.md` files |
| Adds | front-matter filtering, rendering, the read gate (Decision 4) | embeddings, retrieval, prompt assembly |
| Needs | nothing durable | an in-memory index, rebuilt at start |

**Why not two corpora, argued rather than asserted**: the two consumers
differ in *mechanism*, not in *trust model*. Both require the same thing
of the content — adult-authored, no child data, reviewed in a diff before
it exists. A drill that is safe to show a coach is safe to ground a model
on, and vice versa. When two bodies of data share a trust model and
differ only in how they are read, they are one body of data with two
readers.

**Two consequences that must be handled rather than assumed:**

1. **ADR-0028 Decision 6's authorship rule needs one explicit
   amendment.** It currently says the corpus is *"authored or explicitly
   licensed by the project owner"*. If external coaches contribute, that
   sentence becomes false. The amendment: *"authored by the project owner,
   or contributed by a named adult who has explicitly permitted its
   inclusion and its use as generator grounding, recorded in the
   document's own front-matter, and reviewed in a diff before merge."*
   This is **not** ADR-0028's rejected option (B) — that was *scraped*
   third-party material with no permission and no review; this is a
   coach's own drill, given deliberately. Flagged here as an amendment
   ADR-0028's owner must make, not something this ADR can make on its
   behalf.
2. **The path question, since ADR-0028 says `ai/corpus/` and Decision 2
   says `backend/src/drills/library/`.** ADR-0028 is unbuilt and `ai/`
   does not exist (verified); this library ships first. So the corpus
   lives where the shipping consumer can read it without CI surgery, and
   ADR-0028's Decision 6 points at that directory when it is built (its
   own build context is its choice, and unlike the API image's, it is not
   yet fixed). **If that ever proves awkward, the answer is a CI copy
   step, never a hand-maintained second copy.** Duplication by process is
   recoverable; duplication by convention is not.

**The corpus does not fork today. It forks the day self-service submission
ships** (Decision 11's v2), at which point there are genuinely two
populations — repo-authored material that has been through diff review and
is eligible to ground a model, and user-submitted material that is
console-only until an operator promotes it. That fork is a deliberate
future decision with a real reason, not the accidental duplication this
decision exists to avoid.

## Decision — 4: who may read it — a `pt` (or `admin`) staff account holding at least one active team link; a link-less trainer still gets nothing

**The gate**: `PtAuthGuard` (which already admits `admin` alongside `pt`,
verified) **plus** a service-level check that the caller holds at least
one **active** `PtTeamLink`, or is `admin`.

**Why not "any signed-in staff account", which is the obvious cheaper
gate**: an SSO sign-in costs nothing and proves nothing about the person —
ADR-0023 Decision C9 is unusually blunt about this (*"Sign-in with Google
is authentication, not age assurance, and not identity assurance"*).
Opening the library to any Google account would hand an anonymous
population a readable list of the real names of adults who coach specific
children's teams. That list is not catastrophic, but it is a thing worth
not creating for free.

**Why this specific gate**: it preserves ADR-0023 Decision B1's property
**exactly as written** — *"a freshly-signed-up PT account is, by
construction, indistinguishable in capability from someone who never
signed up at all"* — rather than eroding it. A trainer becomes a reader by
the same act that already makes them useful: a team invited them. No new
kind of vouching, no new credential, no new state.

**Implementation note, verified rather than assumed**: ADR-0023 Part C
Decision C6 proposes a single resolver
(`PtTeamLinksService.findActiveLink`/`.listActiveLinks`) that all
link-checking call sites route through — **that resolver does not exist
yet** (verified: `pt-team-links.service.ts` has `generateInvite`,
`redeemInvite`, `listForTeam`, `revoke`, and nothing else; the live
per-team check is `PtConsentService`'s private `assertActiveTeamLink`, and
`PtDataService` queries the repository directly). So this ADR specifies a
small public `hasAnyActiveLink(ptStaffAccountId): Promise<boolean>` on
`PtTeamLinksService`, and states that **if Part C ships, this check moves
inside that resolver** rather than becoming a fourth independent answer to
the same question — which is precisely the problem C6 exists to fix.

**Does this create any path for an adult to browse teams or children?
No — and here is the check, not the assertion.** The library's read
surface returns Markdown documents and their front-matter. It has no
`teamId`, no `playerId`, no roster, no counts, no author-to-team mapping,
and no way to ask "which teams does this author work with". An author name
is a string in a file. Nothing in this surface is a query about a person.
The direction of initiation is untouched: a trainer still cannot see a
team until a captain hands them a code.

**Accepted consequence, named rather than discovered later**: a trainer
recruited by the campaign in `docs/CAMPAIGNS.md` cannot see the library
until a team invites them. That is the same gap `CAMPAIGNS.md` already
sequences around (*"Post the trainer campaign last. A coach you recruit
today has nothing to do"*), not a new one — but it does mean the library
is not a recruitment asset, and the site must not advertise it as one.

**Nothing in the Expo app reads this surface.** No player-facing endpoint,
no captain-facing endpoint, no deep link. Decision 10 is honest about what
that costs.

## Decision — 5: moderation — the human reading the diff is the control, it is a policy control, and the keyword filter does not transfer

**What is structural** (true regardless of anyone's diligence):

- No endpoint anywhere accepts a drill from anyone. The only way text
  enters the library is a commit to this repository. This is ADR-0027
  Decision 3's *"there is no endpoint, on any surface, that accepts an
  audio file"* applied to text, and it holds here for the same reason.
- The library has no database presence, so it cannot reference a child
  (Decision 2).
- The front-matter fields are fixed enums; a drill cannot invent a
  category, an audience, or a visibility scope.
- **No links, no email addresses, no phone numbers, no images in a drill
  body.** Enforced at review, and worth a trivial CI check (a regex over
  `backend/src/drills/library/*.md` in the existing lint job) so it is not
  purely a reviewer's memory. This is not aesthetic: a link is how a
  library becomes an off-platform contact channel, and a contact channel
  between an unvetted adult and a coach who works with children is a
  different feature with a different review.

**What is a policy control, said plainly**: a human being reads the drill
before it merges. That is the only thing standing between "a coach
contributed a drill" and "advice about nine-year-olds' physical training
that nobody competent read". ADR-0027's security review (finding F1)
rejected precisely the move of dressing this kind of control up as
structural — *"what vets it is one person listening, which is a policy
control, precisely what Decision 3 claims not to rely on"*. **This ADR
does not make that claim.** The reviewer is the control, the reviewer is
one person, and the design is sized to that.

**The existing keyword filter does not transfer, and must not be described
as if it did:**

- It is 33 Swedish words (verified). Drills will arrive in a library whose
  `locale` field reuses the app's 8 `PlayerLocale`s, and the trainer
  console's own language is still an open question (ADR-0023 Decision C8
  leaves it open). A Swedish wordlist over English or German prose is
  approximately no filter.
- ADR-0007's sign-off on that filter was **explicitly conditional** on
  *"small, closed, real-world-known rosters"*, and ADR-0019 Decision 4
  refused to stretch it to strangers. Coaches from different clubs are
  strangers by construction.
- The harm shapes are different in kind. The filter looks for abuse
  between children. The risks here are unsafe training advice for 9–13s,
  copyright, off-platform contact, and a library used as a soapbox. A
  wordlist detects none of them.

**It may still be run as a non-authoritative pre-screen** — the injection
point already exists (`CHAT_MODERATION_CHECK`) and it costs nothing to
catch the obvious. But: **no surface may describe library content as
filtered, checked, verified or approved.** That is the same prohibition
ADR-0023 Decision C5 places on describing a linked trainer as verified,
for the same reason — a claim the system cannot honour is worse than no
claim.

**The stop rule, so this does not quietly degrade**: if drill submissions
ever arrive faster than the reviewer will genuinely read them within a few
days, the library **stops accepting new contributions** until there is a
second reviewer. It does not switch to skimming. Written down here because
that decision is always made under time pressure and is always easier to
make in advance.

**Withdrawal**: an author may ask for their drill to be removed at any
time, for any reason, without explanation — the app's standard posture
(ADR-0010/0013/0023 A4). Mechanically it is a commit. **Honest residual**:
removal is forward-looking. Git history retains the text, and if the drill
was used as generator grounding, plans already produced from it are not
recalled. Contribution is therefore a licence event, which is why
`authorConsentedNamed` and a permission note live in the front-matter
rather than in someone's inbox.

## Decision — 6: attribution — a name, and deliberately nothing that turns a name into a reputation

**Decided: per-drill, the author chooses between their own name and
"Anonym tränare". Nothing else about them is ever shown.**

An adult choosing to be identified is fine, and it is the thing that makes
shared material feel like it came from a person. What is not fine is
building the trainer marketplace by accident. `docs/TRAINERS.md` promises
a reputation direction and states in its own words that it is *"not built
yet and not yet designed"*; `docs/internal/BACKLOG.md` lists what must be
settled first — who may write a review, whether a profile is public,
whether a directory inverts ADR-0023 A2's direction of invitation, and
whether money changes the app-store category.

**So the line is drawn at the level of the individual document.** Present
in the library:

- The author's chosen display string, per drill.

**Never present, and each is a decision rather than an omission:**

- **The author's email** — it is the account's SSO identity, and it is a
  contact channel (Decision 5).
- **A profile page, a bio, a photo, or any per-author view.** ADR-0023
  Decision A7 already declined to build `PtProfile`; a library must not
  build it sideways.
- **Any count or aggregate** — "42 drills by X", "most-used author", "most
  saved". A ranking of adults by popularity is a reputation system with a
  different name, and it is exactly what the backlog says needs
  security-reviewer, ux-designer and probably a legal read.
- **Any rating, thanks, upvote, or reaction.** This is the sharpest one,
  because "let coaches give *each other* cred" is the safest-sounding form
  of the owner's ask — no children anywhere near it. It is still the
  reputation system, and it belongs to the marketplace ADR. Noted as the
  natural next request rather than pretended away: if the owner wants it,
  the cheapest safe shape is a private, author-only signal with no public
  ranking — but that shape should be argued in the ADR where its
  consequences live, not bolted onto a file reader.
- **Any link between an author and a team.** A drill records no team,
  ever. `Team.name` frequently encodes a real club and location (ADR-0019
  Decision 3 makes this argument at length); binding a named adult to a
  named youth team in a browsable document is a de-anonymisation shape
  this ADR has no reason to create.

## Decision — 7: adopt Mechanism 2 narrowly — team-to-team kudos, captain-sent, fixed vocabulary, one per team per week, received-only

**Adopted — and this is the one genuine judgment call in this ADR, not a
forced conclusion.** It is the only part of the owner's request that a
child ever experiences, and Decision 10 is blunt about what the ADR looks
like without it.

### Who sends it — the question the brief is right to press on

A captain is a `Player`, i.e. a child. A captain-sent kudos is therefore a
**child-initiated cross-team interaction**, and calling it anything else
would be dishonest. The alternatives were weighed:

- **Adult-initiated (a linked trainer sends kudos to a team).** Rejected,
  and it is *worse* than the child-initiated option on the axis that
  actually matters. To send, the adult must choose a target team from a
  list — which means handing a `StaffAccount` a browsable list of teams.
  That inverts ADR-0023 Decision A2's direction of invitation to buy a
  nicety, and it is Decision 1's move 4.
- **System-generated ("your team passed IBK Falken").** Safe, and not
  what was asked for. Nobody feels credited by an inequality operator.
  Worth a sentence to ux-designer as leaderboard framing (Decision 9's
  tail), not as this mechanism.
- **Any player, not just the captain.** Rejected: a team-level act should
  be a team-level act, and every existing team-level action in this app
  (weekly goal, PT invite code) is captain-gated. It also multiplies the
  volume this decision's scarcity argument depends on.

**Adopted: captain-sent**, via the existing `assertIsCaptainOfTeam`
(verified, `backend/src/players/players.service.ts:285`).

### Is a fixed vocabulary sufficient here? Partly — and the part it does not cover is the interesting one

ADR-0019 Decision 4 chose a fixed reaction vocabulary because *"there is
no sentence a fixed reaction type can form"*, and ADR-0027 Decision 3
reused the same move for audio. That argument is sound and it applies:
a kudos cannot carry a message, an insult, a name, a link, or a
solicitation. **Content risk is closed by construction.**

What a fixed vocabulary does **not** close is **relational** risk — who
gets chosen, how often, and who never does. That is a different failure
mode from the one ADR-0019 and ADR-0027 were defending against, and it has
to be designed for separately:

1. **No kudos count appears on the leaderboard, ever, in any form.**
   Otherwise the app has a second ranking, on being liked, sitting next to
   the one about effort. This is the single most important constraint in
   this decision.
2. **Received-only visibility.** A team sees the kudos it has received. No
   team sees another team's kudos. There is no "who has sent what to whom"
   view anywhere, for anyone (except the operator, via the database — the
   same out-of-band access every other escalation in this app relies on).
3. **One outgoing kudos per team per ISO week, total** — not per target
   pair. You get one a week and you choose who. This makes it a scarce,
   deliberate, positive act instead of a broadcast, and it makes "who
   didn't get one" far less legible, because nobody could have given
   everyone one anyway.
4. **The vocabulary must be unambiguously positive.** No option that can
   be read as pity, sarcasm or condescension; nothing comparative;
   nothing numeric. Exact values and copy are ux-designer's, as with
   ADR-0008's deferred button copy and ADR-0019 Decision 4's reaction
   vocabulary — but *"the vocabulary contains no irony-capable option"* is
   a structural constraint stated here, not a copy preference.
5. **Absence is shown as absence, not as a zero.** A team with no kudos
   sees no card, not "0". This is ADR-0023 Decision C8's *"absence, not a
   locked door"* reasoning, applied to a different screen.
6. **No notification of any kind.** This ADR adds none. A kudos appears on
   a screen the team already opens. (Whether push infrastructure exists at
   all is unverified here; since nothing is sent, the question does not
   bind.)

### The hardest case, named rather than waited for: a kudos to a very small team

ADR-0016's leaderboard already exposes `eligiblePlayerCountRange`, and
`'1-2'` is a real bucket. So a captain can aim a kudos at a team that is
plausibly one child, and if the sending team is also small, the honest
description is *one child caused a token to appear on another child's
phone*.

**Assessed, and accepted, with the argument stated so it can be
challenged:** the payload carries no content, no name, no reply
affordance, no repeat capability within the week, and no way to learn
anything about the recipient that the leaderboard did not already show.
It is the weakest possible cross-team signal that is still a signal. A
minimum-roster-size gate was considered and rejected — ADR-0016 already
examined and rejected roster floors on this exact surface, no such concept
exists anywhere in the codebase, and introducing one here would
disproportionately exclude the small teams this feature is most likely to
cheer up. **This is explicitly flagged for security-reviewer as the item
most likely to change**; if it does, the fix is a predicate on one query,
not a redesign.

### The pressure that remains, stated rather than minimised

Reciprocity. If IBK Falken cheers your team this week, does your one
weekly kudos owe them next week? A little, yes. That is a real social
pull, it is mild, and it is the honest cost of the mechanic. It is
noted here rather than argued away.

### Abuse handling

No per-team mute in v1. A kudos cannot carry content, is capped at one per
week per sending team, and is delivered to a team rather than a person —
so the realistic abuse case is thin. The escalation path is the existing
one: **out-of-band operator action** (the same lever ADR-0010 Decision 4
relies on for un-hiding a reported clip and ADR-0027 Decision 3 relies on
for curation). A captain-facing "turn off kudos for our team" toggle was
considered and **not built**: it is a new captain authority over a
team-wide surface, and this app has consistently refused those unless
argued on their own merits (ADR-0007/0010/0019 Decision 2). Flagged, not
dropped.

## Decision — 8: the kudos data model — one table, Postgres, and it is neither a streak nor a pot

```
TeamKudos
  id                 uuid, PK
  from_team_id       uuid, FK -> team.id, ON DELETE CASCADE
  to_team_id         uuid, FK -> team.id, ON DELETE CASCADE
  kudos_type         enum — small, fixed, unambiguously positive
                       (values: ux-designer, per Decision 7)
  week_start_date    date, not null
                       -- the Monday of the sending ISO week, in UTC,
                          computed server-side and NEVER client-supplied
  sent_by_player_id  uuid, FK -> player.id, ON DELETE SET NULL
                       -- audit only: "which captain did this". NEVER
                          serialized on any surface, in either direction.
                          Same role and same FK behaviour as
                          PtTeamLink.invited_by_player_id ("kept for audit
                          — who brought this PT in", ADR-0023 A2).
  created_at         timestamptz, not null

  UNIQUE (from_team_id, week_start_date)
    -- one outgoing kudos per team per week, enforced by the index rather
       than by application logic, the same "not inflatable" instinct
       ADR-0007 Decision 4 applies to reports and ADR-0019 Decision 4 to
       reactions.
  CHECK (from_team_id <> to_team_id)
```

**`sent_by_player_id` is the only field in this entire ADR that identifies
a child at all.** It is never returned by any endpoint, on either side of
the exchange. It is kept because a team-level act performed by one child
should be attributable if it ever has to be looked into, and because
ADR-0023 already set that precedent for the structurally identical case.
**If security-reviewer would rather it not exist, dropping it costs the
audit trail and nothing else** — no query, contract or feature depends on
it. Offered explicitly rather than defended reflexively.

**The read that crosses the boundary names two tables and no more:**

```sql
SELECT k.kudos_type, k.created_at, from_team.name AS "fromTeamName"
FROM team_kudos k
JOIN team AS from_team ON from_team.id = k.from_team_id
WHERE k.to_team_id = :viewerTeamId
ORDER BY k.created_at DESC
LIMIT :limit
```

This is deliberately the same structural argument ADR-0008 Decision 1
makes for the leaderboard: **`player` is not joined, so there is no
`player_id` in this query for a future contributor to extend into
something per-child.** The boundary is which tables the query names.

`from_team.name` crossing is not new exposure — ADR-0008 already made
`Team.name` cross-team-visible, and team names are keyword-screened at
creation (`teams.service.ts:80-81`, verified).

**Endpoints:**

```
POST /api/v1/teams/:teamId/kudos          { toTeamId, kudosType }
  JwtAuthGuard + assertIsCaptainOfTeam(:teamId).
  409 kudos_already_sent_this_week on the unique-index violation.
  400 if toTeamId === teamId, or names a team with no active
      TeamSeasonPot (i.e. not on the leaderboard — see below).

GET  /api/v1/teams/:teamId/kudos          -> { received: [...], sentThisWeek: {...} | null }
  JwtAuthGuard + assertTeamMembership(:teamId) (verified,
  players.service.ts:258 — every teammate, not captain-gated, matching
  every other team-scoped GET since Phase 2).
  `received` is the query above. `sentThisWeek` is the caller's own
  team's outgoing row, so the captain knows the week is spent.
```

**No new discovery surface.** The set of teams a captain may address is
exactly the set ADR-0008's leaderboard already shows them — same query,
same eligibility (an active `TeamSeasonPot`), no new list, no search, no
"nearby teams" (which CLAUDE.md names explicitly as the thing not to
build).

**Where this sits in the scoring model, stated because the two halves must
not blur:**

- **Individual streaks** live in Redis and are rebuildable, never the only
  copy of anything (ADR-0002). **Untouched.**
- **The team season pot** is the durable Postgres ledger of a season's
  points. **Untouched.**
- **Kudos is a third thing**: durable, Postgres, audit-shaped, and
  **non-scoring**. It must never award a point, modify a streak, feed
  `TeamSeasonPot`, or appear as an input to any ranking — the same
  absolute "no points consequence, ever" ADR-0027 Decision 9 and ADR-0028
  Decision 5 each had to state for their own features. The instant kudos
  is worth points it becomes a currency, and a currency between teams of
  children is a trading and pressure mechanic, not a compliment.
- **No Redis.** The weekly cap is a unique index, which is both the
  enforcement and the record — precisely the case where Postgres is right
  and Redis would be a second, losable copy of a durable fact.

**Retention and erasure**: no new timer, no new sweep, no new config. Rows
are tiny; the read is a recent-N query. `ON DELETE CASCADE` from `team`
covers ADR-0013 Decision 5's cascading team-delete, and `ON DELETE SET
NULL` on `sent_by_player_id` covers a player erasing their account — so
**no new row is needed in ADR-0013 Decision 6's per-entity table**, the
same free-cleanup property ADR-0019 and ADR-0023 Part A each obtained.

## Decision — 9: reject Mechanism 3 — no version of a curated cross-team highlight of children's media survives

**Rejected, and the answer really is "no version survives".** Each variant
in turn, because the rejection is only useful if it names which door it
closes:

- **A captain opts a teammate's clip into cross-team visibility.**
  Rejected outright. This is one child publishing another child's video
  outside the bubble — the invariant itself, not an exception to it. It is
  also worse than ADR-0019, which at minimum routes every publication
  through the uploader's *own* parent (Decision 1 there), and it
  contradicts this app's repeated, deliberate refusal to give a captain
  any authority over another player's content (ADR-0007, ADR-0010,
  ADR-0019 Decision 2's rejected team-level toggle).
- **The uploader opts in, with parental approval.** That *is* ADR-0019,
  in full, including its blocked CLAUDE.md prerequisite. Restating it here
  under a different name would be this ADR's failure condition.
- **An adult publishes, and the media contains no child** — e.g. an
  operator-produced "drill of the week" video, visible app-wide. This one
  does not violate the invariant, so it deserves a real answer rather than
  a reflex. It is still rejected, for two reasons that are about the
  system rather than the content. First, it is not what was asked for:
  editorial broadcast from the operator to every team is content
  marketing, not teams giving each other cred. Second, and decisively, it
  builds **an app-wide media surface** — storage, moderation, retention,
  playback, an audience — on top of the highest-risk subsystem this
  project owns. Once that surface exists, "and let's allow one great team
  clip" is a small diff and a much harder argument to win. That is
  Decision 1's move 5, and it is exactly the "by increments" failure this
  ADR was written to prevent.

**The only survivor-shaped idea**, and it is not a new mechanism: a
*textual, aggregate* highlight on the leaderboard ADR-0008 already
built — "most improved this month", "biggest jump this week". It names a
team, no child, and adds no new data. It is a framing and copy decision on
an existing surface, so it is handed to **ux-designer against ADR-0008**,
not designed here — with one constraint carried over from Decision 7:
any such highlight must not make the bottom of the table legible.

## Decision — 10: what a child actually sees — and what this honestly does not give the owner

**What a child sees that is new**: one thing. A card on their team's
screen saying, in effect, *"IBK Falken hyllade ert lag"* — a team-level
fact, naming no child, carrying no content, with no reply affordance.
That is the entire child-visible surface of this ADR.

**What a child does not see, and will not:**

- Any other team's clip, caption, chat message, screen name, streak,
  badge, or training log.
- Any drill from the library — nothing in the Expo app reads it.
- Any other team's kudos, or any count of anyone's kudos including their
  own team's.
- Any adult's name, profile, or material.

**The gap, stated plainly rather than oversold.** The owner asked for two
things and this ADR delivers them to two different audiences. *"Share
ideas of cool tricks and training ideas"* lands **entirely on adults** —
a child never sees a shared drill, and experiences it only indirectly, as
a better Tuesday practice, with no trace in the app. *"Teams give each
other cred"* reaches children, but as a single low-bandwidth token rather
than the visible, scrolling, social thing the phrase evokes.

**If what the owner actually wants is the kids feeling seen by other kids,
this ADR does not deliver it, and no amount of iterating on it will.**
That is ADR-0019, and it is one sentence in CLAUDE.md away — a sentence
only the owner can write, with a fully-reviewed ADR waiting behind it.
This ADR exists so that "not yet" does not have to mean "nothing", and it
should not be mistaken for a substitute.

**One further honest note**: a drill library is a real, useful feature
that the owner asked for, and it may well be the more durable half. The
trainers `docs/TRAINERS.md` addresses are the people who decide whether a
team uses this app at all.

## Decision — 11: explicitly NOT decided here

Named rather than silently dropped, in the posture ADR-0019 Decision 9,
ADR-0027 Decision 10 and ADR-0028 Decision 17 use:

- **Self-service drill submission by trainers** (the "v2" Decision 2
  refers to). Sketch, so it is not undesigned: a `SharedDrill` table with
  `pending_review`/`approved`/`rejected`/`withdrawn`, an author FK to
  `staff_account`, per-account submission rate limits, an admin review
  queue in the console, and Decision 3's deliberate corpus fork.
  **Trigger**: the operator is hand-adding drills more often than they
  want to, or a second contributor asks for it. **Not built now** because
  it is the first human review queue in this app — ADR-0027 Decision 3
  rejected building one as a side effect (*"This app has no human review
  queue for anything"*) and that reasoning holds until the volume argues
  otherwise.
- **Any rating, thanks, count or ranking of drills or authors** —
  Decision 6. This is the trainer-marketplace ADR, and
  `docs/internal/BACKLOG.md` already lists its prerequisites.
- **A trainer directory** — `docs/design/phase8-trainer-invitations.md`'s
  channel 3, blocked on verification, not on principle. Untouched here.
- **PT write authority of any kind.** A shared drill still cannot become a
  team's weekly goal except by a human retyping it into the existing
  captain-authored flow. The PT write-capability expansion is
  backlog-tracked and undesigned (ADR-0028 Decision 5 restates this), and
  this ADR neither needs nor advances it.
- **Which console tab this lives in.** ux-designer's IA call against
  `docs/design/phase7-admin-console-flows.md`, noting that ADR-0028
  Decision 5 already claims a fifth pillar for AI training plans.
- **Exact numbers**: how many kudos are shown, how long the received list
  reaches back, the drill body length cap, the front-matter enum values.
  Config values next to their existing neighbours — the "mechanisms
  fixed, numbers free" split ADR-0010's Consequences established.
- **The kudos vocabulary itself, and all copy, in 8 locales** —
  ux-designer, subject to Decision 7's structural constraints.
- **Whether a team can mute incoming kudos** — Decision 7, flagged, not
  built.

### What would still require the CLAUDE.md amendment after all

So that nobody has to re-derive it: **any of Decision 1's five moves.**
Concretely, the requests most likely to arrive wearing friendly clothes —
"let the captain share one clip to the leaderboard", "let a coach attach a
video to a drill", "let teams comment on each other's kudos", "let
trainers browse teams looking for someone to help" — are all the same
decision, and it is the owner's, not an architect's or a reviewer's.

## Consequences

- **One new table**: `TeamKudos`. **No changes to any existing table.** No
  Redis structure. No new scheduled job, sweep or retention config. No
  entry in ADR-0013 Decision 6's per-entity erasure table.
- **No new entity at all for the drill library** — Markdown files under
  `backend/src/drills/library/`, shipped via the existing `nest-cli.json`
  assets mechanism, plus a small read-only module and one new public
  method (`PtTeamLinksService.hasAnyActiveLink`).
- **Three new endpoints**: two team-scoped kudos routes and one staff
  drill-library route (list/detail).
- **An amendment ADR-0028 must make to its own Decision 6**, per Decision
  3 — external-contributor authorship, recorded in front-matter. Named
  here; not made here.
- **A CI addition** (small): a regex check that no drill body contains a
  URL, email address or phone number, per Decision 5.
- **`docs/TRAINERS.md` will want a line** once the library exists — its
  "Use someone else's" bullet currently describes something that is not
  built. It is the one document in this repo whose accuracy about what
  exists is load-bearing for real coaches' trust; ux-designer or the owner
  should update it *when* the library ships, not before.
- **The consent copy is unaffected** — verified by reasoning about scope
  rather than assumed: the promise ADR-0019 has to correct in six surfaces
  is *"anything [player] shares… is only visible to their own team"*.
  Nothing a player shares becomes visible outside their team under this
  ADR. **Security-reviewer should confirm this independently**, since
  ADR-0018 and ADR-0019 both found live copy that a new feature falsified,
  and "we checked and it's fine" is exactly the claim those passes
  disproved twice.
- **Blocking `security-reviewer` pass required before any build**, per
  Status. Its centre of gravity is Decision 7 (the child-initiated
  cross-team action, and the small-team case), Decision 4 (the read gate),
  and Decision 5 (whether the moderation honesty holds).
- **Hand-off** — **ux-designer**: the kudos send flow (target selection
  from the existing leaderboard, one-per-week state, spent-week copy), the
  received card and its empty state, the vocabulary and its 8-locale copy,
  and the console's drill-library list/detail screens and IA.
  **backend-developer**: `TeamKudos`, the two team routes, the drill
  module and its loader, `hasAnyActiveLink`; note that
  `startOfIsoWeekUtc` already exists but is **module-private** in
  `backend/src/usage-metrics/usage-metrics.util.ts:182` (verified) —
  export it or move it to `common/`, do not write a second one.
  Neither should start before the blocking pass.

## Open questions for the project owner

1. **Will you actually curate the library?** Decision 2's whole design
   rests on drills arriving as commits that you read. If the honest answer
   is "rarely", the library is better not built than built empty — an
   empty shelf in the console is worse than no shelf, in the same way
   `docs/internal/BACKLOG.md` says marketing a trainer career before one
   exists is worse than saying nothing.
2. **Is kudos worth its risk to you?** It is the only child-visible part
   of this ADR and the only part carrying a genuine judgment call
   (Decision 7). The drill library stands entirely on its own without it,
   and shipping only the library is a coherent, smaller, safer outcome.
3. **Do you want the adult-to-adult "cred" that Decision 6 refuses?**
   Coaches thanking each other for a drill is the safest cred in the
   system — no children involved at all — and it is still the first brick
   of the reputation system `docs/TRAINERS.md` flags as undesigned. Saying
   "yes, and it gets its own ADR" is a perfectly good answer; saying "just
   add a thumbs-up" is not.
4. **Does the drill library change what the site and `docs/TRAINERS.md`
   promise?** If a trainer campaign ever points at it, Decision 4's gate
   means a recruited trainer sees nothing until a team invites them —
   which is fine, and must not be advertised otherwise.
