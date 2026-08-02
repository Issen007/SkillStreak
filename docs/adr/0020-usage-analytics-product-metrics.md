# 0020 - Usage analytics / product metrics (Fas 5, item 1)

## Status

Proposed — 2026-08-02.

**Blocking security-reviewer sign-off required before backend-developer
builds anything against this**, argued rather than reflexively asserted,
from three independent sources all pointing the same way:

1. `docs/PROJECT.md`'s own text for this exact item says so directly:
   *"Kräver egen arkitekt- och säkerhetsgranskning (barndata)"* — this
   ADR is the architect half of that explicit precondition; the security
   half is not optional or implied-satisfied by this document existing.
2. `docs/BACKLOG.md`'s "Admin control/monitoring Web UI" entry — the
   larger, separate idea this ADR is deliberately *not* building (see
   Decision 4) — states the identical requirement for its own "usage
   statistics" piece: *"needs an explicit architect/security-reviewer
   pass, not just a dashboard someone wires up... very likely to be built
   on real (if aggregated) child usage data."* This ADR's scope is the
   smaller precursor to that piece; it should get no lighter a gate.
3. This project's standing practice treats *any* new derived data about
   children — even aggregate, even sourced entirely from data already
   collected for the app's own product purposes — as needing an
   independent check, not architect self-certification: ADR-0016's
   count-only `Player` join ("first time a cross-team query joins to
   `Player` at all, even count-only") and ADR-0018's `VideoClipTag` table
   both went through this same gate despite neither adding a new consent
   surface or third party.

**Scoped review, not a repeat of ADR-0010/0018/0019's full weight**: unlike
those three, this ADR adds no media, no new consent gate, no cross-team
visibility path, and (per Decision 4) no new UI or player/coach-facing
surface at all — there is nothing here for ux-designer or frontend-developer
to build.

**Security-reviewer pass, 2026-08-02 — not a clean sign-off, one required
fix.** Decisions 1, 2, 4, 5, and 6 confirmed sound as written;
backend-developer may treat them as settled. **Decision 3's bucketing
reuse from ADR-0016 didn't transfer as cleanly as originally claimed** —
the two ADRs bucket structurally different things (a per-team displayed
value vs. a cohort-aggregate stratification key), and at this app's real
current beta scale, the team-size-bucketed subset of Decision 1's metrics
(adoption/consent funnel; weekly-goal engagement) could degenerate to a
bucket containing only one or two teams — no longer a genuine aggregate.
**Fixed the same day**: Decision 3 amended with a minimum-population floor
(recommend N ≥ 5 teams per bucket per reporting period; below that, fold
into the app-wide number rather than report the bucket) — additive, not a
redesign, and confirmed by the same review to fully close the gap once
implemented. Decision 7's "no new consent copy" conclusion, which was
explicitly conditioned on Decision 3 holding, is confirmed sound
throughout for every app-wide metric and now sound for the bucketed ones
too, once Decision 3's floor is actually implemented as specified —
tracked as a real implementation requirement for backend-developer, not
optional polish. Net: **backend-developer may build against this ADR as
written (with Decision 3's amendment), including the bucketed metrics,
once the population floor is implemented alongside them — not deferred to
a follow-up.**

## Context

`docs/PROJECT.md`'s Fas 5, item 1, in full: *"Användningsanalys/
produktmått (från backlogen) — förstå hur riktiga lag faktiskt använder
appen innan nästa stora satsning väljs. Kräver egen arkitekt- och
säkerhetsgranskning (barndata), se backlogen."* Raw intake, same shape as
ADR-0018's "AI understands the video" and ADR-0019's "public feed" before
their own architect passes — this ADR does the same turning-vague-into-
concrete work. The project owner has confirmed Fas 5's own stated
precondition ("a real public user base exists") is met, so this is
green-lit to design now, not a preview of a later phase.

**What already exists, load-bearing for Decision 1** — this app already
writes rich, durable, structured data to Postgres for its own product
reasons, none of it built for analytics but all of it usable for it:
`TrainingLogEntry` (append-only, `playerId`/`teamId`/`activityType`
[fixed enum]/`durationMinutes`/`loggedAt` — the "did a child train"
source of truth CLAUDE.md's own no-location-tracking constraint already
shaped), `Challenge` (this app's actual "weekly team goal" entity, despite
the product-facing name — `teamId`/`targetMetric`/`targetValue`/`status`/
`goalBonusAwardedAt`), `TeamSeasonPot` (`teamId`/`seasonId`/`pointsTotal`/
`status` — the VM-Guld pot), `VideoClip` (`teamId`/`status`/`createdAt` —
upload counts only; **there is no view-count or watch-event field
anywhere on this entity today**, confirmed by reading it directly, not
assumed), `TeamChatMessage` (`teamId`/`createdAt` — message volume, never
`content`), `BadgeAward` (`playerId`/`badgeId`/`awardedAt` — `badgeId`
references a small, fixed `Badge` catalog, not freeform text), and
`Player` (`teamId`/`parentalConsentStatus`/`teamJoinStatus`/
`currentStreakCount`/`longestStreakCount`/`createdAt` — never `real_name`/
`parent_contact`, which live in the separate `PlayerPrivateInfo` table
this ADR never touches).

**One thing checked and explicitly not found**: there is no
captain-transfer history table (`docs/adr/0006-captain-transfer.md`
transfers `Player.isCaptain` in place, with no audit row) — "captain
transfer frequency" is *not* a derivable metric from existing data, and
this ADR doesn't invent a new table to make it one (see Decision 1). Read
before assuming, not guessed at.

**Precedent this ADR reuses rather than re-derives**:

- `docs/adr/0010-video-storage-and-serving.md` Decision 1 and
  `docs/adr/0018-ai-video-content-tagging.md` Decision 2 — the
  self-hosted-vs-third-party reasoning framework for anything touching
  child data, reapplied in Decision 2 below to a materially *smaller* new
  data flow (queries over data that already exists) than either of those
  ADRs had to weigh (video bytes; frames sent to a classifier).
- `docs/adr/0016-cross-team-leaderboard-fairness.md`'s addendum — the
  exact "bucket a small-`n` count instead of showing it exactly, or
  dropping it" playbook for showing team-level variation without letting
  a bucket degenerate into one identifiable child's status — reused
  directly in Decision 3, not reinvented.
- `docs/BACKLOG.md`'s "In-app report a problem" entry, which already
  landed on the same instinct this ADR reaches independently: *"a report
  triggers a best-effort email to the project owner via the SMTP infra
  this app already has... not a new in-app admin console, unless the
  volume/frequency turns out to justify one."*
- `tools/uptime-monitor/` and `tools/local-release-poller/` — this app's
  existing "a scheduled script/job, not a dashboard" instinct for
  project-owner-facing operational tooling, extended (with one deliberate
  divergence, see Decision 5) to this feature.
- `docs/BACKLOG.md`'s "Admin control/monitoring Web UI" entry — a
  separate, much bigger, not-yet-designed idea from the project owner
  that includes "usage statistics" as one of at least three bundled
  pieces. Decision 4 states this ADR's relationship to it explicitly.

## Decision — 1: scope — a fixed, allow-listed set of aggregate queries over data that already exists, not an event-tracking pipeline

Three candidate shapes exist for "understand how real teams use the app,"
weighed the same way ADR-0018 weighed its own three candidates for "AI
understands the video":

- **(A) A handful of predefined aggregate queries/views over existing
  Postgres tables** — e.g. "what % of teams complete their weekly goal,"
  "what's the distribution of streak lengths." Zero new client
  instrumentation, zero new data collected about any child that isn't
  already collected for the app's own gameplay purposes.
- **(B) A general-purpose event-tracking pipeline** — a new
  `AnalyticsEvent`-style table (or third-party SDK, see Decision 2) that
  logs screen views, taps, session lengths, funnel steps not currently
  captured anywhere (e.g. "did they open the app but not log training,"
  "which onboarding screen did they abandon on"). Genuinely more powerful
  for real product-funnel questions, but a fundamentally different, much
  larger thing: new client-side instrumentation shipped into the Expo app
  itself, a new high-write-volume table, and — the load-bearing problem —
  a data shape whose entire purpose is a fine-grained, timestamped,
  per-action trail per child, which is structurally the opposite of what
  Decision 3 below concludes this feature should ever produce.
- **(C) New counters on existing entities** (e.g. a `VideoClip.view_count`
  incremented on every feed fetch) — a smaller, real gap (the app
  currently has upload counts but no engagement/watch signal), but still
  *new instrumentation*, not "read what's already there."

**Decision: (A) only, for this ADR.** A fixed, named list of aggregate
metrics computed by scheduled read queries against tables that already
exist, listed below so "what gets measured" is an explicit allow-list, not
an open-ended capability:

- **Adoption/consent funnel** (app-wide, and per Decision 3's bucketed
  team-size segments): count of `Player` rows by
  `parentalConsentStatus`/`teamJoinStatus`, and % who have logged at least
  one `TrainingLogEntry` — a single onboarding funnel, from the two gating
  fields this app already tracks.
- **Individual-streak health** (app-wide): a histogram of
  `Player.currentStreakCount`/`longestStreakCount` into fixed buckets
  (e.g. `0`, `1-3`, `4-7`, `8-14`, `15-30`, `31+`) — never a sorted list of
  individual values.
- **Activity recency** (app-wide): % of players with a `TrainingLogEntry`
  in the trailing 7/30 days — the closest thing this app has to a
  "retention" number, computed from the same append-only log the streak
  counters are already derived from.
- **Training-type mix** (app-wide): count of `TrainingLogEntry` rows
  grouped by `activityType` — this is already a fixed Postgres enum, so
  this is a `GROUP BY` over an allow-listed vocabulary, not new
  classification work.
- **Weekly-goal engagement** (app-wide, and per team-size bucket): % of
  `Challenge` rows (this app's "weekly team goal" entity) reaching
  `status = completed` within their window, reusing ADR-0015's existing
  per-player-completion definition rather than a new one.
- **Team-pool (VM-Guld) engagement**: distribution of
  `TeamSeasonPot.pointsTotal` growth rate (points/week) across active pots
  — the same underlying data ADR-0016's `adjustedScore` already
  aggregates for a different purpose (ranking), reused here for a
  distribution instead of a rank.
- **Social-feature usage, counts only**: `VideoClip` upload counts per
  week (never which clip, never by whom individually), `TeamChatMessage`
  volume per week (never `content` — this app has never persisted chat
  content for analytics and this ADR does not start).
- **Badge mix**: `BadgeAward` counts grouped by `badgeId` (a small, fixed
  catalog row, not freeform text) — which badge types actually get earned
  in practice, useful for tuning the gamification design itself.

**Explicitly excluded from v1, named so it isn't silently assumed later**:
captain-transfer frequency (no history table exists, per Context — adding
one solely for this ADR would be new instrumentation, out of (A)'s scope);
`VideoClip` view/watch counts (no such column exists — see (C) above,
flagged as a plausible, small, additive follow-up if engagement-on-clips
specifically turns out to matter, not built here); anything from
`TeamChatMessage.content`, `PlayerPrivateInfo`, or any freeform field.

This mirrors ADR-0018's own "build the smallest thing that's still
genuinely useful" call (single fixed-vocabulary tag, not a RAG database)
and the uptime-monitor work's "a scheduled script, not the bigger AI-driven
dashboard idea" — the instinct this codebase already has for exactly this
shape of request.

## Decision — 2: self-hosted aggregate Postgres queries, not a third-party analytics SDK/platform

Applying the identical framework ADR-0010 Decision 1 and ADR-0018 Decision
2 already established for this project, to this domain:

- **Third-party product-analytics platform** (Mixpanel, Amplitude,
  PostHog, Google/Firebase Analytics, etc.). The fastest to integrate — no
  query-writing, ready-made funnels/dashboards. But this means embedding a
  vendor's client SDK into the Expo app and/or the backend, which would
  start sending real, if pseudonymous, behavioral data about children —
  device identifiers, session timestamps, event streams — to an external
  company for the first time in this app's history in this form. This is
  the same **new sub-processor relationship** ADR-0010/0018 already
  refused for video storage and AI tagging, for the identical underlying
  reason: a real DPA with the vendor, an update to whatever privacy
  disclosure this app makes to parents, a check on whether that vendor's
  terms even permit processing data from users this young, and — beyond
  the trust question — these platforms' entire product is built around a
  **per-user event stream** (screen views, taps, funnels, cohorts by
  individual), which is structurally the opposite of Decision 3's
  aggregate-only conclusion below. Adopting one wouldn't just add a new
  external party; it would also make the *wrong-shaped* data the path of
  least resistance, working against Decision 3 rather than with it.
  **Not recommended**, for the same reasons and with the same "not decided
  silently" framing ADR-0018 gave its own third-party option.
- **Self-hosted aggregate queries against this app's own Postgres —
  recommended.** Every field Decision 1's metric list needs already lives
  in Postgres, written there for the app's own gameplay purposes. Querying
  it adds **zero new places the data goes** — a stronger version of the
  "boring, reuse infrastructure this app already controls" property
  ADR-0018 Decision 2 claimed for its self-hosted classifier (which still
  had to read video bytes it hadn't looked at before); here, nothing new
  is even read that wasn't already durable, product-critical data. No new
  service, no new package-manager convention exercised (unlike ADR-0018,
  which triggered `uv`'s first real use) — this stays inside the existing
  NestJS/TypeORM stack.
- **Redis is not used as a source for this feature**, restated plainly
  because CLAUDE.md's own database description could be misread otherwise:
  Redis in this app holds "streaks, leaderboards, rate limits — all
  rebuildable, never the only copy of anything" (per ADR-0002) — a cache
  that can be flushed/rebuilt at any time, with no historical/audit
  guarantee. A periodic product-metrics report needs the durable,
  authoritative numbers, so every query in Decision 1 reads Postgres only,
  matching this codebase's own established Postgres-vs-Redis division of
  labor rather than reaching for the faster-but-ephemeral copy.

## Decision — 3: granularity — app-wide and team-size-bucketed aggregates only; explicitly, never per-player, never a named per-team breakdown

This is the constraint CLAUDE.md's non-negotiable list exists to enforce,
applied directly: no location tracking (irrelevant here — nothing in
Decision 1's list is location data, restated only for completeness), and
the screen-name-anonymization option must not be undermined by a reporting
feature that reconstructs one specific child's behavior anyway, screen
name or not.

**Decision: every metric in Decision 1 is either app-wide (a single
number/histogram across all teams) or broken out by a bucketed team-size
segment, never by named team, and never by individual player.**

- **App-wide is the default and primary shape** — sufficient for the
  actual question this phase asks ("understand usage before choosing the
  next investment"), and the shape every metric in Decision 1 is listed
  in above.
- **Where team-level variation is genuinely useful** (e.g. "does the
  weekly-goal feature engage small teams differently than large ones"),
  breakdowns use the **same bucketing convention ADR-0016's addendum
  already established**: `'1-2'` / `'3-5'` / `'6+'` eligible-player-count
  segments, never a named team row.
- **Security-reviewer correction, 2026-08-02 — required, not a redesign**:
  reusing ADR-0016's bucket boundaries is not, by itself, sufficient here,
  because this ADR applies them to a **structurally different operation**
  than ADR-0016 solved. ADR-0016 bucketed a single **per-team, cross-team-
  visible displayed value** (so the exact 0→1 transition could never be
  read off *one team's own row*). This ADR instead uses team size as a
  **stratification key to pool many teams into a cohort**, then reports an
  aggregate statistic *about that cohort* (e.g. "% of teams in the `'1-2'`
  bucket completed their weekly goal"). That only stays a genuine aggregate
  if the bucket actually contains enough teams — and at this app's real,
  current beta scale (a handful of teams total, per `docs/ACTION_PLAN.md`),
  the `'1-2'`-eligible-player bucket could easily contain zero, one, or two
  teams at report time. A bucket containing exactly one team is not an
  aggregate at all — it's that team's own outcome, and since a `'1-2'`
  team has at most two children, it can resolve to one or two specific
  children's behavior, exactly what this Decision otherwise excludes by
  construction. This is precisely the "a deliberately-built, recurring,
  allow-listed report that reliably surfaces one child's data — a
  different thing, worth refusing" case the Residual paragraph below
  already names as unacceptable, not the accepted ad hoc-DB-access
  residual.
  **Fix: every team-size-bucketed metric additionally requires a minimum
  population floor before being reported for a given period — recommend
  N ≥ 5 teams in that bucket** (tunable, a config value like Decision 6's
  cadence, not an architectural constant). A bucket falling below the
  floor in a given run is **folded into the app-wide number for that
  metric, not fabricated and not shown as a visible gap** — the report
  simply doesn't break that metric out by team size that month. Unlike
  ADR-0016 (which rejected a suppression floor specifically because
  suppressing a small team's own leaderboard row would defeat that
  feature's entire player-facing legibility purpose), nothing here makes
  suppression costly: this is an internal, non-real-time, project-owner-
  only report with no legibility-to-the-affected-party purpose to
  protect, so a floor closes the gap for free. This is an additive
  amendment to this Decision, not a reason to revisit Decisions 1, 2, 4,
  5, or 6, all of which the same review confirmed sound as written.
- **Explicitly, permanently out of scope for this feature**: any query
  keyed to return a specific named child's individual behavior, timeline,
  or trail (e.g. "show me everything player X did"); any per-player list
  sorted or filterable by name/screen-name; any named-team row in a
  report. These would function as **covert individual monitoring of a
  specific kid**, regardless of intent, and this ADR excludes them by
  construction — Decision 1's query list has no such shape anywhere in
  it, and this Decision states the boundary explicitly rather than
  leaving it to be inferred, per this project's own "flag, don't leave
  the obvious default unstated" practice.

**Residual, stated plainly rather than implied**: the project owner
already holds direct Postgres credentials as an operational necessity of
running this app (the same person who applies migrations, runs
`kubectl`, and — per `docs/adr/0010`'s own admission for video takedowns —
performs out-of-band admin actions no in-app mechanism exists for yet).
This ADR cannot, and does not claim to, make ad hoc per-child querying by
someone who already holds that access structurally impossible — the same
"defends against routine, in-app/tooling-level observation, not a
determined actor with existing broader access" residual framing
ADR-0016/0019 already accept for their own residuals. What this ADR *does*
prevent is this feature — the recurring, repeatable, allow-listed report
this ADR actually builds — from becoming a first-class, supported
per-child monitoring surface. That distinction matters as a matter of
design discipline even though it doesn't change what raw DB access already
permits: a deliberately-built, recurring tool that surfaces one child's
data is a different thing, worth refusing, from an operator's pre-existing
incidental access.

## Decision — 4: relationship to `docs/BACKLOG.md`'s Admin control/monitoring Web UI — standalone now, one possible future input, not a presupposition

`docs/BACKLOG.md`'s separate, much bigger "Admin control/monitoring Web UI"
entry bundles at least three different things (live monitoring/stats/error
visibility, social-media campaign control, blog generation), is explicitly
not yet designed, and names "usage statistics" as one of its own pieces
needing this exact same architect/security-reviewer gate.

**Decision: this ADR is a small, standalone deliverable — a scheduled
job producing a periodic report (Decision 5) — that neither presupposes
nor blocks on that future dashboard existing.** It can ship and be useful
on its own, on the timeline that dashboard doesn't have yet. If/when that
larger admin surface is eventually designed, Decision 1's query set is a
natural, reusable input for one tile of its "usage statistics" piece — the
underlying queries don't change shape depending on whether their output
goes to an email or a future web UI — but that reuse is a future
decision, made when that ADR is written, not designed or committed to
here. This mirrors exactly how `docs/adr/0019`'s Decision 9 stated its own
relationship to the separate BACKLOG points-tier idea: acknowledged,
not contradicted, not built.

**Sole consumer for this ADR: the project owner, not any player, coach, or
captain.** Nothing in Decision 1's metric list is exposed through any
existing player-facing endpoint, and no new authenticated
player/coach-facing endpoint is added — this is why Decision 3's
bucketing is even more conservative than it strictly needs to be for a
single, already-privileged internal consumer: it's cheap insurance against
this report ever being copy-pasted into a future team-facing feature
without the reasoning being redone.

## Decision — 5: delivery mechanism — an in-process scheduled job inside the existing API, emailing a report; no new endpoint, no new admin auth system

Three shapes were weighed for how the project owner actually receives
this:

- **A new authenticated admin API endpoint** (the owner calls it, or a
  future dashboard does). Rejected for this phase: this app has
  deliberately never built an adult/admin authentication system — Phase
  2's pivot explicitly removed the original coach-dashboard/adult-login
  concept (`docs/ACTION_PLAN.md`'s Phase 2 section) and nothing since has
  reintroduced one. Building one now, solely to gate a single-consumer,
  low-frequency report, would be disproportionate new attack surface for
  exactly the kind of feature that should stay boring, and would
  re-litigate a decision this app already made deliberately for
  unrelated reasons.
- **An external script polling the production API/DB from outside the
  cluster** — the `tools/uptime-monitor/`/`tools/local-release-poller/`
  pattern. Rejected, for a concrete infra reason specific to this project,
  not a style preference: those tools work because they poll **public
  HTTP endpoints** by design (uptime-monitor's own README: it must run
  outside the cluster specifically to detect a networking failure of that
  same cluster). This feature needs to read Postgres directly, and
  Postgres is deliberately `ClusterIP`-only with zero external exposure
  (`docs/adr/0010-video-storage-and-serving.md` Decision 2's posture,
  applied identically to Postgres) — an external script cannot reach it
  without opening new network exposure to the database itself, which
  would be a categorically worse trade than the alternative below.
- **An in-process scheduled job inside the existing API service —
  recommended.** The same "boring, no new Kubernetes primitive" pattern
  this codebase already uses repeatedly (`@nestjs/schedule`, exactly as
  ADR-0010 Decision 5's retention/`pending_upload` sweeps and ADR-0005's
  goal-bonus check already do): a new module (e.g. `usage-metrics/`) runs
  Decision 1's fixed queries directly against the API's own existing
  Postgres connection, on a periodic schedule (see Decision 6), and sends
  the result as an email via the existing `MailService`/SMTP
  infrastructure (the same relay `consent`/`team-chat`/`video-clips`
  reports and `tools/uptime-monitor` already use) to a single new
  recipient address, stored as a new config value (e.g.
  `USAGE_REPORT_RECIPIENT_EMAIL`, a new `Secret` entry alongside the
  existing SMTP credentials — not a schema change). This needs **no new
  `k8s/` Service, no Ingress, no admin-authentication system, and no new
  network path** — the job runs where the data already lives and where
  outbound email already works, closing the loop with the smallest
  possible new surface. This also directly matches
  `docs/BACKLOG.md`'s own "report a problem" entry's independently-stated
  instinct: *"email... not a new in-app admin console, unless the
  volume/frequency turns out to justify one."*

**Defense-in-depth, left to backend-developer, not required for v1**: a
dedicated, least-privilege Postgres role (`SELECT`-only, scoped to exactly
the tables/columns Decision 1 lists — never `PlayerPrivateInfo`) is a
reasonable follow-up, the same "don't reuse a broader credential than the
job needs" instinct ADR-0018 Decision 5 required for its classification
service's MinIO access — but reusing the API's own existing connection
pool for v1 is not itself a security gap (the API already has full read
access to every table this job needs; the job runs *inside* the API
process, not as a separate, differently-trusted actor), so this is a
hardening nice-to-have, not a blocking prerequisite the way ADR-0018's
credential-scoping finding was for a genuinely new, separately-deployed
service.

## Decision — 6: cadence and persistence — flagged as business judgment calls, defaults picked, easy to revisit

Two questions here are not purely technical, named explicitly per this
project's "flag, don't silently decide" practice rather than buried in
confident engineering language:

- **How often should this run?** A monthly cadence is this ADR's default
  — "understand usage before choosing the next big investment" is a
  slow-moving decision, not one that benefits from weekly noise, and a
  lower frequency also means fewer emails carrying even aggregate numbers
  to sweep up if that inbox is ever compromised (a real, if small,
  argument for Decision 3's aggregation choice paying off twice). This is
  a config value (e.g. a cron expression), not a schema decision — the
  project owner should feel free to pick weekly or quarterly instead
  without this ADR needing revisiting, the same "tunable, not
  architecturally rigid" posture ADR-0010's own numeric caps already
  have.
- **Should results be persisted for trend charts, or recomputed fresh
  each run?** This ADR's default is **no new table** — each scheduled run
  recomputes Decision 1's metrics fresh from source tables over a
  trailing window (e.g. the last 30 days as of run time), and the emailed
  reports themselves are the de facto historical record (comparable
  report-to-report in the owner's own inbox). This is the smaller,
  additive-later option: if real time-series visualization ever becomes
  valuable (plausibly as a piece of the future BACKLOG admin dashboard,
  per Decision 4), a `UsageMetricsSnapshot`-style table storing each run's
  computed numbers is a small, reviewable, additive follow-up then — not
  scope to pre-build now on spec, the same "build the narrow thing
  that's actually needed" instinct ADR-0019 Decision 6 already applied to
  rejecting a generic bookmark table.

Both defaults are easy to change without touching this ADR's core
decisions (1-5) at all.

## Decision — 7: consent/disclosure — no new consent gate or copy required, conditioned explicitly on Decisions 1 and 3 holding

`docs/adr/0018-ai-video-content-tagging.md` Decision 3 needed a
consent-copy update because it introduced a *new kind of processing of a
specific child's specific uploaded content* — informed-consent principles
favor naming that, even where a new consent *gate* wasn't required.
`docs/adr/0019-public-shorts-feed.md` needed (and found) a much bigger
disclosure problem because it made an *existing, specific promise about a
specific child's specific clip* false the moment it shipped.

**This feature is neither of those things, argued rather than assumed**:
by Decision 3's own construction, this feature's output is never "about"
any identified or identifiable child — it is a count, percentage, or
histogram bucket describing many children's aggregate behavior, computed
in a shape this ADR structurally excludes from ever resolving back to one
individual (no per-player rows, no named-team rows below the bucketing
floor). Aggregate statistics of this kind don't process an individual's
personal data in GDPR's sense — nothing here is "about" a specific,
identifiable child the way a specific clip's AI-generated tag or a
specific clip's publish-approval status already is. **Decision: no new
consent gate, and no addition to the existing consent-page copy
(`backend/src/consent/consent-page.templates.ts`), is required for
Decision 1's metric list at Decision 3's stated granularity.**

**This conclusion is explicitly conditional, not a blanket "aggregate is
always fine" rule**: it holds only as long as Decision 3's floor is not
loosened. If a future change ever adds a per-player metric, a named-team
breakdown, or any output that could resolve to one identifiable child, it
crosses back into the same territory ADR-0018 Decision 3 and ADR-0019 both
already had to reckon with, and needs the same treatment — a fresh
disclosure/consent analysis, not an assumption that this Decision still
applies. Stated explicitly so a future contributor loosening Decision 3
doesn't silently also invalidate this Decision without re-checking it.

**Separately, not this ADR's job to fix**: `consent-page.templates.ts`
currently carries the live, unqualified "only visible to their own team"
claim ADR-0019's Context section already flagged as needing correction
before that feature ships. This ADR adds nothing to that finding and
doesn't need it fixed first — nothing this ADR builds touches per-clip
visibility — but is noted here so it isn't mistaken for something this
ADR silently ignored.

**Security-reviewer confirmation, 2026-08-02**: exactly the scenario named
above was found live, not hypothetical — Decision 3's bucketing didn't yet
hold at this app's real current scale for the two team-size-bucketed
metrics (adoption/consent funnel; weekly-goal engagement), so this
Decision's conclusion was correspondingly unverified for those two until
Decision 3's minimum-population-floor amendment closed it. This
Decision's conclusion is sound, without further changes, **once that
floor is implemented** — the floor tightens Decision 3, it doesn't loosen
it, so this Decision's own conditional language ("holds only as long as
Decision 3's floor is not loosened") is satisfied, not triggered. Every
app-wide-only metric in Decision 1 was confirmed sound under this
Decision throughout, with no gap at any point.

## Consequences

- **No schema migration, no new Postgres table** (Decision 1/6) — every
  query reads existing columns; the only new artifact is application code
  (a new `usage-metrics/` module) and one new email-recipient config
  value/`Secret` entry.
- **No third-party sub-processor introduced** (Decision 2) — no vendor
  DPA, no new privacy-policy update needed for an external analytics
  platform, because there isn't one.
- **No new Kubernetes primitive, no new network exposure** (Decision 5) —
  reuses the existing in-process `@nestjs/schedule` pattern and existing
  SMTP relay; Postgres's `ClusterIP`-only posture (ADR-0010) is unaffected
  and not worked around.
- **No ux-designer or frontend-developer work at all** — the first ADR in
  this repo with zero player-facing surface, by design (Decision 4): this
  is internal, project-owner-only tooling, not a product feature.
- **Left open, not decided here**: exact cadence and whether to eventually
  persist a metrics-history table (Decision 6, flagged as business
  judgment calls with easy-to-revisit defaults); whether a dedicated
  least-privilege Postgres role is added for this job (Decision 5,
  recommended hardening, not blocking); the exact SQL/aggregation
  implementation and the `usage-metrics/` module's internal shape
  (backend-developer's call, against Decision 1's fixed metric list).
- **Explicitly deferred, not silently dropped**: client-side event
  instrumentation / a general funnel-tracking pipeline (Decision 1's
  option B), `VideoClip` view/watch-count tracking (Decision 1's option
  C), captain-transfer-frequency tracking (no source data exists today),
  and any reuse of this ADR's queries inside the separate, not-yet-designed
  BACKLOG admin dashboard (Decision 4) — all real, plausible future work,
  none of it built or precluded by this ADR.
- **Hand-off**: this ADR is design-only. **A blocking security-reviewer
  pass is required before backend-developer builds anything against it**
  (Status section) — scoped specifically to confirming Decision 1's
  allow-list stays fixed, Decision 3's bucketing genuinely closes
  re-identification the same way ADR-0016's addendum already verified
  once, any new Postgres role's grants (if added) are correctly scoped,
  and Decision 7's no-new-consent-copy conclusion still holds against the
  metric list as actually implemented, not just as drafted here.
