# SkillStreak — Backlog

This document contains a list of features and improvements that was not planned for the current release of SkillStreak, but are being considered for future enhancements. The list is not exhaustive and is subject to change based on user feedback and development priorities.

## Birthday Year
At the moment it is a button for each year we support at the moment, this should be a dropdown with the years we a wider range of years, and the user can select their birthday year from the dropdown.

## Language Support
Currently, SkillStreak supports only Swedish. We plan to add support for multiple languages to cater such English, Finish, Danish, and Norwegian. This will allow users from different regions to use the app in their preferred language.

## Security Enhancements
### Encryption of the data
All data should be encrypted in the database so if the data get leaked, it will be useless for the attacker. This is a critical security measure to protect user information.

### Secure Authentication
We need to implement secure authentication methods, such as two-factor authentication (2FA) and OAuth, to enhance the security of user accounts.

## Team Chat — LLM-based Moderation (future release)
Phase 2.6b ships team chat with a keyword/profanity filter plus per-message
report/block, since that's buildable now without a new external dependency.
A better, context-aware moderation layer (catching bullying/grooming
patterns a keyword list can't, not just banned words) should use an LLM
classifier on each message before it's delivered to the team — flag/hold
suspect messages for the sending player's own parent to review rather than
silently deleting them, matching this app's "closed team bubble, parent in
the loop" posture. Deliberately deferred out of 2.6b's first pass: it needs
its own design/cost/latency tradeoff discussion (sync classification before
send vs. async post-hoc scan) and a security-reviewer pass on what "held for
review" actually means for a child's message thread.

## 24/7 Automated Uptime/Health Monitoring (future release)
Raised 2026-07-23 while auditing this project's CI/test coverage. Two
different things got asked for together and should stay separate asks:

1. **Scheduled synthetic health checks** — a cron-triggered job (e.g. a
   GitHub Actions `schedule:` workflow, or an external uptime pinger) that
   periodically hits `/health` and, ideally, exercises one real end-to-end
   flow (login + "Jag har tränat") against the deployed environment,
   alerting on failure. Cheap, well-understood, no new infrastructure
   paradigm — the same "boring, standard tool" posture this project
   already prefers.
2. **An "AI-driven" test/monitoring bot** that does more than ping an
   endpoint — reasoning about failures, triaging what broke, maybe filing
   an issue automatically. A meaningfully bigger project: needs a place to
   run continuously, an alerting/paging path, and real scoping on what
   "AI-driven" adds over a normal synthetic monitor before it's worth
   building.

**Blocked on a real prerequisite, not just priority**: per `k8s/README.md`,
this cluster currently has **no working external ingress path** — alpha
access is `kubectl port-forward` only, from whichever machine runs it. A
scheduled external check needs something to actually reach; there is no
public URL for either idea above to hit yet. Revisit once
`k8s/README.md`'s ingress/DNS situation is resolved. When it is, start with
(1) — a plain scheduled health/smoke check — before considering (2).

## Usage Analytics / Product Metrics (future release)
Raised 2026-07-23: track how players/teams actually use the app (feature
adoption, streak drop-off points, which screens get revisited, session
frequency) to guide what to build/fix next, separate from this app's
existing gamification counters (streaks, team pool points) which are
product mechanics, not analytics.

**This is a child-data feature, not a neutral tooling addition — treat it
with the same weight as Phase 3's media work, not as a quick add.**
Specifically, before this is built:
- **No third-party analytics SaaS** (Google Analytics, Mixpanel, Amplitude,
  etc.) without a real discussion — sending children's usage patterns to an
  external processor is a new sub-processor of child data. A self-hosted or
  first-party-only approach (events logged to this app's own
  Postgres/Redis, matching the "boring, already-operated infrastructure"
  pattern this project prefers) should be the default starting point, not
  an assumption that a vendor SaaS is fine because it's common practice
  elsewhere.
- **No location data**, per CLAUDE.md's standing constraint — this
  includes IP-derived geolocation, which off-the-shelf analytics SDKs often
  collect by default and would need to be explicitly stripped/disabled, not
  just "not asked for."
- **Aggregate/team-scoped by default, not individually identifying** —
  mirrors this app's existing anonymization posture (screen names, not
  `real_name`) and its cross-team query bar (structurally can't reach
  `Player`/`PlayerPrivateInfo` from anything cross-team). A coach-facing
  "how's my team doing" view is a very different, much safer thing to
  build than per-child behavioral tracking, and the former should be the
  first target, not the latter.
- Needs an **architect** pass (what's tracked, where it's stored, retention)
  and a **security-reviewer** sign-off before backend work starts, per this
  project's standing rule for anything touching child data — not a silent
  addition to existing endpoints.

## Public website onboarding widget — abuse mitigation (before going live)
Raised 2026-07-26: `site/index.html`'s "Kom igång" section embeds a real,
functional join/create-team flow (calls the actual `GET /teams/invite`/
`POST /players` endpoints via a newly-enabled CORS config — see
`feature/site-landing-and-onboarding-widget`), so anyone can create a real
team/player and trigger a real parental-consent email straight from the
public marketing page, not just from inside the mobile app.

**Accepted, tracked gap, not fixed now** — deliberately shipped as-is for
this local/first-version deployment (no real public internet traffic yet),
same posture this project already takes with other accepted gaps (the
180-day JWT with no revocation, the in-memory/per-pod rate limiter). Two
distinct risk vectors, both need a real decision before any real external
launch:

1. **Real consent emails to arbitrary, unverified addresses, at much lower
   friction than before.** The mobile app already never verifies
   `parentContact` beyond a format check — that's not new. What's new is a
   public, crawlable, no-install-required page removes the friction (and
   discoverability cost) a bad actor previously had to clear to hit these
   endpoints at all. Currently bounded only by the existing generic
   `10/min`-per-IP throttle (`@Throttle` on `POST /players`), not anything
   specific to this new surface.
2. **Junk/offensive team names become visible on the real cross-team
   VM-Guld leaderboard.** `Team.name` is deliberately cross-team-visible by
   design (ADR-0008) — a casual visitor just trying the widget out (or a
   bad-faith one) can put a name in front of real kids on real other teams.
   The existing content filter (`ChatModerationCheck`) blocks banned words,
   not generic junk/gibberish.

**Options discussed, not chosen yet** (project owner's call, closer to
launch):
- A stricter, separate rate limit just for this public path (e.g. a few
  per hour per IP), tighter than the general endpoint throttle.
- Gate team names created through this specific path from the public
  leaderboard until a human approves them — solves risk 2 specifically,
  doesn't touch risk 1.
- Some lighter-weight bot/abuse deterrent (e.g. a honeypot field) as a
  cheap first layer against drive-by scripted abuse specifically, distinct
  from a determined human actor.

**Trigger condition to revisit:** before this site is reachable from the
real public internet (i.e. once `k8s/README.md`'s external-ingress gap is
resolved for whichever cluster serves it for real) — not blocking for a
local/internal-network first version.

## PT/Tränare (Personal Trainer/Coach) role (future release, business idea)
Raised 2026-07-26: let a team bring in its own Personal Trainer or Coach,
who helps build challenges, set new goals, and plan out different training
months for the team — a real person doing today's Kapten/weekly-goal work,
but as a paid or invited role rather than a teammate. Two follow-on ideas
bundled with this, kept here as one entry but genuinely separable:

1. **A future AI-driven version of the same role** — SkillStreak itself
   acting as the "PT," generating challenges/plans automatically, and
   drawing on players' own uploaded clips (the Phase 3 video feed) to give
   feedback or tailor plans to what it sees.
2. **A business model**: PTs/coaches paying to use this as a real coaching
   tool for their own teams (recovering the app's build cost), and/or a
   paid tier for players/parents who want the fuller PT experience.

**Why this needs real design work before it's more than an idea, not just
a bigger version of an existing feature:**

- **This app already tried, and deliberately walked back, an adult-authority-
  over-children role once.** Phase 2's original design was a coach
  login/dashboard with authority over challenges and player sessions
  (`docs/adr/0004-coach-auth-and-session-reissue.md`) — replaced mid-build
  by the peer-based Kapten model specifically to avoid handing an adult
  (or anyone) that kind of standing authority over kids' accounts. The one
  piece of that original design that *did* ship (session reissue) had a
  CONFIRMED CRITICAL finding (full account takeover, not just
  impersonation — see `docs/ACTION_PLAN.md`'s Phase 2 section) and is
  disabled to this day. A PT role is a real reintroduction of that same
  shape of authority (an adult who isn't the child's own parent, directing
  what a child does in the app) — it needs the same level of scrutiny that
  history already paid for, not a fresh assumption that it's safe because
  it's framed as a helpful feature.
- **A PT is a new adult who can see into a closed team bubble.** This
  app's whole privacy posture (`CLAUDE.md`) is "a user only ever sees
  their own verified team" — a PT, especially one serving multiple teams
  as a paying customer, is a new category of person with a legitimate
  reason to see across teams. Needs its own access model and its own
  parental-consent question (does *adding* a PT to a team need a parent's
  yes, the same way media upload does?), not an assumption that "coach"
  scaffolding already in the schema (dormant since the Kapten pivot)
  covers it as-is.
- **The AI version is a second, separate consent problem, not just a
  bigger version of the first.** Feeding kids' already-uploaded clips
  (uploaded for the closed team feed, per ADR-0010) into an AI model for a
  *new* purpose (automated coaching analysis) is a real purpose-limitation
  question under GDPR, not something the original upload consent covers by
  default. This is the same territory `docs/adr/0010-video-storage-and-
  serving.md`'s deferred content-moderation item and this file's Team
  Chat LLM-moderation entry already flag — likely converges with those on
  the same eventual Python/uv ML service (`docs/adr/0003-package-
  managers.md`), but is a distinct use case (coaching feedback, not
  moderation) needing its own sign-off, not inherited from theirs.
- **The business/paid-tier idea is real and separable from the AI idea.**
  A paid tool for real human PTs to manage real teams could ship without
  ever building the AI version — worth scoping and pricing as its own
  thing rather than waiting on the harder AI-and-child-video problem to
  be solved first.

Needs an **architect** pass (the access/consent model for a human PT, kept
separate from the AI-feature design) and a **security-reviewer** sign-off
before any of this is built, per this project's standing rule for
anything touching child data or account authority — not a silent
extension of the existing Kapten/`Coach` scaffolding.
