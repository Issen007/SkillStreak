# 0022 - Admin control center: authentication, usage-metrics web view, error/crash visibility, and user-submitted bug reports

## Status

Proposed — 2026-08-02. **Blocking security-reviewer pass required before
backend-developer builds anything against this — full weight, the same
category as ADR-0010/0018/0019, not ADR-0020's lighter "scoped" gate.**
Argued, not asserted: this is the first ADR in this app's history to
introduce (a) an authenticated, browsable, non-player-facing web surface
with its own login, (b) a second, independent credential/session universe
alongside the player JWT, and (c) four genuinely new data-exposure
surfaces at once (an on-demand statistics view, a queryable error log, a
per-incident bug-report queue carrying a real child's screen name/team,
and — added mid-review, Decision 10 — an internal planning/security-issues
triage view). ADR-0020 earned a scoped review specifically because it
added "no media, no new consent gate, no cross-team visibility path,
and... no new UI or player/coach-facing surface at all." None of those
exclusions hold here — this ADR is the thing ADR-0020 was explicitly
*not*, and gets the corresponding weight.

**Extended mid-review, 2026-08-02, same day**: the project owner added a
fourth requirement after the rest of this ADR was already drafted — "a
full list of issues, ideas, security issues and roadmap in this... site."
Decision 10 covers it. It is **not** a lighter addition than the rest of
this ADR — argued in Decision 10, this fourth pillar's content (unfixed
security-gap descriptions, business/monetization planning prose) has a
*materially higher* blast radius than the other three if the single admin
credential is ever compromised, and gets its own additional control
(fresh-reauthentication, not just a valid session) on top of everything
Decisions 1-9 already specify. The blocking security-reviewer scope now
explicitly includes Decision 10's reauth mechanism and its
out-of-band content-sync design, not just Decisions 1-9's.

## Context

The project owner, verbatim: *"Now let's build our backend control center
so we can see how many users, teams and see our users behavior, see
issues and much more so we can get static of all our data. But also see
patterns how people are using our app. I want to also to have static so we
can in the future sale our Personal Traning functions and coche
functions."*

Clarified directly, treated as firm scope for this ADR:

1. "User behavior/patterns" means **app-wide aggregate statistics only** —
   never a named team, never an individual player's activity. This is not
   a new granularity decision; it's ADR-0020 Decision 3's already-reviewed
   floor (app-wide or `'1-2'`/`'3-5'`/`'6+'` team-size-bucketed, with the
   2026-08-02 minimum-population-floor amendment), reused verbatim, not
   loosened. A team/player drill-down view is explicitly **not** wanted
   and not in scope — stated by the project owner directly, not inferred.
2. "See issues" means **both** application errors/failed jobs (this app
   has never had a durable, queryable record of these — see Decision 6)
   **and** user-submitted bug reports (`docs/BACKLOG.md`'s "In-app report a
   problem" entry, raised but never designed or built).
3. The Personal Training/coach monetization angle is **context for why
   this matters, not a feature to design now**. `docs/PROJECT.md`'s Fas 5
   item 2 (a PT/Tränare role) is flagged there as needing its own dedicated
   architect/security pass before design even starts, because it
   reintroduces adult-authority-over-children in a different shape than
   Phase 2's kapten pivot deliberately removed. This ADR builds a general
   statistics *platform*; it presupposes, designs toward, and builds
   **none** of the PT/coach feature itself. The metric list below (reused
   from ADR-0020) is generic app-health/engagement data, not anything
   scoped to a hypothetical PT product.

**What already exists, load-bearing:**

- **`docs/adr/0020-usage-analytics-product-metrics.md`** — designed and
  security-reviewed the same day as this ADR, but **not yet implemented**
  (`docs/ACTION_PLAN.md`'s Phase 5 section still shows backend-developer's
  step unchecked). It already did the hard work of defining *what* "usage
  patterns" safely means for this app: a fixed, allow-listed query set
  (adoption/consent funnel, streak histogram, activity recency,
  training-type mix, weekly-goal completion, VM-Guld pool growth, clip/chat
  volume, badge mix), self-hosted Postgres queries (never a third-party
  analytics SDK, never Redis), and the aggregate/bucketed-with-a-population-
  floor granularity ceiling this ADR's Decision 5 restates as a hard
  structural boundary rather than a preference. This ADR **extends** that
  ADR's Decision 5 (delivery mechanism) rather than superseding it — see
  Decision 4 — and touches none of ADR-0020's Decisions 1, 2, 3, 6, or 7,
  which stand exactly as written and are reused, not re-derived.
- **`docs/adr/0004-coach-auth-and-session-reissue.md`** — this app once
  designed real password-based adult login (Part 1) and a fully separate
  coach/player token universe (Part 2), before Phase 2's kapten pivot
  superseded both, never built. The *reason* they were superseded is
  load-bearing and re-examined explicitly in Decision 2 below: it was not
  "adult login is inherently unsafe here," it was "building a whole second
  authentication universe for a multi-coach *role* that Phase 2 decided
  shouldn't exist as a distinct account type is disproportionate." Part 3
  of that ADR (player `token_version` + session-reissue code) is unrelated
  to this ADR and untouched.
- **`docs/ACTION_PLAN.md`'s Phase 2 section** — records the pivot's actual
  reasoning: no adult-facing account system, because the coach-dashboard
  concept was about **a new class of adult standing authority over specific
  children's specific data** (rosters, challenge-authoring, triggering a
  specific kid's session reissue). Decision 2 states explicitly why this
  ADR's single-owner admin account is a different thing along the exact
  axis that mattered there, not a re-litigation of the pivot.
- **`site/`** — investigated directly, not assumed: it is a **purely
  static** nginx container (`site/nginx.conf`, `site/README.md`) serving
  the marketing page and the Expo web export as two vhosts, with **zero**
  server-side logic, zero session/cookie handling, and zero auth capability
  of any kind today. It cannot host a login flow or anything requiring
  server-side state — confirmed by reading its Dockerfile/nginx.conf, not
  guessed. Ruled out as a host for this feature (Decision 3).
- **`k8s/`** — one shared `Gateway` (`skillstreak-gateway`) with one HTTPS
  listener per public hostname, routing to the existing `api`/`site`
  Services via `HTTPRoute` `PathPrefix` matches. `api-route` already
  matches every path (`/`) on `api.skillstreak.xyz` to the `api` Service —
  adding a new path prefix under that same host requires **zero** new
  Gateway/HTTPRoute/Service/Deployment/TLS-SAN, only new application routes
  inside the existing NestJS app (Decision 3). Per `CLAUDE.md`'s
  environment-parity section, `prerelease` → the `ubuntu01` internal
  cluster has **no TLS at all**, plain HTTP on `192.168.55.x` — a real,
  concrete constraint this ADR's cookie design has to hold for (Decision
  3).
- **`docs/BACKLOG.md`'s "Admin control/monitoring Web UI" entry** — the
  bigger, three-part idea (live monitoring/stats/error visibility; social
  media campaign control; blog generation) this request is one piece of.
  Only the first piece is in scope here — Decision 1 states this
  explicitly. That entry's own 2026-08-02 update already named ADR-0020's
  query set as "a plausible future input to this item's own 'usage
  statistics' tile... not a replacement for designing it" — this ADR is
  that design.
- **`docs/BACKLOG.md`'s "In-app report a problem" entry** — reasoned that
  reports should go to a best-effort email "not a new in-app admin
  console, unless the volume/frequency turns out to justify one." **The
  project owner has now explicitly asked for a console, superseding that
  conclusion for this specific piece** — stated here explicitly, not
  silently contradicted. The entry's own open questions (what gets
  auto-captured; freeform text or not; manual button vs. automatic crash
  capture; where reports go) are answered in Decision 7.
- **`backend/src/common/errors/http-exception.filter.ts`** — read directly:
  this app already has a single global `AppExceptionFilter`, and it
  **already logs unexpected (non-`HttpException`) errors** via NestJS's
  `Logger` today — but only to stdout, only for genuinely unhandled
  exceptions (every expected `AppException`/`HttpException`, i.e. the vast
  majority of 4xx domain errors, is never logged at all), and nothing
  persists it anywhere durable or queryable. This is the real, if partial,
  "structured error logging already happening" the task asks about — a
  smaller gap to close than building error logging from nothing, but a
  real gap (ephemeral, incomplete, unqueryable) all the same (Decision 6).

## Decision — 1: scope boundary — three data sources, explicitly not a fourth

This ADR builds exactly three things, matching the project owner's own
"how many users/teams... behavior... issues" framing:

1. **Usage/product statistics** — an on-demand web view of ADR-0020's
   already-approved metric list (Decision 4).
2. **Application error/crash and failed-job visibility** — a new, durable,
   queryable record this app has never had (Decision 6).
3. **User-submitted bug reports** — a new feature end to end, mobile
   submission through to an admin queue (Decision 7).

**Explicitly excluded from this ADR, named so it isn't silently assumed
later:**

- **Infrastructure/cluster health** (pod restarts, crash-loops, node
  resource pressure). `docs/BACKLOG.md`'s own entry names this as "a real
  infra question first: a Grafana/Prometheus-style dashboard reading the
  existing k8s cluster... vs. a bespoke app-level UI reading this app's own
  Postgres/Redis" — a materially different, bigger tool (a real
  metrics/observability stack, or at minimum a new Kubernetes-API read
  capability with its own RBAC) than anything else in this ADR, and this
  app doesn't have the operational load to justify standing one up yet
  (CLAUDE.md's "don't design for load or scale the project doesn't have").
  The project owner already has direct `kubectl`/Postgres access today
  (the same residual ADR-0020 Decision 3 already names) — `kubectl get
  pods` covers this gap adequately at current beta scale. A future,
  separate ADR if/when this app's operational surface actually grows past
  what raw `kubectl` comfortably covers.
- **Social media campaign control and blog generation** — the other two
  pieces of `docs/BACKLOG.md`'s bigger "Admin control/monitoring Web UI"
  idea. Different domains entirely (marketing/growth tooling;
  LLM-backed content generation), no child-data surface, and not asked for
  in this request. Not designed, not precluded.
- **The Personal Training/coach feature itself** — per the clarification
  above. Nothing in this ADR's data model, endpoints, or UI is PT-specific.
- **Any per-team or per-player drill-down**, anywhere in the
  usage-statistics pipeline specifically — the aggregate floor from
  ADR-0020 Decision 3 is a hard ceiling for that pipeline, enforced
  structurally, not just by convention (Decision 5).

## Decision — 2: admin authentication — a single, project-owner-only credential, password-based, its own JWT secret, session via httpOnly cookie

**Mechanism**: password login against one hardcoded identity, no
`AdminUser` database table, no self-service signup, no multi-admin/role
system — the stated scale is exactly one operator, and building anything
beyond that would be the same disproportionate-for-the-actual-need mistake
ADR-0004 Part 1/2 were retired for, just inverted (under-scaling a
system nobody needs the extra structure for, this time by *not* adding a
table rather than by adding one).

- **Credential storage**: two new keys in the existing `skillstreak-secret`
  (`k8s/secret.yaml.example`'s established `stringData` pattern, one
  GitHub Actions secret per key, never hardcoded): `ADMIN_USERNAME` and
  `ADMIN_PASSWORD_HASH` (a bcrypt hash — bcrypt is a **new** `backend/`
  dependency, exactly as ADR-0004 Part 1 flagged it would be, small and
  standard). No `password_reset_token`/email-reset flow: the only person
  who could ever need to reset this credential already has direct
  read/write access to the Kubernetes `Secret` itself (the same person who
  applies migrations and runs `kubectl` today) — rotating the value
  directly is the recovery path, identical in kind to how `JWT_SECRET`/
  `PII_ENCRYPTION_KEY` are already rotated in this app, not a gap needing
  its own mailed-link mechanism the way a real multi-coach userbase would
  have needed one.
- **Login**: `POST /api/v1/admin/auth/login { username, password }` →
  bcrypt-compares against `ADMIN_PASSWORD_HASH`; **identical generic `401
  invalid_credentials`** on wrong username or wrong password (no
  enumeration tell — same posture ADR-0004 Part 1 specified). On success,
  signs a JWT with a **new, separate secret** `ADMIN_JWT_SECRET` (never
  `JWT_SECRET`, for the exact reason ADR-0004 Part 2 already established:
  a different signing secret means an admin token fails signature
  verification outright on any player-guarded route, and vice versa,
  before any claim is even inspected — a structural boundary, not a
  guard-code discipline someone has to remember to enforce).
- **Session delivery — a deliberate divergence from every existing token
  pattern in this app**: an **httpOnly, `SameSite=Strict` cookie**, not a
  bearer token returned in a JSON body. The player app's bearer-token-in-
  `SecureStore`/`localStorage` pattern exists because it's a native/Expo
  client with no ambient browser-cookie mechanism (and `site/README.md`
  already documents `localStorage`'s known web-only weakness as an
  accepted-for-a-low-value-demo-session trade, not a pattern to reuse for a
  real operator credential). This admin surface is an ordinary browser
  page with a real operator's real credentials and **no legitimate reason
  for page JavaScript to ever read the session token** — an httpOnly
  cookie is immune to the dominant realistic threat (XSS token theft) in
  exactly the way a bearer token in `localStorage` is not. `SameSite=Strict`
  is the standard, adequate CSRF mitigation for a single-operator,
  low-traffic internal tool (the cookie is never attached to any
  cross-site request at all, including top-level navigations) — no
  separate CSRF-token scheme is needed at this scale. This is a genuinely
  new pattern for this codebase (no existing route uses cookie auth) —
  named explicitly for security-reviewer to double-check, not slipped in
  as if it were the established norm.
- **Lifetime**: short — recommend 24 hours (a working session, re-login
  the next day), shorter even than ADR-0004 Part 1's original 30-day coach
  recommendation, since this account gates operational visibility into a
  children's app and the operator doesn't need a long-lived session for
  infrequent use. `POST /api/v1/admin/auth/logout` clears the cookie. No
  refresh-token dance, no revocation list — if a session needs invalidating
  before expiry, rotating `ADMIN_JWT_SECRET` in the `Secret` invalidates
  every outstanding admin session at once, a blunt but sufficient tool for
  a single-session account (the same "boring and correct beats
  stateless-but-unrevocable at this scale" call ADR-0004 Part 3 already
  made for players).
- **Brute-force defense**: reuse the existing `@Throttle`/Redis-backed
  throttler pattern already on `ConsentController`/onboarding — a per-IP
  rate limit on the login route (e.g. 10/hour), the one credential in this
  entire ADR whose compromise would expose everything else it protects.
- **`AdminAuthGuard`** — a new, small, single-purpose guard (structurally
  parallel to, but not sharing code with, `JwtAuthGuard`): verifies the
  cookie's signature against `ADMIN_JWT_SECRET` and expiry only. No
  per-request DB lookup is needed (unlike `JwtAuthGuard`'s `token_version`
  check) — there is exactly one admin identity, nothing to look up.

**Why this doesn't reopen the risk category Phase 2's pivot removed —
argued, not assumed:** the pivot's actual objection was to a **new class
of adult standing authority over specific children's specific data/
accounts** that could grow (invite more coaches, grant them more teams) —
a first-class, extensible authority-over-children feature. This admin
account is different along the exact axis that mattered:

1. **No new person gets any access they don't already have.** The
   project owner already holds unrestricted Postgres/`kubectl` credentials
   as an existing operational reality (the same residual ADR-0020 Decision
   3 names explicitly) — this ADR makes *existing* access more convenient
   and auditable (a real login instead of raw `psql`), it doesn't grant a
   new capability to a new party.
2. **It cannot grow into a second admin.** There is no `AdminUser` table,
   no invite flow, no role to extend — a single hardcoded credential is
   structurally incapable of scaling into the multi-coach shape the pivot
   was reacting to.
3. **The surface it gates is deliberately never a per-child drill-down**
   for the usage-statistics pipeline (Decision 5) — unlike the original
   coach dashboard, which was explicitly about one specific adult
   viewing/acting on one specific team's specific kids' rosters and
   challenges.
4. **The one place this ADR does show individual-child data — the
   bug-report queue — is reactive, not a standing surveillance
   capability**: it surfaces only what a specific child's account
   voluntarily submitted at that child's own initiative, to the same
   single operator who already runs this entire system, for the narrow
   purpose of fixing the thing that broke (Decision 7 argues this
   distinction in full). It is not a "browse any child's activity"
   capability the way the original coach roster/dashboard was.

## Decision — 3: where the admin surface lives — new routes on the existing `api` service, no new Kubernetes primitive, publicly reachable like the rest of the API

**Hosting**: new NestJS modules (`admin-auth/`, `admin/`) inside the
existing `backend/` application, serving both the JSON endpoints (under
e.g. `/api/v1/admin/*`) and a small static admin web page (e.g. served
under `/admin` via `ServeStaticModule` or an equivalent minimal
controller) from the **same** `api` Deployment/Service/HTTPRoute that
already terminates TLS for `api.skillstreak.xyz` and already matches every
path under that host. This needs **zero** new `Gateway`/`HTTPRoute`/
`Service`/`Deployment`/TLS-SAN — the same "no new Kubernetes primitive"
instinct ADR-0020 Decision 5 already applied to its own, much smaller
feature, extended here even though this feature, unlike that one, does
have a real UI.

**Alternatives considered and rejected**:

- **A new, separately deployed admin frontend** (its own Docker image,
  Service, subdomain, e.g. `admin.skillstreak.xyz`). Real separation-of-
  concerns benefit, but real new k8s surface (a new Deployment/Service/
  HTTPRoute/TLS listener) for a single-consumer internal tool at a project
  phase that should favor boring over impressive. A plausible, additive,
  non-blocking future split if the api pod's own scaling/release story
  ever needs to diverge from the admin UI's — not needed now.
- **Extending `site/`'s static nginx container with a third vhost.**
  Rejected: `site/` is deliberately zero-server-logic (confirmed directly,
  Context) — login/session handling needs a real backend, and adding
  reverse-proxy/auth logic to nginx would just reinvent what NestJS already
  does, with more moving parts, not fewer.

**Reachability — authenticated and public, not VPN/network-isolated —
argued explicitly, since this is an operational view into a children's
app's data:**

- This app's player-facing API is **already** public + authenticated
  (`api.skillstreak.xyz`, no VPN) for materially *more* sensitive data —
  real per-child streaks, chat, and presigned video access — gated by
  session auth and structural team-scoping (ADR-0010 Decision 2's own
  explicit conclusion: "a presigned URL's security comes entirely from its
  signature... not from whether the host is globally routable... real AWS
  S3 works the same way"). Requiring VPN-only access for this *less*
  sensitive admin surface (aggregate stats, redacted error logs, a
  scoped bug-report queue) while the *more* sensitive player API stays
  plain public-auth would be an inconsistent, disproportionate posture,
  not a coherent security improvement.
- Building real network isolation (a VPN gateway, `NetworkPolicy` source
  restrictions) is genuine new infra this app has zero precedent or
  tooling for today — a real cost against "boring, don't build for scale
  this project doesn't have."
- The residual risk is already bounded at the **data layer**, not the
  network layer, by Decisions 5/6/7 below (aggregate-only stats, redacted
  error rows with no player/team FK, an explicit capture allow-list for bug
  reports) — the same "defend by not collecting/exposing the sensitive
  shape in the first place" instinct this app already applies elsewhere
  (e.g. ADR-0010's structural team-scoping, not network isolation, is what
  actually protects a clip).
- **A cheap, optional hardening left for later, not required for v1**: an
  IP allowlist on this path (a Gateway API filter or equivalent), if the
  project owner ever wants it — the same "reasonable follow-up, not
  blocking" framing ADR-0020 Decision 5 already used for a least-privilege
  Postgres role.

**Environment-parity gotcha, caught explicitly rather than assumed away**:
per `CLAUDE.md`'s environment-parity section, the `prerelease` → `ubuntu01`
internal cluster has **no TLS at all** — a `Secure`-flagged cookie would
silently never be sent by the browser over that cluster's plain-HTTP
LAN endpoint, breaking admin login entirely in one of this app's two real
environments. Fix: **`ADMIN_COOKIE_SECURE`, a new boolean config value read
at runtime via the existing `ConfigService`** (default `true`), set per-
cluster's own `ConfigMap` exactly the way every other environment-specific
backend value already differs today (`JWT_SECRET`, `CORS_ORIGIN`, etc.) —
production's `ConfigMap` leaves it `true` (real TLS exists); `ubuntu01`'s
own `ConfigMap` sets it `false`. This is **not** a new mechanism — it's the
existing runtime-Secret/ConfigMap-per-cluster convention CLAUDE.md already
documents for backend config, deliberately **not** the `site`/`mobile`
build-time-bake-per-environment scheme (that scheme exists specifically
because Metro's web export hardcodes absolute URLs into static files
before nginx ever serves them — a constraint that doesn't apply to a
NestJS process reading `process.env` at request time). No `Domain`
attribute is set on the cookie (defaults to the exact host that served
it), so `api.skillstreak.xyz` vs. `192.168.55.71` need no per-environment
handling at all beyond the `Secure` flag. **Also for free**: because the
admin page fetches its own API from the same origin it's served from
(`https://api.skillstreak.xyz/admin` calling `https://api.skillstreak.xyz/
api/v1/admin/...`, relative paths, no CORS), there is no absolute-URL-
baked-at-build-time problem for this feature at all — unlike `site/`'s
`EXPO_PUBLIC_API_URL`/`TRY_IT_URL` build-args, which exist only because the
Expo web export is served from a *different* origin than the API.

## Decision — 4: usage statistics — reuse ADR-0020's query set behind a new authenticated endpoint; extend ADR-0020 Decision 5, don't duplicate its logic

**This ADR extends ADR-0020 Decision 5 (delivery mechanism), not just adds
a new consumer of it silently, and not a redesign of ADR-0020's other six
Decisions.** Decision 5's "no new endpoint, no new admin-authentication
system" conclusion was explicitly conditioned on the premise that building
admin auth "solely to gate a single-consumer, low-frequency report" would
be disproportionate. That premise no longer holds: admin auth is being
built anyway, for this ADR's own, independently justified reasons — once
it exists, exposing the same already-approved query set behind it on
demand is close to free, and *not* doing so would be a real waste of the
work this ADR is already doing.

- **Both the scheduled email job and the new web endpoint call the same
  `UsageMetricsService`** — plain, injectable methods, one per Decision 1
  metric in ADR-0020, returning typed aggregate results (histograms,
  percentages, bucketed values with the population floor already applied).
  Since ADR-0020's `usage-metrics/` module hasn't been built yet
  (confirmed, Context), this is a net-new instruction to backend-developer
  — structure it this way from the start, not a refactor of shipped code.
  The scheduled job (unchanged cadence/recipient/email content, per
  ADR-0020 Decision 5/6) calls these methods and emails the result; a new
  `GET /api/v1/admin/usage-metrics` (behind `AdminAuthGuard`) calls the
  same methods synchronously per request and returns the JSON for the
  admin page to render. **No duplicated query logic, no second way to
  compute the same number** — the exact failure mode the task asked to
  avoid.
- **No new table, no persisted snapshot history** — matches ADR-0020
  Decision 6's own default (recompute fresh each call/run). If real
  time-series charts in the web view ever become valuable, a
  `UsageMetricsSnapshot` table is the same small, additive, reviewable
  follow-up ADR-0020 already flagged, not built here on spec.
- **Both the email and the web view continue to exist — the email is not
  superseded.** The monthly email is a passive push the owner receives
  without needing to remember to check anything (and doubles as a
  low-cost historical trail per ADR-0020 Decision 6); the web view is an
  on-demand pull for exploring current numbers whenever, and is also the
  only place the other two data sources (errors, bug reports) surface at
  all. Recommend **not** extending the email to also carry error/bug-report
  volume in v1 — a real-time "email me every exception" pattern would be
  noisy at low operational value; the web console is precisely the place
  to check "is anything wrong," not something that should push every
  occurrence. A future low-frequency digest line ("N new errors, N new bug
  reports this week," added to the existing monthly email) is a plausible,
  small, additive follow-up, not required now.

## Decision — 5: structural enforcement of the aggregate-only floor — no team/player identifier exists anywhere in this pipeline's types, not just absent from the UI

This is more important here than it was for ADR-0020's email, because a
live, browsable, filterable web endpoint is a fundamentally different
exposure than a static monthly email nobody can interactively query.

- **`UsageMetricsService`'s method signatures take no `teamId`/`playerId`
  parameter, anywhere, and its return types have no `teamId`/`playerId`/
  `screenName` field, anywhere** — not because the UI doesn't currently
  wire up a filter control, but because the type signatures themselves have
  no such shape to wire a filter control *to*. Team-size-bucketed metrics
  return only the bucket label (`'1-2'`/`'3-5'`/`'6+'`) and the
  floor-checked aggregate value, reusing ADR-0020 Decision 3's bucketing/
  floor logic verbatim — the underlying queries never select or group by a
  specific team's identity in the first place, so there is nothing to leak
  even under a bug.
- **`GET /api/v1/admin/usage-metrics` accepts no query parameters that
  identify a team or player.** The app's existing global `ValidationPipe`
  (`whitelist: true, forbidNonWhitelisted: true`, already configured in
  `main.ts`) rejects any unlisted parameter outright rather than silently
  ignoring it — a real, already-in-place backstop, not just a documented
  intention, if a future contributor ever tries to add one without
  updating the DTO first.
- **A future per-team or per-player breakdown cannot happen as a silent
  side effect of this ADR's design.** It would require writing a brand-new
  query (none of ADR-0020's existing queries select or group by a specific
  team's identity — they only bucket) and adding new response fields —
  both visible, reviewable changes to this exact module, not something
  that falls out of wiring up a UI filter button. This is the concrete
  "how does the design prevent this from growing without a new ADR"
  answer the task asked for.
- **The bug-report queue (Decision 7) is a deliberately separate module,
  table, and endpoint from `UsageMetricsService`, and must stay that way.**
  It legitimately carries a `playerId`/screen name — a different, bounded
  exception argued in Decision 7 — but that identity must never be joined
  into or aggregated alongside the usage-metrics pipeline (e.g., no future
  "bug reports per player" or "bug reports per team" view built on top of
  it). Flagged explicitly as an anti-pattern to avoid, since it would
  reintroduce a per-player/per-team breakdown through a different table
  without ever touching `UsageMetricsService` or this Decision's own
  guardrails.
- **`ErrorLogEntry` (Decision 6) has no `playerId`/`teamId` column at
  all** — the same structural exclusion, for the same reason, verified
  directly in that decision's schema rather than asserted here.

## Decision — 6: application error/crash and failed-job visibility — self-hosted, extending the existing exception filter, with an explicit redaction allow-list

Applying the identical self-hosted-vs-third-party framework
ADR-0010 Decision 1, ADR-0018 Decision 2, and ADR-0020 Decision 2 already
established for this project:

- **Third-party error tracking (Sentry SaaS, etc.)** — fast to integrate,
  mature UI, but a **new sub-processor relationship**: real stack traces
  and request context from a children's app, sent to an external company,
  for the first time in this app's history in this shape. The identical
  DPA/child-data-suitability/privacy-disclosure questions ADR-0010/0018/
  0020 already refused for video storage, AI tagging, and product
  analytics apply here with no meaningfully different justification. **Not
  recommended**, same reasoning, same "not decided silently" framing.
- **Self-hosting an open-source error-tracking platform (e.g. Sentry
  self-hosted)** — avoids the sub-processor problem, but trades it for a
  disproportionate **new operational surface**: Sentry's self-hosted stack
  is itself a small cluster (its own Postgres/Clickhouse/Kafka/Redis), wildly
  over-scaled for one operator's low-volume beta app. This is exactly the
  "don't design for load or scale the project doesn't have yet" mistake in
  the opposite direction from the third-party option — also **not
  recommended**.
- **Self-hosted, extending what this app already has — recommended.**
  `AppExceptionFilter` (`backend/src/common/errors/http-exception.filter.ts`)
  already runs on every request and already calls `Logger.error` for
  unhandled exceptions today; the only real gaps are (a) 4xx domain errors
  are never recorded at all, (b) even the 5xx case only reaches ephemeral
  stdout, with nothing durable or queryable, and (c) background job
  failures (the clip-retention sweep, account-erasure sweep, the future
  `usage-metrics` job) have no equivalent capture at all. Closing all three
  is additive to code that already exists, in the exact stack this app
  already runs, with no new service and no new package-manager convention
  — the same "zero new places the data goes" property ADR-0020 Decision 2
  already claimed for its own, structurally similar choice.

**Schema — a new `ErrorLogEntry` table, deliberately carrying no player or
team reference:**

```
ErrorLogEntry
  id            uuid, pk
  occurred_at   timestamptz, not null
  source        enum('http', 'job'), not null
  route         varchar, nullable   -- HTTP source only; the Nest ROUTE
                                     -- TEMPLATE (e.g. "/api/v1/consent/:token"),
                                     -- never the resolved literal path
  method        varchar, nullable   -- HTTP source only
  job_name      varchar, nullable   -- job source only
  status_code   integer, nullable   -- HTTP source only
  error_name    varchar, not null   -- exception class/name
  message       varchar(500), not null  -- truncated
  stack         text, nullable      -- truncated (e.g. first ~20 frames)
```

**Redaction allow-list — this is the load-bearing part, since error/crash
data has a real, different risk profile than ADR-0010/0018/0020's own
domains** (a video, a video's tag, or an aggregate count can't accidentally
narrate a specific child's private info the way a hand-written error
message or a logged request body can):

- **Never the literal, resolved request path — the route *template*
  only.** Several existing routes carry a live bearer secret as a path
  parameter (`GET/POST /api/v1/consent/:token`, account-erasure/profile
  confirm-cancel links) — logging `request.originalUrl` would durably
  persist a working consent/erasure/contact-change token into a table this
  admin console displays. Use Express's `request.route.path` (the
  registered pattern, e.g. `/api/v1/consent/:token`) instead — never the
  literal URL.
- **Never the request body, query string, or headers** (in particular,
  never `Authorization`) — no full-payload dump, ever. If a specific
  error's context is genuinely useful to capture beyond
  route/method/status, it must be added as an explicit, named,
  allow-listed field to this schema in a future, reviewed change — never a
  generic "attach the request" fallback.
- **A standing coding convention, not a runtime scrubber**: exception
  messages must never interpolate `PlayerPrivateInfo`-scoped values
  (`real_name`, `parent_contact`) or freeform user content (a chat message,
  a bug-report description) into their own text. A regex-based scrubber
  over arbitrary error text would be unreliable and give false confidence;
  the honest, already-established pattern this codebase uses for
  equivalent risks (e.g. "never add `consent_token`/`session_reissue_code`
  to a response DTO") is a documented invariant enforced by code review/
  code-critic, not a mechanical guarantee. Player/team **UUIDs** appearing
  in a message (e.g. "Player not found") are acceptable — they're already
  routinely present in this app's tokens/URLs and carry no human-readable
  identity on their own.
- **No `playerId`/`teamId` column exists on this table at all** — the same
  structural exclusion Decision 5 requires for the usage-metrics pipeline,
  applied here for the same reason: this table is about the *system*, not
  about any identifiable child, by construction, not by policy alone.
- **Erasure-exempt by construction**: since `ErrorLogEntry` never
  references a `Player`, it needs no entry in `docs/adr/0013-account-
  erasure.md`'s per-entity table at all — there is nothing to anonymize or
  cascade.

**Wiring**: `AppExceptionFilter` gains a call to a new
`ErrorLogService.record(...)` for every branch (not just the current
catch-all `Logger.error` branch) — 4xx `AppException`/`HttpException`
instances get a row too, since "which domain errors are actually
happening in practice" is real, useful operational signal this app has
never had. Each of the existing `@Cron`-decorated jobs (clip-retention
sweep, account-erasure sweep, the future `usage-metrics` job) wraps its
body in a try/catch that calls the same service with `source: 'job'` on
failure, instead of letting a failure disappear into an unobserved
rejected promise.

**Retention**: a scheduled sweep (the same `@nestjs/schedule` pattern this
app already uses for clip retention/account erasure) deletes rows older
than a config-value cutoff (recommend 90 days) — bounded table growth,
consistent with this app's existing retention posture elsewhere, and no
legitimate reason to keep low-value operational debugging data
indefinitely.

**Surfacing**: `GET /api/v1/admin/errors` (behind `AdminAuthGuard`),
paginated, filterable by `source`/`status_code` range/date — never by
anything that could resolve to a child, because nothing in this table can.

## Decision — 7: user-submitted bug reports — a new entity, a player-authenticated submission endpoint, a fixed capture allow-list, and an admin triage queue

**A new `BugReport` entity, distinct from this app's two existing "report"
mechanisms** (`ClipReport`/`TeamChatMessageReport`, both peer
content-moderation reports routed to another family) — this is a
**technical** bug report, authored by whoever hit the problem, routed to
the developer, never to a peer. Doesn't reuse either existing entity, per
`docs/BACKLOG.md`'s own instinct, though it borrows structural patterns
(rate-limiting, fixed-vocabulary category over pure freeform).

```
BugReport
  id            uuid, pk
  player_id     uuid, not null, FK -> Player, ON DELETE CASCADE
  category      enum('crash','login_issue','missing_or_wrong_data',
                      'upload_failed','other'), not null
  description   varchar(500), nullable  -- freeform, capped, HTML-escaped
                                          -- on render (reuses the existing
                                          -- html-escape.util.ts convention)
  app_version   varchar, not null
  platform      enum('ios','android','web'), not null
  os_version    varchar, nullable
  screen        varchar, nullable   -- a fixed, allow-listed screen
                                      -- identifier from the app's own
                                      -- navigation, never freeform
  locale        enum, reusing PlayerLocale (ADR-0014)
  status        enum('open','triaged','closed'), not null, default 'open'
  created_at    timestamptz, not null
```

**Auto-captured diagnostic allow-list, answering `docs/BACKLOG.md`'s open
question explicitly**: app version, platform, OS version, current screen
identifier, locale, timestamp — **never** device geolocation (CLAUDE.md's
non-negotiable), never a device identifier/advertising ID, never an IP
address, never an automatically-attached "recent action trail" (flagged as
a plausible, small, additive future enhancement if triage turns out to
need it — not built now, the same "smallest useful thing" instinct this
codebase applies elsewhere). A capped, optional freeform `description`
field is included (`docs/BACKLOG.md` explicitly left this open) — a
technical bug description a 9-13-year-old writes in their own words is
materially more useful than a category enum alone, and since it's routed
only to the developer, not displayed to any peer, ADR-0007's peer-facing
chat-moderation filter doesn't apply the same way; it still gets
HTML-escaped before ever being rendered in the admin queue, to prevent
stored XSS in a surface that has never needed that discipline before.

**Submission**: `POST /api/v1/bug-reports`, behind the existing
`JwtAuthGuard` (an ordinary authenticated player action, reusing
`CurrentPlayerId` exactly like every other player-scoped write in this
app) — no new auth mechanism. Rate-limited (reuse the existing
`@Throttle`/Redis-cooldown pattern, e.g. a per-player daily cap) since it's
authenticated, not the open-to-abuse unauthenticated shape ADR-0004's
2026-07-27 addendum had to defend against.

**Why this doesn't violate Decision 5's aggregate-only floor — a
deliberate, bounded, different kind of exposure, not a loophole**: a bug
report is a **voluntary, single-incident, self-initiated** submission by
the specific child it's about, structurally closer to a `ClipReport`
(which also legitimately carries a reporter's identity to enable
follow-up) than to a passive behavioral trail. Decision 5's aggregate/
never-individual floor exists specifically to prevent this admin surface
from becoming a **standing, repeatable capability to look up any
arbitrary child's ongoing behavior** — a bug report is the opposite shape:
it exists only because, and only for as long as, that one child chose to
tell the developer about one specific problem. This distinction is stated
explicitly here because a future contributor could otherwise read Decision
5 and mistakenly conclude `BugReport` needs anonymizing too, which would
defeat its actual purpose (the project owner needs to know which
team/device/app-version had the problem to reproduce and fix it).

**Erasure**: `player_id` is `ON DELETE CASCADE`, mirroring
`ClipReport.reporter_player_id`'s existing, already-established treatment
in `docs/adr/0013-account-erasure.md`'s per-entity table ("their own filed
report — their own action, fine to remove with the rest of their
content") — no new erasure-cascade design needed, direct reuse of an
existing precedent.

**Triage/surfacing**: `GET /api/v1/admin/bug-reports` (paginated, filter by
`status`) and `PATCH /api/v1/admin/bug-reports/:id` (updates `status`
only — `open` → `triaged` → `closed`, no freeform admin-notes field in
v1). This satisfies `docs/BACKLOG.md`'s own "even a lightweight [triage
step]... would satisfy the 'fast' part without building real ticketing
infrastructure" conclusion directly — a status field and a filterable list
is the queue, not a new ticketing system.

## Decision — 8: consent/disclosure — differs by data source, argued per source rather than blanket

Same question ADR-0018 Decision 3 and ADR-0020 Decision 7 already asked for
their own features, answered separately for each of this ADR's three data
sources:

- **Usage statistics: no new consent gate or copy, unchanged from ADR-0020
  Decision 7.** The data shown is identical in shape and granularity to
  what that ADR already cleared — this ADR only adds a second way to view
  the same already-approved numbers (on demand vs. emailed), not a new
  kind of processing.
- **Error/crash logging: no new consent gate or copy, conditioned
  explicitly on Decision 6's redaction allow-list holding** — the same
  conditional-not-blanket framing ADR-0020 Decision 7 used for its own
  aggregate conclusion. `ErrorLogEntry` is designed to carry no
  player/team identifier and no request-body/PII content at all
  (route template + status + generic error text + stack) — it's
  operational metadata about the *system*, not "about" any identifiable
  child, the same reasoning ADR-0020 Decision 7 already applied to a
  structurally similar low-risk shape. If a future change ever lets an
  error message or stack frame carry a real name, parent contact, or
  freeform user content, this conclusion needs revisiting, not assuming.
- **Bug reports: yes, a disclosure-copy addition, not a new consent
  gate** — the same shape ADR-0018 Decision 3 needed for AI tagging
  ("introduced a new kind of processing of a specific child's specific
  [content]... informed-consent principles favor naming that, even where a
  new consent gate wasn't required"). A bug report is a genuinely new
  *purpose* of processing a specific child's device/app-usage diagnostic
  data plus whatever they choose to type, routed to the developer — not
  something a parent approving "training log + team chat + clips" would
  already know exists. **Recommend a short addition to
  `backend/src/consent/consent-page.templates.ts`'s existing copy**
  disclosing that the app includes an in-app "report a problem" feature
  that sends the child's screen name/team, device/app info, and whatever
  they choose to type, to the developer for fixing bugs. Not a new gate —
  a parent who already approved the app can reasonably expect a basic
  support/bug-report feature to exist without a separate toggle, mirroring
  ADR-0018 Decision 3's exact "disclosure, not a new gate" precedent.

## Decision — 9: relationship to `docs/BACKLOG.md`'s two entries — one superseded conclusion, one scoped-down bigger idea

- **"In-app report a problem"'s "email... not a new in-app admin console"
  conclusion is explicitly superseded by this ADR, for the bug-report
  piece specifically** — the project owner has now directly asked for a
  console, which is the exact condition that entry's own text named as
  the thing that would change its answer ("unless the volume/frequency
  turns out to justify one"). Stated explicitly per the task's own
  instruction not to silently contradict prior reasoning.
- **"Admin control/monitoring Web UI" is a bigger, three-part idea; this
  ADR builds exactly one of the three pieces** (monitoring/stats/error
  visibility), per Decision 1. Social media campaign control and blog
  generation remain undesigned, unbuilt, and unaffected by this ADR — a
  future contributor picking either of those up should not assume this ADR
  says anything about them.

## Decision — 10: a fourth pillar, added mid-review — internal planning/security-issues triage view, with its own reachability, content-sync, and scope answers, not a copy of Decisions 3/5's

The project owner, mid-review, verbatim: *"I do also want to have a full
list off issues, ideas, security issues and roadmap in this OBS site so we
can start generate faster and developer faster new functions."* This is a
fourth, genuinely different kind of content from Decisions 4/6/7's three
pillars, and gets its own reasoning rather than inheriting theirs by
default.

### What exists today, checked directly rather than assumed

- **`docs/ACTION_PLAN.md`** — the live English phase checklist. **Tracked
  in git today** (`git ls-files` confirms it), despite being listed in
  `.gitignore` — it was already tracked before that `.gitignore` line was
  added, and Git doesn't retroactively stop tracking an already-tracked
  file just because a later `.gitignore` rule matches it. Its `- [ ]`/
  `- [x]` checklist format is consistent and mechanical throughout every
  phase.
- **`docs/BACKLOG.md`/`docs/PROJECT.md`** — confirmed via `git log
  --follow`/`git cat-file`: both **were** tracked and public for months,
  then deliberately **untracked** on 2026-07-26 (commit `c1b375d`, "Stop
  tracking business-sensitive planning docs"), specifically because this
  GitHub repo is public and these two files' *content* — not just their
  existence — is business-sensitive. That commit's own message is explicit
  that it doesn't (and can't) undo the already-public history, only stops
  *new* content from being tracked/pushed going forward. Both files still
  exist on disk, still actively edited (confirmed: `BugReport`-adjacent and
  other entries added well after that commit) — they're this project's
  real, current planning tool, just deliberately kept out of the public
  repo.
- **Read directly, not assumed**: both files do contain real, sensitive
  detail worth taking seriously — `docs/BACKLOG.md` includes prose
  discussion of a confirmed critical account-takeover finding's mechanics
  and this project's PT/coach monetization thinking; `docs/PROJECT.md`
  includes financial/business-plan sections. This is exactly the shape of
  content the coordinator flagged as a real, not hypothetical, concern.
- **Security findings today** are scattered prose across many tracked
  ADRs and `ACTION_PLAN.md`'s own unchecked items (e.g. ADR-0004's
  case-variant screen-name-duplicate limitation, `ACTION_PLAN.md`'s
  pre-beta-hardening unchecked CVE/TLS/JWT-revocation follow-ups) — there
  is no single consolidated list anywhere today, confirmed by reading
  rather than assumed.

### Scope — currently-open items only, hand-curated, never a raw-file render or an auto-extraction pipeline

The project owner's own stated goal — *"generate faster and developer
faster new functions"* — is a **triage/velocity** need (what's open and
ready to pick up right now), not an archival-browsing need. Two shapes
were weighed:

- **(A) Render the raw files verbatim** (or auto-parse arbitrary prose for
  "still open" items). Cheapest to build, but wrong on both scoping and
  risk: it would surface historical, already-resolved material (e.g. full
  narrative of a fixed vulnerability) nobody asked to browse, and any
  auto-extraction over freeform prose (as opposed to `ACTION_PLAN.md`'s
  mechanical `- [ ]` checkbox format) requires real judgment about what's
  actually still open vs. superseded/closed — judgment this codebase's own
  standing instinct (Decision 6's redaction reasoning; ADR-0020's
  "allow-list, not an open-ended capability") says shouldn't be delegated
  to a mechanical scraper. **Rejected**, the same way this ADR already
  rejected "easiest to build" defaults elsewhere.
- **(B) A small, hand-curated "currently open" extraction, kept
  up to date by whoever closes or opens an item — recommended.** Three
  content types, three different sourcing answers:
  - **Roadmap — `ACTION_PLAN.md`'s open items, parsed directly from the
    file already bundled in the deployed image.** This file is already
    tracked and public, already in the exact mechanical `- [ ]`/`- [x]`
    format this whole document already uses consistently — a simple parser
    over a fixed, consistent convention is not the same "delegate judgment
    to a scraper" risk (A) above describes; it's reading a checklist that
    already *is* the source of truth for "what's open," the same way a
    human reading it today would. No new sync mechanism, no new exposure
    (already public).
  - **Roadmap (business-prioritization slice) — a small, hand-curated
    "still open" subset of `docs/PROJECT.md`, never the whole file.**
  - **Ideas — a small, hand-curated "still open" subset of
    `docs/BACKLOG.md`**, i.e., entries with no "closed"/"superseded"/
    "built" update note already appended to them.
  - **Security issues — a new, small, hand-maintained list, compiled
    once now and kept current going forward, not an auto-extraction
    mechanism.** Per the task's own framing: the boring option (a plain
    structured list — source ADR/section, one-line summary, status) over
    building something to scrape ADRs/`ACTION_PLAN.md` for "still open"
    security language, which is exactly the freeform-judgment problem (A)
    already rejected, just for a higher-stakes content type. **Compiling
    this list's actual initial content accurately is real work, correctly
    a backend-developer/project-owner curation task at implementation
    time, not fabricated here from an incomplete pass** — this ADR
    specifies the list's *shape* and *handling*, not its contents.
  - This curated-subset approach has a real, named cost: someone has to
    prune closed items out over time, a small recurring maintenance task
    — stated explicitly rather than hidden, the trade for a meaningfully
    smaller and lower-risk exposed surface than rendering full files.

### Read-only for v1 — no write-back to any file from the web UI

*"Generate faster"* plausibly means either "let me read what's open
faster" (read-only) or "let me manage this from the web instead of editing
files by hand" (a real editing surface). **Recommend read-only.** The
markdown files stay the single source of truth, edited locally exactly as
today; the admin console only ever displays them. Building bidirectional
editing would mean either the web UI becomes a second, competing source of
truth (a real data-integrity problem — which copy wins if both are edited
around the same time) or every edit round-trips through a write-back-to-
file mechanism this app has no precedent for and nothing in the request
requires. If pure read-only turns out to be insufficient in practice, that
is a real, larger, separate follow-up decision — not built preemptively on
spec, the same posture this ADR already took for other "plausible later,
not now" items (Decision 4's digest email, Decision 3's IP allowlist).

### Content-sync mechanism — reuse the `k8s/secret.yaml` pattern, don't reverse the 2026-07-26 untracking decision

**A CI-built Docker image only ever contains what's in the tracked git
tree it was built from.** `ACTION_PLAN.md`'s open items need nothing new
(already tracked, already in the image). `docs/BACKLOG.md`/
`docs/PROJECT.md`'s curated subsets and the new security-issues list are
**not** in the tracked tree by deliberate, recent, correctly-reasoned
design — getting their content into a running pod needs an honest answer,
not an assumption either way:

- **(a) Stop gitignoring `BACKLOG.md`/`PROJECT.md` (or the new curated
  files) so CI can bundle them — rejected, explicitly, not for
  convenience.** This would directly reverse a deliberate decision made
  one week ago for a still-fully-valid reason: the repo is still public,
  and everything written into a tracked file from that commit forward
  would be immediately, permanently public — for the sake of admin-console
  convenience. This is exactly the "convenient but weakens an existing
  protection" move CLAUDE.md instructs pushing back on, not something to
  recommend because it's the easiest path to a working feature.
- **(b) Keep them local-only, and have the control center only ever show
  what's actually in the deployed image (`ACTION_PLAN.md` only), nothing
  from `BACKLOG.md`/`PROJECT.md`/the new security-issues list at all.**
  Safe, but fails the actual request outright — three of the four nouns
  in the project owner's ask ("ideas," "security issues," most of
  "roadmap") would simply never appear. Rejected as under-serving a clear,
  direct request when a real alternative exists.
- **(c) An out-of-band sync mechanism, applied by hand, never through the
  public CI/git pipeline — recommended, reusing an existing convention,
  not inventing a new one.** This project already solves the identical
  underlying problem — "sensitive, per-environment content that must never
  enter the public tracked tree, but a running pod still needs it" — for
  every credential in `k8s/secret.yaml`: a gitignored real file, a
  committed `.example` template, applied by hand
  (`kubectl apply -f k8s/secret.yaml`) independently on each cluster,
  never generated by the public CI pipeline from tracked source. Reuse
  this exactly: a new `ConfigMap` (not a `Secret` — this isn't a
  credential, but it is the same "real content, never in the public tree"
  shape), populated from the project owner's local curated files
  (`kubectl create configmap admin-planning-docs --from-file=... |
  kubectl apply -f -`, the standard idiom for refreshing a `ConfigMap`
  from a file) and mounted as a volume into the `api` Deployment,
  independently on each cluster — production and `ubuntu01` both, matching
  every other per-cluster config in this app. A new
  `k8s/admin-planning-configmap.yaml.example` template (mirroring
  `secret.yaml.example`'s exact existing pattern) documents the expected
  keys/filenames without ever containing real content. Refreshing it after
  a local edit is a small, manual, infrequent cost (the same cadence this
  app already accepts for `JWT_SECRET`/`PII_ENCRYPTION_KEY` rotation) —
  not real-time, deliberately, since planning docs don't change minute to
  minute.
- **The new security-issues list is treated identically to
  `BACKLOG.md`/`PROJECT.md`'s curated subsets — gitignored, ConfigMap-
  delivered, not tracked — even though every individual fact in it is
  already public somewhere in this repo's tracked ADRs/`ACTION_PLAN.md`.**
  This is a deliberate, argued choice, not an oversight: **compiling
  scattered facts into one convenient, curated "here is everything
  currently unfixed" index is itself a meaningful new risk, independent of
  whether any single fact in it was already discoverable** (the same
  "aggregation can create harm beyond its individual parts" reasoning this
  app already applies to why ADR-0020 bucket-suppresses small cohorts
  rather than trusting "well, the raw numbers are individually
  harmless"). Treating the compiled list with the same caution as
  genuinely-private source material, rather than treating it as safe
  because its ingredients are technically public, is the more defensible,
  consistent posture — not a double standard.

### Reachability — this pillar needs a real, additional control; Decision 3's "public + authenticated, no extra gate" conclusion does not transfer here unmodified

Decision 3 argued "public + authenticated, no VPN" because everything
behind that gate was low-sensitivity **by construction**: an aggregate
statistic (Decision 5's structural floor), a redacted error row (Decision
6's allow-list), a scoped, voluntary bug report (Decision 7). This
pillar's content — even scoped to "currently open" per the section above —
is a different shape entirely: curated business/monetization planning
prose and a curated list of exactly which security gaps are unfixed right
now and why. If the single admin credential is ever compromised, the
difference between "an attacker learns this week's weekly-goal completion
rate" and "an attacker gets a curated index of every currently-unpatched
gap plus a coach/PT monetization plan involving children's data" is not a
difference of degree — it's a different category of harm. **This is not
the same "the operator already has this access anyway" case Decision 2
made for admin auth itself**: Decision 2's argument was that the *human*
project owner already holds direct Postgres/`kubectl` credentials to the
exact data being exposed. Here, the actual risk is the *admin credential*
being compromised by someone who is **not** the project owner and does
**not** already have local filesystem/git access to these files — a
materially different threat model that Decision 2's reasoning doesn't
cover and shouldn't be stretched to cover.

**Decision: require a fresh re-authentication ("step-up auth"), not just
a valid session cookie, before this pillar's endpoints return any
content — in addition to, not instead of, everything Decisions 2/3
already specify.** Concretely: the admin JWT gains an `authenticatedAt`
claim (set at login, refreshed only by re-entering the password); the
three new endpoints below require `authenticatedAt` to be within a short
window (recommend 15 minutes) of the current request, else `401
reauth_required` — prompting the web UI to show an inline password
re-entry (calling the same `POST /api/v1/admin/auth/login`, which simply
refreshes `authenticatedAt` on the existing session rather than minting an
entirely new one). This is a standard, well-understood pattern (the same
"sudo mode"/step-up idea behind GitHub's/AWS's own sensitive-settings
re-auth prompts) — no new secret, no new guard class beyond one extra
claim check, no new infrastructure.

**Why step-up re-auth over promoting Decision 3's optional IP allowlist to
required — considered and rejected as the primary control, though it
remains available as optional extra hardening, unchanged from Decision
3:** an IP allowlist assumes stable, known source addresses. This project
owner's real usage pattern (checking the console from a rink on cellular
data, a laptop at home, elsewhere) makes a hard IP restriction brittle
enough to be a real, recurring operational cost, not a one-time setup —
the opposite of "boring." Step-up re-auth defends against the actual
realistic threat (a stolen/replayed session cookie — a device left
unlocked, a leaked token) from anywhere, at a fixed, small friction cost
paid only when this specific pillar is opened, not on every ordinary
login.

**Applied uniformly across all three new endpoints below, including the
already-public `ACTION_PLAN.md` slice of "roadmap," even though that slice
alone wouldn't strictly need it** — a deliberate simplification: splitting
the re-auth requirement at sub-tab granularity within one "roadmap" view
(some of it gated, some not) is real, avoidable implementation complexity
for negligible benefit, versus a few extra seconds of friction on an
already-infrequent action. The boring, uniform choice over a fragmented
one.

### New endpoints

```
GET /api/v1/admin/planning/roadmap
  -> ACTION_PLAN.md's open (- [ ]) items, parsed from the tracked file
     already in the image, merged with the curated open subset of
     PROJECT.md (read from the mounted ConfigMap volume) — presented
     together, sourced from two different trust levels, stated explicitly
     so a future contributor doesn't assume they're one homogeneous blob.
GET /api/v1/admin/planning/ideas
  -> the curated open subset of BACKLOG.md (ConfigMap volume).
GET /api/v1/admin/planning/security-issues
  -> the new hand-maintained security-issues list (ConfigMap volume).
```

All three: `AdminAuthGuard` + the new fresh-`authenticatedAt` check above.
None accept any query parameter, and none return anything shaped like a
per-player/per-team record — this pillar is internal planning prose, not
a new path into Decision 5's floor, and must stay that way.

### Consent/disclosure

None of this pillar's content is about any identifiable child at all — it
is this project's own internal roadmap/ideas/security-status prose. No
new consent-copy question arises, the same "not about a specific child"
reasoning Decision 8 already applied to `ErrorLogEntry`, applied here to
an even more clearly internal, non-child-data content type.

## Consequences

- **Schema**: two new tables (`ErrorLogEntry`, `BugReport`), no changes to
  any existing table. `BugReport.player_id` is `ON DELETE CASCADE`
  (reusing `ClipReport`'s existing erasure precedent); `ErrorLogEntry` has
  no player/team FK at all and needs no erasure-cascade entry. Decision
  10's planning/security-issues pillar adds **no schema at all** — it
  reads files, not Postgres rows.
- **New `backend/` dependency**: bcrypt (admin password hashing) — small,
  standard, the same dependency ADR-0004 Part 1 already flagged as needed
  for this exact purpose, never added until now.
- **New modules**: `admin-auth/` (login/logout/`AdminAuthGuard`), `admin/`
  (usage-metrics/errors/bug-report-queue endpoints + the served admin
  page), `usage-metrics/` (the `UsageMetricsService` this ADR requires
  ADR-0020's not-yet-built module to be structured around from the start),
  `error-log/` (or folded into `common/errors/`, backend-developer's
  call), and a `bug-reports/` module for the player-facing submission
  endpoint.
- **New config**: `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`/
  `ADMIN_JWT_SECRET` (new `Secret` entries, per-environment, never
  hardcoded), `ADMIN_COOKIE_SECURE` (new `ConfigMap` entry, `true` in
  production, `false` on the internal `ubuntu01` cluster per Decision 3's
  environment-parity fix), and (Decision 10) a new `admin-planning-docs`
  `ConfigMap` — populated by hand from the project owner's local, still-
  gitignored curated files, never generated by CI, applied independently
  on each cluster (`k8s/admin-planning-configmap.yaml.example` documents
  the expected keys, contains no real content, mirroring
  `secret.yaml.example`'s existing pattern).
- **No new Kubernetes primitive** — reuses the existing `api`
  Deployment/Service/HTTPRoute/TLS listener entirely (Decision 3).
- **No third-party sub-processor introduced anywhere** (Decisions 4 and 6)
  — no vendor DPA, no privacy-policy update for an external analytics or
  error-tracking platform, because there isn't one.
- **This ADR extends `docs/adr/0020-usage-analytics-product-metrics.md`
  Decision 5 only** (adds a second, on-demand delivery path behind the new
  admin auth this ADR builds) — Decisions 1, 2, 3, 6, and 7 of that ADR are
  unchanged and reused as written, not re-derived.
- **Left open, not decided here**: whether the admin web page's frontend
  is a bundled framework or plain static HTML/vanilla JS (recommend the
  latter, given the single-consumer/boring-option framing, but not
  architecturally binding — frontend-developer's call); whether a future
  low-frequency error/bug-report digest line gets added to ADR-0020's
  existing monthly email (Decision 4, plausible, not required); whether
  this admin surface is ever split into its own separately-deployed
  frontend (Decision 3, plausible, not required); an IP allowlist as
  additional hardening on the admin path (Decision 3, optional); the exact
  initial content of Decision 10's security-issues list (a real,
  non-trivial curation task at implementation time, not fabricated in this
  ADR); whether read-only planning views (Decision 10) ever need to become
  editable from the web UI (explicitly not built now, a real, separate,
  larger decision if it comes up).
- **Hand-off**:
  - **ux-designer**: the admin console's actual layout/visuals (the
    statistics dashboard's charts/tiles, the error-log list, the
    bug-report queue and its status-triage controls, the login screen, the
    new roadmap/ideas/security-issues tabs and the inline password
    re-entry prompt Decision 10's step-up auth needs), and the small
    player-facing "Report a problem" entry point/button and its minimal
    form (category picker + optional description) inside the mobile app —
    the one small player-facing surface this ADR has, unlike ADR-0020's
    zero. None of this is designed here.
  - **backend-developer**: the three original data pipelines
    (`UsageMetricsService` + its two consumers; `ErrorLogService` +
    `AppExceptionFilter`/job wrapper wiring + retention sweep; `BugReport`
    entity + submission/queue/triage endpoints), admin auth end to end
    (`admin-auth/` module, `AdminAuthGuard`, the cookie/config wiring
    including `ADMIN_COOKIE_SECURE`), the `consent-page.templates.ts` copy
    addition from Decision 8, and (Decision 10) the fresh-`authenticatedAt`
    step-up-auth check, the three new `planning/*` endpoints, the
    `ACTION_PLAN.md` checkbox parser, and the `admin-planning-docs`
    `ConfigMap`/volume-mount wiring plus its `.example` template.
  - **project owner**: curating the actual initial content of Decision
    10's three planning views (the open subsets of `BACKLOG.md`/
    `PROJECT.md`, and the new security-issues list) and refreshing the
    `admin-planning-docs` `ConfigMap` after local edits — not a developer
    task, since only the project owner has the local, gitignored source
    files.
  - **security-reviewer**: the full blocking pass named in Status —
    scoped specifically to confirming the admin-auth mechanism (cookie
    flags, CSRF posture, brute-force defenses, secret separation from
    `JWT_SECRET`), that Decision 5's structural floor genuinely holds in
    the real endpoint/DTO code (not just as designed here), that Decision
    6's redaction allow-list is followed everywhere an error can originate
    (in particular the route-template-not-literal-path point, and the
    consent/erasure/contact-change token-in-URL routes specifically), that
    `BugReport`'s capture allow-list matches this ADR exactly with no
    extra fields silently added, and (Decision 10) that the fresh-
    `authenticatedAt` window is actually enforced on all three
    `planning/*` endpoints with no bypass, and that the `admin-planning-
    docs` `ConfigMap`/its `.example` template never ends up containing (or
    the real one never gets accidentally committed as) real content in the
    tracked, public tree.
