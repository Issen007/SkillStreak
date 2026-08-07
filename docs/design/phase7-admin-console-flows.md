# Fas 7 Flows — Admin control center (web) + "Report a problem" (mobile)

Status: draft, ux-designer-owned, for **backend-developer** (who owns the
served admin page per ADR-0022 Decision 3/Consequences) and
**frontend-developer** (who owns the mobile screen) to build against.
Built directly against `docs/adr/0022-admin-control-center.md` — all ten
Decisions **as amended**, including the 2026-08-02 security-reviewer pass's
two applied fixes (Decision 7's full-field escaping, Decision 10's
disjoint-mount requirement) and the 2026-08-03 note that
`docs/adr/0023-pt-role-and-staff-sso-rbac.md` supersedes **Decision 2 only**.
There is no separate `docs/api/*-contract.md` for this feature; ADR-0022's
Decisions 4/6/7/10 are the API surface of record, the same way ADR-0013's
Decision 3 stood alone for `phase4.2-account-erasure-flows.md`.

Screen-ID scheme continues the existing O/H/K/CH/LB/G/V/E prefixes with two
new ones: **AD-** (admin console, web) and **BR-** (bug report, mobile).

Companion mockup: `docs/design/phase7-admin-console-mockup.html` — the
console shell + statistics dashboard (with a withheld bucket visible), the
bug-report triage two-pane, the step-up modal, and the mobile BR2 form.

## Scope — and what this is explicitly not

**Is:** seven surfaces. Six web (AD0 login, AD1 statistics, AD2 error log,
AD3 bug-report triage, AD4 planning tabs, AD5 step-up re-auth) and one
mobile (BR1–BR3, "Report a problem"). Wireframes, state tables, copy
tables, IA, accessibility, i18n keys.

**Is not:**

- **Not a design for anything ADR-0022 Decision 1 excluded** — no
  infra/cluster-health tiles (no pod restarts, no node pressure: that's
  `kubectl`'s job at this scale), no social-campaign or blog-generation
  surface, no PT/coach product surface.
- **Not user management.** One operator, one credential, no roles, no
  invites, no admin list, no per-admin audit attribution — Decision 2's
  explicit structural position, and ADR-0023's replacement of the *login
  mechanism* doesn't change the *console's* single-operator shape in Phase
  7. Anything in this doc that names an identity names exactly one.
- **Not a write surface for the planning pillar.** Decision 10 is read-only
  for v1. The only thing this entire console writes is a `BugReport.status`
  row (Decision 7's `PATCH`) — a database row, not a file. §7.4 keeps that
  distinction visible on screen, not just in this doc.
- **Not React Native / not HTML implementation.** Layouts, states, copy.
- **Not a per-child anything.** §12 lists the specific layouts this doc
  refused to draw, and why each would have been a design bug.

---

## 0. What ADR-0022 fixes vs. what this doc decides

**Fixed, not re-litigated here:**

- Auth is one username + one password → an httpOnly, `SameSite=Strict`,
  `Path=/api/v1/admin` cookie, 24h lifetime, generic `401
  invalid_credentials` on either wrong field, per-IP throttle on the login
  route (Decision 2). ADR-0023 will replace this with staff SSO — §3.5.
- The console is served from the existing `api` pod under `/admin`, same
  origin as the API it calls, no CORS, no new k8s primitive (Decision 3,
  reaffirmed unconditionally 2026-08-05 for these four pillars).
- Statistics are ADR-0020's fixed metric set, aggregate-only, with the
  minimum-population floor already applied server-side (Decisions 4/5).
  `backend/src/usage-metrics/` is already built; its
  `UsageMetricsReport` type is the ground truth for what AD1 can render.
- `ErrorLogEntry` carries route **template**, method, job name, status,
  error name, truncated message, truncated stack — and **no player/team
  column exists** (Decision 6).
- `BugReport` carries `player_id` + four enums (`category`, `platform`,
  `screen`, `locale`) + capped freeform `description` + `app_version`/
  `os_version` + `status`. Every rendered free-text field is HTML-escaped,
  not just `description` (Decision 7, as fixed).
- The three `planning/*` endpoints are read-only, take no query parameters,
  and require a fresh `authenticatedAt` within ~15 minutes on top of a
  valid session, else `401 reauth_required` (Decision 10).

**Decided here:** everything about what the operator actually sees — the
console's visual register (§1), its IA (§2), each surface's layout, states
and copy (§3–§9), how a *withheld* statistic reads on screen (§4.4, the
single most load-bearing piece of this doc), how a bug report's reporter
identity is shown without becoming a per-child drill-down (§6.3), and the
mobile form's field set, disclosure copy, and i18n keys (§9–§10).

---

## 1. Visual register — what this console reuses from `style-guide.md`, and what it deliberately doesn't

`docs/design/style-guide.md` states its own boundary in its Usage notes:
*"this is a phone screen used by 9-13 year-olds, often mid-training, not a
desktop dashboard."* The admin console is precisely the excluded case — one
adult operator, a desktop browser, dense tabular data, infrequent sessions.
Inheriting the kid-facing register by default would be the wrong reading of
that guide, not a faithful one. So:

| Style-guide element | Console treatment | Reasoning |
|---|---|---|
| `ink` `#1B1B3A`, `paper` `#FAFAF7`, `white`, `border` `#E3DED2`, `textMuted` `#6B6B85`, `error` `#C1432F`, `success` `#3DAA6B` | **Reused verbatim.** | These are neutral, contrast-checked, and carry no age-specific tone. Reusing them keeps one visual family across the product, which is worth something when the operator also looks at the app. |
| **Contrast rule**: `flame`/`gold` are fills, never text on light | **Reused verbatim, and it matters *more* here** — a dashboard is mostly small text. `goldText`/`flameText` used where a colored numeral is genuinely wanted. | Same WCAG AA reason; smaller type makes the failure worse, not better. |
| `flame` = "mine/individual", `gold` = "ours/team" | **Reused, but only where the semantics genuinely survive**: the individual-streak histogram's bars are `flame`; the VM-Guld pot histogram's bars are `gold`. Everything else gets a neutral chart ink. | The guide calls this "the one rule worth protecting as the app grows." It survives translation to a chart because the underlying meaning is identical. Using flame/gold decoratively on unrelated charts would break it. |
| **Baloo 2** headings | **Dropped except the wordmark.** Console headings use the same UI stack as body. | Baloo 2 is a rounded display face tuned for big playful headings; at a 13px table header it reads as a costume, not a brand. It also implies a webfont fetch — see next row. |
| **Nunito** body | **Dropped for a system stack** (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). | Two reasons, one of them not cosmetic: (a) an operator tool should render instantly with zero layout shift; (b) pulling Baloo 2/Nunito from Google Fonts would make the admin page issue a **request to a third party on every load** — this ADR's entire family of decisions (0010/0018/0020/0022) refuses new sub-processors for child-adjacent surfaces, and it would be odd to introduce one in the console's `<head>` for typography. Self-hosting the two families in the `api` image is possible but is real weight for no operator benefit. |
| Touch targets ≥44px, "keep copy short" | **Departed deliberately.** Controls are 32–36px tall, table rows ~34px, body 13–14px, and copy is allowed to be longer and more precise. | Mouse/keyboard pointer accuracy is not a nine-year-old's thumb mid-training. Density is a feature here: the whole point of the error log is scanning many rows. Where copy *does* run long (suppression notes, the planning pillar's read-only banner), precision beats brevity — the reader is the person who has to act on it. |
| Emoji-led headings, celebratory tone, `🔥`/`🥇` motifs | **Removed entirely.** No emoji anywhere in the console except (optionally) the environment badge. | Nothing in the console is a reward. A "🎉 12 new bug reports!" register would be actively misleading. |
| Rounded 16–22px card radii | **Tightened to 8–10px.** | Purely proportional: a 16px radius on a 34px-tall row looks like a pill. |
| Dark mode | **Not designed.** Light only. | One operator, one theme; the existing mockup files' dark-mode CSS is page *chrome* around the mockups, not a product requirement. Revisit if asked. |

**Two console-only tokens** (defined in the console's own stylesheet, **not**
added to `mobile/src/theme/colors.ts` — they have no mobile meaning):

```
--chart-neutral   #4C4A63   Default chart series ink (bars, axes labels).
                            Passes AA on white; distinct from `ink` so a
                            bar never looks like heading text.
--withheld        #9A97AC   The "withheld / not shown" state — greyed text
                            plus a 45° hatch fill. Never a zero bar, never
                            an empty cell. See §4.4.
```

---

## 2. Information architecture

```
https://api.skillstreak.xyz/admin          (production)
http://192.168.55.71:<port>/admin          (ubuntu01 internal test)

  ├─ AD0  Login                    unauthenticated
  └─ Console shell                 AdminAuthGuard
       header:  [SkillStreak Admin] [env badge] ......... [Sign out]
       nav (4): 1. Statistics            → AD1
                2. Errors                → AD2
                3. Bug reports  (N open) → AD3   list + detail, one pane pair
                4. Planning        🔒     → AD4   step-up gated (AD5)
                                            ├ Roadmap        (default)
                                            ├ Ideas
                                            └ Security issues
```

**Four nav items, one level deep, no sub-navigation except Planning's three
tabs.** The four pillars are ADR-0022's own four; adding a fifth "overview/
home" landing page would just be a menu in front of a menu for a
four-item app. **Statistics is the landing view** after login — it's the
thing the project owner asked for first, and it's the only pillar that is
never gated by anything beyond the ordinary session.

**Planning is last and visibly marked.** The 🔒 affordance on the nav item
is not decoration: it's the only advance warning that opening this pillar
will (sometimes) demand a password. Tooltip/`title`: *"Requires re-entering
your password."*

**Deep links.** Each pillar has its own URL fragment (`/admin#statistics`,
`#errors`, `#bug-reports`, `#planning/roadmap`) so a session-expiry
round-trip can return the operator exactly where they were (§3.4, §8.4). No
identifier ever appears in a fragment — `#bug-reports` never becomes
`#bug-reports/<uuid>`, because a URL is the one place a link gets copied,
pasted and mailed. Selected-report state lives in memory only.

**Standing copy rule — no configurable number is ever a literal in a
string.** Every copy table below interpolates any value that is a config
knob rather than a fact: `{min}` (`USAGE_REPORT_MIN_TEAMS_PER_BUCKET`,
§4.4), `{days}` (`USAGE_METRICS_WINDOW_DAYS`, §4.6), `{retentionDays}` (the
error-log cutoff — ADR-0022 Decision 6 says "a config-value cutoff
(recommend 90 days)", not 90 days, §5.5), `{maxFrames}` (the stack
truncation — the ADR says "e.g. first ~20 frames", §5.5). A hardcoded
number in operator-facing copy starts lying silently the day the config
changes, and there is no test that catches it. The only numbers written as
literals anywhere in this doc are schema constants (`varchar(500)` on
`BugReport.description`) and this console's own UI choices (§5.3's 7-day
default filter, §7.6's 30-day staleness threshold), both named as such.

**Environment badge.** A small chip in the header reading `PRODUCTION` (ink
fill) or `INTERNAL TEST` (muted fill). Argued, not cosmetic: `CLAUDE.md`'s
environment-parity section records a real 2026-07-30 incident where
production served an `internal-images`-built artifact for a stretch of
time, and the two clusters' consoles look otherwise identical. A console
that states which cluster it is makes that class of mistake visible in one
glance. **Flagged for backend-developer** — this needs a value to render
(§13).

---

## 3. AD0 — Login

**Trigger:** navigating to `/admin` without a valid session cookie; or the
console receiving `401` (not `reauth_required`) from any endpoint (§3.4).
**API:** `POST /api/v1/admin/auth/login { username, password }`.

### 3.1 Layout

```
                                        ┌ env badge ┐
┌───────────────────────────────────────────────────────────┐
│                                        [ PRODUCTION ]     │
│                                                           │
│                   SkillStreak Admin                       │
│                                                           │
│         ┌───────────────────────────────────────┐         │
│         │  Sign in                              │         │
│         │                                       │         │
│         │  ┌ session-expired notice, if any ──┐ │         │
│         │  │ Your session expired. Sign in to │ │         │
│         │  │ continue.                        │ │         │
│         │  └──────────────────────────────────┘ │         │
│         │                                       │         │
│         │  Username                             │         │
│         │  [___________________________]        │         │
│         │                                       │         │
│         │  Password                             │         │
│         │  [___________________________]        │         │
│         │                                       │         │
│         │  ┌ error, if any ──────────────────┐  │         │
│         │  │ ⚠ Wrong username or password.   │  │         │
│         │  └─────────────────────────────────┘  │         │
│         │                                       │         │
│         │  [        Sign in        ]            │         │
│         └───────────────────────────────────────┘         │
│                                                           │
│    Internal tool. Aggregate statistics only — no          │
│    per-player or per-team data is available here.         │
└───────────────────────────────────────────────────────────┘
```

The footer line is deliberate. It is the first thing anyone who reaches
this page sees, including someone who shouldn't have, and it states the
console's actual boundary rather than implying a richer prize behind the
form.

### 3.2 States

| State | Trigger | Screen |
|---|---|---|
| `idle` | first paint | Both fields empty, focus in Username, Sign in **disabled** until both fields are non-empty. |
| `expired-notice` | arrived via a `401` from an authenticated view | As `idle` plus the notice block; the intended destination is remembered in memory for post-login return. |
| `submitting` | Sign in pressed | Button shows a spinner + label "Signing in…", both fields `readonly` (not `disabled` — keeps them in the tab order and readable by AT), no error shown. |
| `bad-credential` | `401 invalid_credentials` | Generic error, **identical text for wrong username and wrong password** (Decision 2's non-enumerating posture). Password field cleared, username kept, focus moved to password. |
| `throttled` | `429` | Throttle error. Sign in stays disabled for the retry window if the response carries `Retry-After`; otherwise disabled for 60s with a generic message (§13 — flagged). |
| `offline / 5xx` | network error or `5xx` | Generic "Couldn't reach the server." error, Sign in re-enabled immediately, fields untouched. |
| `success` | `200` | Cookie set by the server; console navigates to the remembered destination, else `#statistics`. Nothing about the credential is retained in JS beyond the username string held in memory for §8's step-up prefill. |

### 3.3 Copy

| ID | English |
|---|---|
| `admin.login.appName` | SkillStreak Admin |
| `admin.login.cardTitle` | Sign in |
| `admin.login.username` | Username |
| `admin.login.password` | Password |
| `admin.login.submit` | Sign in |
| `admin.login.submitting` | Signing in… |
| `admin.login.expiredNotice` | Your session expired. Sign in to continue. |
| `admin.login.errorInvalid` | Wrong username or password. |
| `admin.login.errorThrottled` | Too many sign-in attempts. Wait a minute and try again. |
| `admin.login.errorNetwork` | Couldn't reach the server. Check your connection and try again. |
| `admin.login.footer` | Internal tool. Aggregate statistics only — no per-player or per-team data is available here. |

`admin.login.errorInvalid` is one string for both failure modes on purpose;
splitting it later would be a security regression, so it is written here as
a single ID rather than two that happen to have equal text.

### 3.4 The three "auth is wrong" cases, kept distinct

This console has three different auth failures and they must never be
collapsed into one handler:

| Server says | Meaning | UI |
|---|---|---|
| `401` (no/expired/invalid session cookie) | Not signed in at all | Whole console unmounts → AD0 with `expired-notice`, destination remembered. |
| `401 reauth_required` | Signed in, but `authenticatedAt` is stale and a `planning/*` endpoint was called | **Never** returns to AD0. AD5's inline modal, console state fully preserved (§8). |
| `401 invalid_credentials` **from AD5's own step-up call** | Signed in, wrong password entered at the step-up prompt | Error stays *inside* AD5. The existing session is untouched — the operator is not signed out for fat-fingering (§8.3). |

### 3.5 Designed so ADR-0023's SSO swap is a component swap, not a redesign

ADR-0023 replaces Decision 2's password with Google/Microsoft/Apple SSO and
a `StaffAccount` with `admin`/`pt` roles. That swap is a **separate,
already-queued design item**; this doc designs the password form as
specified. Four constraints keep the later swap cheap:

1. **The credential UI lives entirely inside the card's body slot.** The
   page chrome (wordmark, env badge, footer line) knows nothing about
   *how* someone signs in. Replacing the two fields + button with three
   provider buttons touches one block.
2. **No copy anywhere outside AD0 mentions a password** — except AD5,
   which is inherently about re-entering one and will be redesigned in the
   same pass. The console header says "Sign out", never "Change password".
3. **Identity is rendered as an opaque display string, never assumed to be
   a username.** SSO will bring an email address; the header's identity
   chip and AD5's prefill both treat it as "whatever the server calls this
   session's operator" (§13's recommended `GET /admin/auth/session`).
4. **A real `<form>` with `autocomplete="username"` /
   `autocomplete="current-password"`, submitted on Enter.** Password
   managers work, and the whole element is deletable in one piece. Do not
   build a bespoke keystroke-driven input.

---

## 4. AD1 — Statistics dashboard

**Trigger:** default view after sign-in; nav item 1.
**API:** `GET /api/v1/admin/usage-metrics` (`AdminAuthGuard`, no query
parameters — Decision 5). One call, recomputed server-side per request
(Decision 4: no snapshot table).

### 4.1 What the data actually is

Designed against `backend/src/usage-metrics/usage-metrics.types.ts`, which
is already built, not against invented numbers. The eight metrics and the
report meta (`generatedAt`, `windowStart`, `windowDays`,
`minTeamsPerBucket`) are the whole surface. Two structural notes that shape
the layout:

- **`UsageMetricsReport.totalTeams` must not reach the browser.** Its own
  docstring says it is "deliberately NOT rendered in the email: printing it
  next to each shown bucket's `teamCount` is precisely what would let a
  reader do the residual arithmetic the floor exists to prevent." A web
  view is a *stronger* version of that risk, not a weaker one. **Flagged
  for backend-developer (§13): omit the field from the response DTO, don't
  merely not render it** — same "structural, not by policy" standard
  Decision 5 holds itself to.
- **`foldedIntoAppWide` and `minTeamsPerBucket` must reach the browser.**
  Without them the UI cannot tell "this breakdown was withheld" from "there
  are no teams" — the exact confusion §4.4 exists to prevent, and the one
  thing this dashboard most has to get right.

### 4.2 Layout

```
┌ Statistics ───────────────────────────── generated 2026-08-07 06:12 ┐
│ Trailing 30 days · 2026-07-08 → 2026-08-07 · times in Europe/       │
│ Stockholm · recomputed on every load, nothing is stored             │
│                                                    [ Refresh ]      │
├─────────────────────────────────────────────────────────────────────┤
│  ┌ Players ──────┐ ┌ Trained, 7d ──┐ ┌ Trained, 30d ─┐ ┌ Active ──┐ │
│  │           142 │ │      58%      │ │      74%      │ │ pots  11 │ │
│  │ total accounts│ │  82 of 142    │ │  105 of 142   │ │          │ │
│  └───────────────┘ └───────────────┘ └───────────────┘ └──────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ 1 · Adoption & consent funnel                                       │
│   Parental consent      ▓▓▓▓▓▓▓▓▓▓▓▓░░░░▒▒▒░ 142                    │
│     approved 96 · pending 28 · not_requested 15 · revoked 3         │
│   Team join             ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░▒▒▒ 142                    │
│     approved 110 · pending 27 · rejected 5                          │
│   Logged ≥1 session ever            88 of 142 (62%)                 │
│                                                                     │
│   By team size (means across each bucket's teams)                   │
│   Only buckets that hold teams and clear the 5-team minimum are     │
│   listed.                                                           │
│   ┌─────────┬───────┬──────────┬──────────────┬──────────────────┐  │
│   │ Bucket  │ Teams │ Mean/team│ Mean consent │ Mean has trained │  │
│   ├─────────┼───────┼──────────┼──────────────┼──────────────────┤  │
│   │ 3–5     │     7 │      4.1 │          71% │              55% │  │
│   │ 6+      │     9 │      8.6 │          79% │              66% │  │
│   ├─────────┴───────┴──────────┴──────────────┴──────────────────┤  │
│   │ ▨ One or more team-size buckets are not shown.               │  │
│   └──────────────────────────────────────────────────────────────┘  │
│   ⓘ A bucket is withheld when it holds fewer than 5 teams, or when  │
│     showing it would let a withheld bucket be worked out by         │
│     subtraction. Those teams are still counted in the app-wide      │
│     figures above. Which bucket was withheld is not shown — an      │
│     unlisted bucket may equally well have held no teams. Means are  │
│     per team (each team counts once) — they do not add up to the    │
│     totals above.                                                   │
├─────────────────────────────────────────────────────────────────────┤
│ 2 · Individual streak health              (bars: flame)             │
│   Current streak                      Longest streak ever           │
│    0 ████████████ 41                    0 ████ 12                   │
│  1-3 ███████ 24                       1-3 ██████ 21                 │
│  4-7 █████ 18                         4-7 ████████ 27               │
│ 8-14 ████████ 27                     8-14 ███████████ 38            │
│15-30 ██████ 21                      15-30 ████ 15                   │
│  31+ ███ 11                           31+ ███ 9                     │
│   ⓘ Two separate histograms, not one comparison — "how many are on  │
│     a streak now" and "how far has anyone ever got" are different   │
│     questions.                                                      │
├─────────────────────────────────────────────────────────────────────┤
│ 3 · Training-type mix (30 days)                                     │
│   drill    ████████████████ 412 (44%)                               │
│   fitness  ██████████ 268 (29%)                                     │
│   running  ██████ 161 (17%)                                         │
│   other    ███ 92 (10%)                                             │
├─────────────────────────────────────────────────────────────────────┤
│ 4 · Weekly-goal engagement                                          │
│   Concluded in window 34 · met 19 (56%) · cancelled 6 (excluded)    │
│   By team size:  ▨ No team-size breakdown this period.              │
│   ⓘ "Met" = every eligible roster member individually reached the   │
│     target (ADR-0015), not a captain flipping a switch. Cancelled   │
│     goals are outside the rate, not counted as failures.            │
├─────────────────────────────────────────────────────────────────────┤
│ 5 · Team pool (VM-Guld) growth            (bars: gold)              │
│   Median 385 points/week across 11 active pots                      │
│        0 █ 1                                                        │
│     1-99 ███ 2                                                      │
│  100-499 ████████ 5                                                 │
│ 500-1499 ████ 2                                                     │
│    1500+ █ 1                                                        │
│   ⓘ Lifetime average since each season started, not points earned   │
│     inside this window — no points history is stored.               │
├─────────────────────────────────────────────────────────────────────┤
│ 6 · Social features — volume only                                   │
│   Clip uploads / week      Chat messages / week                     │
│   ▨ ██ ███ ████ ██ ▨       ▨ ███ ████ ████ █████ ▨                  │
│   (▨ = partial week)                                                │
│   ⓘ Counts only — never which clip, never who posted, never message │
│     content. Hatched bars cover only part of the window (the first  │
│     and last always do), so their lower counts are windowing, not a │
│     real dip.                                                       │
├─────────────────────────────────────────────────────────────────────┤
│ 7 · Badge mix (30 days)                                             │
│   streak_7        ████████████ 63                                   │
│   best_effort     ████████ 41                                       │
│   most_creative   █████ 27                                          │
│   goal_bonus      ███ 14                                            │
├─────────────────────────────────────────────────────────────────────┤
│ Every figure on this page is app-wide or team-size-bucketed. There  │
│ is no per-team or per-player view, here or anywhere in this         │
│ console's statistics. (ADR-0020 Decision 3 / ADR-0022 Decision 5)   │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 Chart inventory and the reasoning per encoding

Standard dataviz discipline applied deliberately, not by default: one
honest encoding per question, no encoding that implies precision the number
doesn't have, and a text/table alternative always present rather than
hidden behind a toggle.

| # | Metric | Encoding | Why this and not the obvious alternative |
|---|---|---|---|
| — | Players / 7d / 30d / active pots | **KPI tiles**, four across, big numeral + a plain "N of M" subline | The four numbers a glance should answer. Percentages always carry their fraction underneath — a bare "58%" over an unknown base is the classic dashboard lie. |
| 1 | Consent + join status | **Single horizontal 100% stacked bar per status field, plus an exact-count line beneath it** | Parts of one whole, 3–4 categories, order is meaningful (approved → pending → not_requested → revoked). Rejected: a **pie/donut** (angle is the worst encoding of proportion, and this needs side-by-side comparison of two fields). The count line under each bar *is* the accessible table — nothing is only in the graphic. |
| 1, 4 | Team-size breakdowns | **Data table**, not a chart | 2–3 rows of means. A three-bar chart of means, where some bars are missing for suppression reasons, would make the missing bars read as zero — precisely the failure §4.4 exists to prevent. A table has a cell you can put words in. |
| 2 | Streak histograms | **Two separate horizontal bar charts** (small multiples), shared bucket order, bars `flame` | Ordinal buckets with long labels → horizontal reads better. Rejected: **grouped bars** — it invites reading "current vs longest" as a paired comparison, which is wrong (the same player is in both, at different values, by construction). |
| 3 | Training-type mix | **Horizontal bars sorted descending**, count + % labelled directly on each bar | Nominal categories, one measure. Direct labelling removes the need for an axis entirely at this data size. |
| 5 | Pot growth | **Horizontal bars**, bars `gold`; median as a KPI above | Same shape as the streak histogram. Rejected: a **gauge/speedometer** for the median — gauges waste space and imply a target that doesn't exist. |
| 6 | Weekly clip/chat volume | **Column bars per ISO week**, partial weeks rendered with a 45° hatch fill **and** an explicit "(partial)" in the tooltip/table | Rejected: a **line chart**. A line implies a continuous quantity sampled at points; these are totals over discrete intervals, two of which cover fewer than seven days. A line would draw a smooth "drop" at both ends that is pure windowing. The hatch (a pattern, not just a lighter colour) means the distinction survives greyscale and colour-blindness. |
| 7 | Badge mix | **Horizontal bars sorted descending**, `badgeKey` labels | Same as #3. `badgeId` is shown only when `badgeKey` is `null` (the type allows it), in a muted monospace — a raw uuid is a fallback, not a label. |

Cross-cutting rules for every chart on this page:

- **No axis truncation.** Every bar chart starts at zero. There is no
  scenario in this data set where a truncated baseline is honest.
- **No dual axes**, ever. Clip uploads and chat messages are two charts
  side by side, not one chart with two scales.
- **No animation on load.** This is a tool, not a presentation.
- **No interactivity that changes what's shown** beyond §4.5's date-window
  note — specifically, **no clickable bars**. A clickable bar in a
  children's-app dashboard implies a drill-down, and there is none (§12).
- **Every chart's numbers are also present as text** in the same block
  (labels on bars, or the table beneath). The chart is the redundant
  representation, not the data of record.

### 4.4 Withheld team-size breakdowns — four states, designed against what the service actually returns

This is the part of the dashboard most likely to be got wrong, so it gets
its own state table — written against `UsageMetricsService`'s real output,
not against the ADR's prose.

**What the service actually hands the UI** (read directly from
`backend/src/usage-metrics/usage-metrics.service.ts:273-297, 350-362`):

- `byTeamSizeBucket` contains **only buckets that both hold at least one
  team and survived the floor.** A bucket with zero teams was never in the
  array to begin with — `buckets` is built by mapping over
  `teamIdsByBucket`, which only has entries for buckets that contain teams,
  and `applyFloor` then filters `teamCount > 0` again before applying the
  floor.
- `foldedIntoAppWide` is a **single report-wide boolean per metric**
  (`reported.length < nonEmpty.length`) — it means "at least one non-empty
  bucket was withheld", and nothing more. It is **not** per-bucket
  suppression information.
- `applyMinimumPopulationFloor` drops below-floor buckets **and**
  additionally drops the smallest surviving bucket when the residual would
  otherwise be derivable by subtraction.

**Consequence, and the constraint the whole design turns on: for a bucket
absent from the array, the UI cannot distinguish "no teams are in it" from
"it was withheld", and must not render anything that claims either.**

This rules out the obvious design — a `▨ withheld` placeholder row for
every absent bucket. In the commonest early-beta shape (say ten teams, all
with 6+ eligible players → `byTeamSizeBucket: [{'6+', 10}]`,
`foldedIntoAppWide: false`), that design would print "1–2 ▨ withheld" and
"3–5 ▨ withheld" plus "those teams are still counted in the app-wide
figures above" for two buckets containing **no teams at all** — a false
statement to the operator, the exact class of error this section exists to
prevent.

**The design: render only the buckets that are present, in bucket order,
and put the suppression fact in one notice beneath the table, phrased as
"one or more" and never attached to a named row.**

| # | Server state | Rendered as | Exact copy |
|---|---|---|---|
| **A** | `byTeamSizeBucket.length > 0`, `foldedIntoAppWide: false` | Table of exactly the present buckets, in bucket order. **No suppression notice.** (This is the "all ten teams are 6+" case: one row, no notice, nothing implied about the other two.) | Standing caption: *"Only buckets that hold teams and clear the {min}-team minimum are listed."* + the means note. |
| **B** | `length > 0`, `foldedIntoAppWide: true` | The same table, plus **one** full-width hatched `--withheld` notice row directly beneath it — never a per-bucket placeholder row | *"▨ One or more team-size buckets are not shown. A bucket is withheld when it holds fewer than {min} teams, or when showing it would let a withheld bucket be worked out by subtraction. Those teams are still counted in the app-wide figures above. Which bucket was withheld is not shown — an unlisted bucket may equally well have held no teams."* |
| **C** | `length === 0`, `foldedIntoAppWide: true` | The table is replaced by a single bordered `--withheld` panel — **not** an empty table with a caption | *"▨ No team-size breakdown this period. No bucket reached the {min}-team minimum, so every team is counted in the app-wide figures above only."* |
| **D** | `length === 0`, `foldedIntoAppWide: false` | Plain muted line, **different words from C**, no mention of the floor | *"No teams yet."* |

Four things this design is deliberately doing:

1. **No placeholder row for an absent bucket** — see the constraint above.
   The standing caption in state A carries the honest version of what a
   missing row means, once, without asserting a cause.
2. **The suppression notice never states a single reason.** Saying *"fewer
   than {min} teams"* alone would be **factually false** for a bucket
   dropped by complementary suppression, which can hold well over the
   floor. The reason is a disjunction, stated once.
3. **C and D never share a string.** "Withheld" and "there is nothing" are
   opposite facts and the operator acts differently on each. This is the
   sole reason `foldedIntoAppWide` has to be in the response DTO at all.
4. **`{min}` is `minTeamsPerBucket` from the response, never the literal
   `5`** — the constant is env-tunable
   (`USAGE_REPORT_MIN_TEAMS_PER_BUCKET`), and a hardcoded 5 would start
   lying the day it's raised.

**Optional enhancement, not required for v1 (§13).** If naming the withheld
bucket is wanted, the **minimum** additional field is
`withheldBuckets: TeamSizeBucket[]` on `TeamSizeBucketedMetric`, derivable
inside `applyFloor` as `nonEmpty` minus `reported` — **bucket labels only,
never counts**, so it exposes no figure the floor is protecting. With it,
state B can render a named `▨ withheld` row in bucket order and drop the
"may equally well have held no teams" caveat, and state A can positively
say the unlisted buckets were empty. Without it, the design above is
complete and honest — it just says "one or more". **v1 is specified to work
without the field**; do not build a UI that assumes it.

### 4.5 States

| State | Screen |
|---|---|
| `loading` | Header renders immediately; each section shows a skeleton block of its own height (no layout shift). No spinner-over-everything — the recompute is 8 aggregate queries and can take a beat. |
| `loaded` | As §4.2. |
| `empty-ish` | A live-but-tiny app: all sections render, `0`/`No teams yet.`/`No training logged in this window.`/`No badges awarded in this window.` per section. **Not** a whole-page empty state — "everything is zero" is real information. |
| `error` | Whole-page inline error card, `Refresh` button retained: *"Couldn't load the statistics. Try again."* No partial render — a half-loaded dashboard invites reading a missing section as a zero. |
| `stale` | If a `Refresh` fails, the previously-loaded numbers stay on screen but the header's "generated" timestamp gets a muted `— refresh failed` suffix. Never silently show old numbers under a fresh timestamp. |

### 4.6 Copy

| ID | English |
|---|---|
| `admin.stats.title` | Statistics |
| `admin.stats.generatedAt` | Generated {ts} |
| `admin.stats.window` | Trailing {days} days · {from} → {to} |
| `admin.stats.timezoneNote` | Times in Europe/Stockholm |
| `admin.stats.recomputeNote` | Recomputed on every load — nothing is stored |
| `admin.stats.refresh` | Refresh |
| `admin.stats.refreshFailed` | — refresh failed |
| `admin.stats.loadError` | Couldn't load the statistics. Try again. |
| `admin.stats.kpi.players` | total accounts |
| `admin.stats.kpi.active7` | trained in the last 7 days |
| `admin.stats.kpi.activeWindow` | trained in the last {days} days |
| `admin.stats.kpi.pots` | active team pots |
| `admin.stats.section.funnel` | Adoption & consent funnel |
| `admin.stats.section.streaks` | Individual streak health |
| `admin.stats.section.typeMix` | Training-type mix |
| `admin.stats.section.weeklyGoal` | Weekly-goal engagement |
| `admin.stats.section.pool` | Team pool (VM-Guld) growth |
| `admin.stats.section.social` | Social features — volume only |
| `admin.stats.section.badges` | Badge mix |
| `admin.stats.byTeamSize` | By team size (means across each bucket's teams) |
| `admin.stats.bucket.listedCaption` | Only buckets that hold teams and clear the {min}-team minimum are listed. |
| `admin.stats.bucket.someWithheldRow` | ▨ One or more team-size buckets are not shown. |
| `admin.stats.bucket.withheldNote` | A bucket is withheld when it holds fewer than {min} teams, or when showing it would let a withheld bucket be worked out by subtraction. Those teams are still counted in the app-wide figures above. Which bucket was withheld is not shown — an unlisted bucket may equally well have held no teams. |
| `admin.stats.bucket.meansNote` | Means are per team (each team counts once) — they do not add up to the totals above. |
| `admin.stats.bucket.allWithheld` | ▨ No team-size breakdown this period. No bucket reached the {min}-team minimum, so every team is counted in the app-wide figures above only. |
| `admin.stats.bucket.noTeams` | No teams yet. |
| `admin.stats.streaks.note` | Two separate histograms, not one comparison — "how many are on a streak now" and "how far has anyone ever got" are different questions. |
| `admin.stats.weeklyGoal.note` | "Met" means every eligible roster member individually reached the target (ADR-0015), not a captain marking the goal complete. Cancelled goals are excluded from the rate, not counted as failures. |
| `admin.stats.pool.note` | Lifetime average since each season started, not points earned inside this window — no points history is stored. |
| `admin.stats.social.note` | Counts only — never which clip, never who posted, never message content. Hatched bars cover only part of the window (the first and last always do), so their lower counts are windowing, not a real dip. |
| `admin.stats.social.partialLegend` | ▨ = partial week |
| `admin.stats.emptyTypeMix` | No training logged in this window. |
| `admin.stats.emptyBadges` | No badges awarded in this window. |
| `admin.stats.footer` | Every figure on this page is app-wide or team-size-bucketed. There is no per-team or per-player view, here or anywhere in this console's statistics. |

---

## 5. AD2 — Error log

**Trigger:** nav item 2.
**API:** `GET /api/v1/admin/errors` — paginated, filterable by `source`,
`status_code` range, and date (Decision 6). No other filter exists.

### 5.1 The constraint is the design

`ErrorLogEntry` has ten columns and **no player or team column exists**.
The layout does not have a hidden "reporter" affordance, an expandable
"context" section that's empty, or a greyed-out user column — because a
greyed-out column implies the data is there and merely withheld, which is
the opposite of true here. Instead the table states the fact once, plainly,
under its header.

### 5.2 Layout

```
┌ Errors ─────────────────────────────────────────────────────────────┐
│ Source [ All ▾ ]  Status [ All ▾ ]  From [2026-07-08] To [2026-08-07]│
│                                                    [ Apply ]  [ ✕ ] │
│ Showing 50 of 231 · newest first · times in Europe/Stockholm        │
│ Rows carry no player or team reference — there is no such column     │
│ (ADR-0022 Decision 6). Kept {retentionDays} days, then deleted.      │
├──────────────┬─────┬────────────────────────────┬────┬──────┬───────┤
│ Time         │ Src │ Route (template) / Job     │ M  │ Stat │ Error │
├──────────────┼─────┼────────────────────────────┼────┼──────┼───────┤
│ 08-07 14:22  │ http│ /api/v1/teams/:teamId/clips│POST│  500 │ TypeE…│
│ ▸ 08-07 14:19│ http│ /api/v1/consent/:token     │GET │  404 │ AppEx…│
│ 08-07 03:00  │ job │ clip-retention-sweep       │ —  │   —  │ Query…│
│ 08-06 22:41  │ http│ (unmatched)                │GET │  404 │ NotFo…│
└──────────────┴─────┴────────────────────────────┴────┴──────┴───────┘
        [ ← Newer ]                                    [ Older → ]

  ── expanded row (▸ toggled) ────────────────────────────────────────
  │ AppException · 404 · GET /api/v1/consent/:token · 2026-08-07 14:19
  │
  │ Message
  │ Consent token not found or already used
  │
  │ Stack (first {maxFrames} frames, truncated on write)   [ Copy ]
  │ ┌──────────────────────────────────────────────────────────┐
  │ │ AppException: Consent token not found or already used     │
  │ │     at ConsentService.approve (consent.service.ts:118:13) │
  │ │     at ConsentController.approve (…:41:22)                │
  │ │     …                                                     │  ← scrolls
  │ └──────────────────────────────────────────────────────────┘
  │ Route templates are recorded, never the resolved path — the
  │ token in this URL was never stored.
  └───────────────────────────────────────────────────────────────────
```

### 5.3 Honest filtering and sorting

| Control | Values | Note |
|---|---|---|
| Source | All / HTTP / Job | Maps to the `source` enum. Selecting **Job** greys out Status (a job row's `status_code` is always `null`) rather than silently returning nothing. |
| Status | All / 2xx / 4xx / 5xx / No status | "No status" is `status_code IS NULL`, i.e. job rows. Ranges, not exact codes — Decision 6 specifies a range filter. |
| From / To | Date inputs, default = last 7 days | Not last 90: the default view should be "what's happening now", and the retention note tells the operator the older data exists. |
| Sort | **Fixed, newest first. No sortable column headers.** | The endpoint contract defines no sort parameter. Clickable headers that only re-sort the current page would be a lie about the data set — see §13 for the follow-up if real sorting is wanted. |
| Text search | **Not present.** | Same reason. A search box that filters only the loaded page is worse than no search box. Flagged in §13 as a plausible additive follow-up (`?q=` over `error_name`/`message`). |

**Long stacks.** The stack is truncated on write to a configured frame
count (ADR-0022 Decision 6 says "e.g. first ~20 frames" — a recommendation,
not a fixed number, so the console interpolates `{maxFrames}` from config
rather than printing a literal; §13). The UI shows the stack
in a monospace `<pre>` inside a fixed-height (≈ 260px) scroll region so
one bad row can't push the rest of the table off screen, with a **Copy**
button (client-side clipboard only — this console writes nothing but a bug
report's status). Message is shown in full above it, unwrapped-but-wrapping,
never truncated with an ellipsis in the expanded view.

**`(unmatched)`** is the UI's rendering of `route: null` on an `http` row —
Express doesn't populate `request.route` for a request that matched nothing
(the security-reviewer's non-blocking note). Rendering an empty cell would
read as a bug in the console; rendering the literal word says "this was
404-from-nowhere traffic", which is what it is and which the operator will
see constantly in production.

### 5.4 States

| State | Screen |
|---|---|
| `loading` | 8 skeleton rows at final row height; filter bar stays interactive. |
| `loaded` | As §5.2. |
| `empty-never` | No rows have ever been recorded (page 1, no filters): *"Nothing recorded yet. Errors and failed jobs will appear here as they happen."* |
| `empty-filtered` | Filters applied, zero matches: *"No errors match these filters."* + a **Clear filters** action. Distinct from `empty-never` — one is good news, the other might mean a mis-set filter. |
| `error` | Inline card + Retry, filters preserved. |
| `row-expanded` | One row at a time (expanding a second collapses the first) — keeps the table scannable and keeps only one `<pre>` in the DOM. |
| `end-of-list` | **Older →** disabled, muted line: *"That's everything in this range."* |

### 5.5 Copy

| ID | English |
|---|---|
| `admin.errors.title` | Errors |
| `admin.errors.filter.source` | Source |
| `admin.errors.filter.status` | Status |
| `admin.errors.filter.from` / `.to` | From / To |
| `admin.errors.filter.apply` | Apply |
| `admin.errors.filter.clear` | Clear filters |
| `admin.errors.countLine` | Showing {n} of {total} · newest first · times in Europe/Stockholm |
| `admin.errors.noPlayerNote` | Rows carry no player or team reference — there is no such column. Kept {retentionDays} days, then deleted. |
| `admin.errors.col.*` | Time / Src / Route (template) / Job / Method / Status / Error |
| `admin.errors.unmatchedRoute` | (unmatched) |
| `admin.errors.detail.message` | Message |
| `admin.errors.detail.stack` | Stack (first {maxFrames} frames, truncated on write) |
| `admin.errors.detail.copy` | Copy |
| `admin.errors.detail.copied` | Copied |
| `admin.errors.detail.routeNote` | Route templates are recorded, never the resolved path — any token in this URL was never stored. |
| `admin.errors.emptyNever` | Nothing recorded yet. Errors and failed jobs will appear here as they happen. |
| `admin.errors.emptyFiltered` | No errors match these filters. |
| `admin.errors.endOfList` | That's everything in this range. |
| `admin.errors.loadError` | Couldn't load the error log. Try again. |
| `admin.errors.jobHasNoStatus` | Job rows have no status code. |

---

## 6. AD3 — Bug-report triage queue

**Trigger:** nav item 3 (with an "N open" count badge).
**API:** `GET /api/v1/admin/bug-reports` (paginated, filter by `status`),
`PATCH /api/v1/admin/bug-reports/:id { status }` (Decision 7).

### 6.1 Layout — two panes, list left, detail right

```
┌ Bug reports ────────────────────────────────────────────────────────┐
│ [ Open 7 ] [ Triaged 3 ] [ Closed ] [ All ]        newest first      │
├─────────────────────────────┬───────────────────────────────────────┤
│ ▸ 08-07 14:02               │ Report · 2026-08-07 14:02             │
│   Upload failed             │ Status  [ Open ][Triaged][Closed]     │
│   ios · 1.4.2 · clips       │                            ✓ Saved     │
│   ─────────────────────────  │                                       │
│   08-07 09:31               │ ┌ What & where ───────────────────┐   │
│   Something missing/wrong   │ │ Category   Upload failed         │   │
│   android · 1.4.1 · goal    │ │ Screen     Shorts (clips)        │   │
│   ─────────────────────────  │ │ Platform   iOS                   │   │
│   08-06 17:55               │ │ App        1.4.2      ⚠ verbatim │   │
│   Crash                     │ │ OS         iOS 17.5.1 ⚠ verbatim │   │
│   ios · 1.4.2 · home        │ │ Locale     sv                    │   │
│   ─────────────────────────  │ └──────────────────────────────────┘   │
│   …                         │                                       │
│                             │ ┌ Reporter's own words ───────────┐   │
│ [ ← Newer ] [ Older → ]     │ │ jag tryckte på ladda upp och     │   │
│                             │ │ sen bara snurra snurra o inget   │   │
│                             │ │ hände :(                         │   │
│                             │ └──────────────────────────────────┘   │
│                             │ Untrusted text, shown escaped as       │
│                             │ plain text.                            │
│                             │                                       │
│                             │ ┌ Reporter ───────────────────────┐   │
│                             │ │ Screen name  FloorballStar15     │   │
│                             │ │                       ⚠ verbatim │   │
│                             │ │ Team         Lokstallet P13      │   │
│                             │ │                       ⚠ verbatim │   │
│                             │ └──────────────────────────────────┘   │
│                             │ This console cannot list a player's    │
│                             │ other reports, search by player, or    │
│                             │ open a player. By design.              │
└─────────────────────────────┴───────────────────────────────────────┘
```

### 6.2 Every rendered field is escaped — made visible, not just documented

**The rule is not an enumerated list of fields. It is: every string in this
view that originated from a user — including the identity fields — is
untrusted, is HTML-escaped, and is rendered with the visible "verbatim"
treatment below.** Stating it as a rule rather than a list is the fix for a
real hole: the security-reviewer's 2026-08-02 correction named
`description`, `app_version` and `os_version`, but §6.3's reporter block
also renders **screen name** and **team name**, and those are just as
attacker-controllable. Verified directly:
`backend/src/onboarding/dto/create-player.dto.ts:59-62` validates
`screenName` with `@IsString() @IsNotEmpty() @MaxLength(30)` and nothing
else — `teamName` (`:92-97`) the same — and there is no charset or
`@Matches` validator anywhere in `backend/src` constraining either. So a
player can register with a screen name containing
`<img src=x onerror=…>`, file one bug report, and wait. If the reporter
cell is built with `innerHTML` because this doc didn't mark it untrusted,
that payload executes **same-origin with the admin session cookie
auto-attached** — the `httpOnly` flag protects the token from being read,
and protects nothing at all against a script using the ambient session to
act as the admin, which is the exact failure mode the ADR's own escaping
fix was written for.

Two design consequences, both intentional:

- **Five fields get the `⚠ verbatim` / "untrusted text" treatment**: the
  freeform `description` (its own bordered block, labelled *"Reporter's own
  words"*, sub-labelled *"Untrusted text, shown escaped as plain text."*),
  `app_version` and `os_version` (muted monospace chip + `⚠` marker), and
  **the reporter block's screen name and team name** (same chip + marker).
  This is not decoration — it is a standing visual reminder to whoever next
  edits this page that these values came off the wire from any
  authenticated client, and it makes an accidental `innerHTML` regression
  visually incongruous rather than invisible. If a future field is added to
  this view, the test is "did a user type it?", not "is it on the list".
- **The four enum fields are rendered as their *display labels*, never
  their raw value** (`upload_failed` → "Upload failed", `clips` →
  "Shorts (clips)"). This is a small, real second guarantee: a display
  label comes from a lookup table in the console's own code, so even a
  malformed enum value from a future migration renders as
  `Unknown ({raw})` through the same escaping path, never as free text.

**Binding rendering rule for backend-developer** (restating and *widening*
the ADR, since this is the page it applies to): build every one of these
nodes — the five untrusted fields above included — with `textContent` /
`createTextNode`, or escape through the existing `html-escape.util.ts`
convention. Never `innerHTML` with interpolated report **or reporter**
data — including the `title=` attribute of the list row's summary, which is
the easiest place to forget.

### 6.3 Reporter identity — deliberately present, deliberately not a drill-down

Decision 7 is explicit that a bug report *should* carry the reporter's
identity ("the project owner needs to know which team/device/app-version
had the problem to reproduce and fix it") and that this is a bounded
exception to Decision 5's floor, not a loophole. The design honours both
halves:

| Rule | Rendering |
|---|---|
| Identity appears **only in an opened report's detail pane** | There is no reporter column in the list. The list row's third line is `platform · app version · screen` — device facts, not a person. |
| **No filter, sort, or search by reporter** | The filter bar has exactly four status chips. No player field exists in the UI at all. |
| **No "other reports by this player" link** | Not built, and the console says so in words under the reporter block, so the absence reads as a decision rather than an oversight. |
| **Screen name only, never `real_name`, never `parent_contact`** | The reporter block has exactly two rows. `real_name` is `PlayerPrivateInfo`-scoped and has no business on this page; the console must not request it and the endpoint must not return it (§13). |
| **Both rows are untrusted, escaped, and visibly marked** | Screen name and team name are user-supplied strings with no charset validation (§6.2) — they get the same `⚠ verbatim` treatment as `app_version`/`os_version`, not the plain rendering an "identity" field invites. |
| **Never joined into statistics** | AD1 and AD3 share no navigation, no filter state, and no link. There is no "bug reports per team" tile anywhere (§12). |

Team name is included because reproduction genuinely depends on team shape
(roster size, whether a pot is active). **Flagged in §13**: if
backend-developer prefers, the team's short id would serve the same
reproduction purpose with less identifying content — a defensible narrowing
this design would accept without any layout change.

### 6.4 Triage workflow

Status is a three-segment control in the detail pane header, plus a
right-click-free quick action on the list row (a small `Triage` / `Close`
button that appears on row focus/hover **and is keyboard-focusable**, never
hover-only).

| State | Behaviour |
|---|---|
| `idle` | Current status segment selected. |
| `saving` | Segment control disabled, small spinner beside it. **Not optimistic** — this is the console's only write; showing a status that didn't persist would be worse than a 300ms wait. |
| `saved` | `✓ Saved` beside the control for 3s, announced via `aria-live="polite"`. The list row's status chip and the filter counts update in place; if the current filter is `Open` and the report just became `Triaged`, the row **stays visible until the next explicit filter change** — a row vanishing under the cursor the instant it's actioned is disorienting and makes "undo" impossible. |
| `failed` | Control reverts to the previous value, inline error: *"Couldn't update the status. Try again."* |
| `gone` (`404`) | Detail pane replaced by: *"This report no longer exists — the reporter's account was probably erased."* + a **Back to list** action. This is a real case: `player_id` is `ON DELETE CASCADE`, so an account erasure removes the report mid-session. |

**Transitions are unrestricted** (`open ⇄ triaged ⇄ closed`), not
forward-only. One operator, no audit trail, and a mis-clicked "Closed" that
can't be undone from the UI would send the operator to `psql` — the exact
thing this console exists to replace. **Flagged for backend-developer
(§13)**: confirm `PATCH` accepts any target status; if it enforces
forward-only, the segments for earlier statuses render disabled with the
tooltip *"Status can only move forward."* rather than failing on click.

### 6.5 States

| State | Screen |
|---|---|
| `loading` | List skeleton; detail pane shows its own empty prompt. |
| `list-loaded, none-selected` | Detail pane: *"Select a report to see the details."* |
| `empty-open` (default filter, nothing open) | *"Nothing open. 🙂"* — no, without the emoji: *"No open reports."* plus a muted second line *"Reports sent from the app show up here."* |
| `empty-filtered` | *"No {status} reports."* |
| `error` | Inline card + Retry over the list pane; detail pane cleared. |
| `report-with-no-description` | The "Reporter's own words" block is **omitted entirely** (not rendered empty, not "—") — `description` is nullable and a kid submitting only a category is a normal, useful report. |

### 6.6 Copy

| ID | English |
|---|---|
| `admin.bugs.title` | Bug reports |
| `admin.bugs.filter.open` / `.triaged` / `.closed` / `.all` | Open / Triaged / Closed / All |
| `admin.bugs.sortNote` | newest first |
| `admin.bugs.detail.sectionWhat` | What & where |
| `admin.bugs.detail.category` / `.screen` / `.platform` / `.app` / `.os` / `.locale` | Category / Screen / Platform / App / OS / Locale |
| `admin.bugs.detail.description` | Reporter's own words |
| `admin.bugs.detail.descriptionNote` | Untrusted text, shown escaped as plain text. |
| `admin.bugs.detail.verbatimMarker` | verbatim |
| `admin.bugs.detail.reporter` | Reporter |
| `admin.bugs.detail.screenName` | Screen name |
| `admin.bugs.detail.team` | Team |
| `admin.bugs.detail.noDrilldownNote` | This console cannot list a player's other reports, search by player, or open a player. By design. |
| `admin.bugs.status.label` | Status |
| `admin.bugs.status.saved` | ✓ Saved |
| `admin.bugs.status.error` | Couldn't update the status. Try again. |
| `admin.bugs.status.forwardOnly` | Status can only move forward. |
| `admin.bugs.gone` | This report no longer exists — the reporter's account was probably erased. |
| `admin.bugs.backToList` | Back to list |
| `admin.bugs.selectPrompt` | Select a report to see the details. |
| `admin.bugs.emptyOpen` | No open reports. |
| `admin.bugs.emptyOpenSub` | Reports sent from the app show up here. |
| `admin.bugs.emptyFiltered` | No {status} reports. |
| `admin.bugs.loadError` | Couldn't load the bug reports. Try again. |
| `admin.bugs.enum.category.*` | Crash / Couldn't sign in / Missing or wrong data / Upload failed / Something else |
| `admin.bugs.enum.platform.*` | iOS / Android / Web |
| `admin.bugs.enum.screen.*` | Home / Chat / Shorts (clips) / Clip upload / Goal / Team / Leaderboard / Profile / Sign-up / Somewhere else |
| `admin.bugs.enum.unknown` | Unknown ({raw}) |

---

## 7. AD4 — Planning: Roadmap / Ideas / Security issues

**Trigger:** nav item 4 (🔒).
**API:** `GET /api/v1/admin/planning/roadmap`, `.../ideas`,
`.../security-issues` — all three `AdminAuthGuard` **plus** the fresh-
`authenticatedAt` check (Decision 10). No query parameters. Read-only.

### 7.1 Layout

```
┌ Planning ───────────────────────────────────────────────────────────┐
│ [ Roadmap ] [ Ideas ] [ Security issues ]                            │
│                                                                     │
│ 📖 Read-only. Currently-open items only — closed and superseded      │
│    items are not shown here. All four lists come from the            │
│    hand-applied admin-planning-docs ConfigMap — internal, never in    │
│    the public repo. The markdown files on the project owner's        │
│    machine stay the source of truth; edit there and re-apply the     │
│    ConfigMap.                                                        │
│    Content last synced: 2026-08-02 (5 days ago)                      │
├─────────────────────────────────────────────────────────────────────┤
│  ── Roadmap tab ──                                                  │
│                                                                     │
│  ┌ From ACTION_PLAN.md ────────────── phase checklist · open ────┐  │
│  │ Next Up                                                       │  │
│  │   ☐ Turn on branch protection for main and prerelease         │  │
│  │   ☐ Resolve the cilium#44123 cert-renewal workaround          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌ From PROJECT.md ──────────── business priorities · open ──────┐  │
│  │ Fas 5 · 2 — PT/Tränare-roll (needs its own architect +        │  │
│  │ security pass before design starts)                           │  │
│  │ …                                                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 One trust level, four sources — and why the roadmap tab still shows two groups

**Corrected against ADR-0022's 2026-08-07 amendment to Decision 10.** An
earlier draft of this section built a visible *trust* split into the
roadmap tab, on the ADR's original premise that `ACTION_PLAN.md` was
tracked, public and parsed from the deployed image while the other sources
were internal. Commit `6b06d81` (2026-08-06) inverted both halves of that
premise: `docs/ACTION_PLAN.md` moved to `docs/internal/ACTION_PLAN.md`,
which `.gitignore`'s line 3 (`docs/internal/`) has excluded from the start,
so it is **untracked and not in the CI-built image**; and `docs/PROJECT.md`
moved the other way and is **tracked and public again**. The badge copy
that split would have produced was therefore exactly inverted — "tracked in
git · public" rendered over internal-only content, beside a `PROJECT.md`
group labelled "internal only" when `PROJECT.md` is the one that is
actually public.

Per the amendment, **all four planning sources now reach the pod the same
way**: as keys on the hand-applied `admin-planning-docs` ConfigMap, out of
band from CI and the public tree. There is **one trust level across this
entire pillar**, and no per-source trust badge anywhere. That is a
simplification, not a loss — one directory, four files, one provenance
story, stated once in the banner (§7.3) instead of four times in badges.

**The roadmap tab still renders two groups**, but for a different and
smaller reason: the two sources have genuinely different *shapes and
cadences*, not different trust. `ACTION_PLAN.md`'s slice is a mechanical
phase checklist of engineering steps; `PROJECT.md`'s slice is a short
Swedish list of numbered business priorities. Merging them into one flat
list would produce a view where "Turn on branch protection" and
"PT/Tränare-roll" sit as peers. So: two bordered groups, each with a source
header and a neutral **shape** label — no colour coding, no trust claim.

| Source | Tab | Label |
|---|---|---|
| `ACTION_PLAN.md` (curated open subset) | Roadmap | `phase checklist · open` |
| `PROJECT.md` (curated open subset) | Roadmap | `business priorities · open` |
| `BACKLOG.md` (curated open subset) | Ideas | `open ideas` |
| Security-issues list | Security issues | `unfixed gaps` |

All four labels render in the same neutral `--chart-neutral` outline. **The
earlier draft's `error`-coloured "internal only" badge is removed
entirely** — with one trust level there is nothing for it to distinguish,
and the pillar-wide fact it was trying to convey now lives in the banner,
where it applies to everything on screen rather than to one box.

### 7.3 "Currently open items only" on screen

The banner at the top of the pillar (persistent, non-dismissible, present
on all three tabs) carries four facts in this order: **read-only**,
**open-items-only**, **everything here is internal, ConfigMap-delivered
content**, **where the truth actually lives**. Ordering matters — the first
three are what the operator needs to interpret what they're reading; the
fourth is what they need in order to act.

Rendering of the items themselves:

- **Roadmap (`ACTION_PLAN.md` slice)**: `☐` glyphs preserved, section
  headings preserved as group sub-headings. Only open items are in the
  payload; no ticked item ever appears, so there is **no checked box
  anywhere** — and therefore no implication that the boxes are clickable.
  **They are not interactive**: rendered as text glyphs, never as
  `<input type="checkbox" disabled>` (a disabled checkbox reads as
  "temporarily unavailable", which invites a support question about why it
  can't be ticked).
  **The UI makes no assumption about checkbox syntax.** Per the ADR's
  2026-08-07 implementation constraint, the file's currently-open work is
  in its "Next Up" section as numbered `N. [ ]` entries, while every
  line-leading `- [ ]` in the file sits under a "Completed Phases
  (archive)" header that is explicitly not actionable — so which lines
  count as open items is backend-developer's parser problem, not a
  rendering one. This view renders whatever open items the endpoint
  returns, as `☐ <text>` grouped under whatever section headings come with
  them, and must not re-derive or re-filter anything client-side (§13).
- **Ideas / Security issues**: rendered as a markdown-ish block —
  headings, paragraphs, bullets, inline code, links. **Links open in a new
  tab with `rel="noopener noreferrer"`.** No image rendering, no raw HTML
  pass-through: the content is trusted-ish (hand-curated by the project
  owner) but it arrives via a ConfigMap and rendering arbitrary HTML in the
  same origin as the admin session would be a gratuitous extra path.
- **Empty tab**: *"Nothing here. Either the list is empty or the
  admin-planning-docs ConfigMap hasn't been applied on this cluster."* —
  the second half matters, because on `ubuntu01` an un-applied ConfigMap is
  the *likeliest* cause and would otherwise look like "no ideas".

### 7.4 Read-only, and visibly different from the one thing that writes

This pillar has **no** edit control, no "mark done", no textarea, no save
button — Decision 10's read-only-for-v1 conclusion. The banner says so in
its first four words. AD3's status control is the console's single write,
and the two read differently on purpose: AD3 has a real interactive
segmented control with a `✓ Saved` confirmation; AD4 has no interactive
element other than the tab switcher and links.

Stated in this doc rather than left implicit, per the brief: **the
distinction is "a DB row vs. a file."** A future contributor who adds an
"edit" button to AD4 would be building the file-write-back mechanism
Decision 10 explicitly declined, not extending AD3's pattern.

### 7.5 Content is cleared when leaving the pillar

Navigating from Planning to any other pillar **discards the fetched
planning content from memory and the DOM**. Cheap, and it means a console
left open on a desk doesn't sit there displaying a curated index of unfixed
security gaps. Returning to the pillar re-fetches — and if the 15-minute
window has since lapsed, that re-fetch triggers AD5 again, which is the
correct outcome rather than an annoyance.

### 7.6 States

| State | Screen |
|---|---|
| `reauth-needed` | First fetch returns `401 reauth_required` → AD5 opens over a **dimmed but rendered** pillar shell (tabs visible, content area showing a muted lock placeholder). The operator can see where they are. |
| `loading` | Skeleton paragraphs. |
| `loaded` | As §7.1. |
| `empty` | §7.3's ConfigMap-aware empty text. |
| `error` | Inline card + Retry. Distinguish `404`/`500` from `reauth_required`: only the latter opens AD5. |
| `stale-warning` | If `syncedAt` (§13) is older than 30 days, the banner's sync line gets an `error`-coloured prefix: *"⚠ Content is {n} days old."* Silent staleness is the built-in failure mode of a hand-applied ConfigMap; the design should make it loud. |

### 7.7 Copy

| ID | English |
|---|---|
| `admin.planning.title` | Planning |
| `admin.planning.tab.roadmap` / `.ideas` / `.security` | Roadmap / Ideas / Security issues |
| `admin.planning.banner` | Read-only. Currently-open items only — closed and superseded items are not shown here. All four lists come from the hand-applied admin-planning-docs ConfigMap — internal, never in the public repo. The markdown files on the project owner's machine stay the source of truth; edit there and re-apply the ConfigMap. |
| `admin.planning.synced` | Content last synced: {date} ({n} days ago) |
| `admin.planning.syncedUnknown` | Sync date unknown. |
| `admin.planning.syncedStale` | ⚠ Content is {n} days old. |
| `admin.planning.source.actionPlan` | From ACTION_PLAN.md |
| `admin.planning.source.project` | From PROJECT.md |
| `admin.planning.source.backlog` | From BACKLOG.md |
| `admin.planning.source.security` | Security issues list |
| `admin.planning.shape.checklist` | phase checklist · open |
| `admin.planning.shape.priorities` | business priorities · open |
| `admin.planning.shape.ideas` | open ideas |
| `admin.planning.shape.security` | unfixed gaps |
| `admin.planning.lockedPlaceholder` | Locked — re-enter your password to view. |
| `admin.planning.empty` | Nothing here. Either the list is empty or the admin-planning-docs ConfigMap hasn't been applied on this cluster. |
| `admin.planning.loadError` | Couldn't load this list. Try again. |

---

## 8. AD5 — Step-up re-auth prompt

**Trigger:** any `planning/*` request returning `401 reauth_required`.
**API:** `POST /api/v1/admin/auth/login { username, password }` — the same
endpoint, which refreshes `authenticatedAt` on the existing session
(Decision 10).

### 8.1 Layout

```
        ┌ dimmed console, still visible behind ┐
        │  Planning                             │
        │  [Roadmap][Ideas][Security issues]    │
        │                                       │
   ┌────┴───────────────────────────────────────┴────┐
   │  🔒  Confirm it's you                       [✕] │
   │                                                 │
   │  This section shows internal planning notes     │
   │  and unfixed security gaps. Re-enter your        │
   │  password to open it.                            │
   │                                                 │
   │  Signed in as  admin                            │
   │                                                 │
   │  Password                                       │
   │  [_________________________________]            │
   │                                                 │
   │  ┌ error, if any ──────────────────────┐        │
   │  │ ⚠ Wrong password.                    │        │
   │  └──────────────────────────────────────┘        │
   │                                                 │
   │  [ Cancel ]                 [   Confirm   ]     │
   └─────────────────────────────────────────────────┘
```

### 8.2 It never loses the operator's place

- The modal is an **overlay on the pillar the operator was already in** —
  the console does not navigate, does not unmount AD4, does not clear the
  selected tab, and does not touch AD1/AD2/AD3 state.
- The **pending request is remembered** and replayed on success. If the
  operator clicked "Security issues" and got the prompt, success lands them
  on Security issues, not on Roadmap.
- **Cancel** (or Esc, or the ✕) closes the modal and leaves the pillar in
  its `locked` state — tabs still visible, content area showing
  `admin.planning.lockedPlaceholder` and an **Unlock** button that reopens
  the modal. It never bounces the operator to another pillar or to AD0.
- The password field is **`type="password"` with
  `autocomplete="current-password"`**, and the modal is a real `<form>` so
  Enter submits.
- The username is shown **read-only, not as an editable field** — this
  prompt is about proving the session's own identity, and offering an
  editable username here would invite "sign in as someone else", which
  isn't a thing that exists. Value comes from the session (§13's
  recommended `GET /admin/auth/session`); if unavailable, the line is
  omitted entirely rather than showing a guess.

### 8.3 The two failure cases, kept distinct

| Case | Server | UI |
|---|---|---|
| **Wrong password at step-up** | `401 invalid_credentials` from the step-up `POST` | Error **inside the modal**: *"Wrong password."* Password field cleared, focus returns to it, modal stays open, **the ordinary session is untouched** — the operator stays signed in and can Cancel back to a fully working console. Under no circumstances does a failed step-up sign the operator out. |
| **Ordinary session also expired** | `401` (plain, no `reauth_required`) from *any* request, including the step-up call | Modal closes, whole console unmounts → **AD0** with `expired-notice`, and `#planning/security-issues` remembered as the destination. Not a modal error — the operator's problem is now different and the fix is a full sign-in. |
| **Throttled** | `429` from the step-up `POST` | Error inside the modal: *"Too many attempts. Wait a minute and try again."* Confirm disabled for the retry window. **Named as a real operational trap in §13**: the step-up call shares the login route's per-IP throttle, so repeated step-up failures can lock the operator out of ordinary sign-in too. |
| **Network / 5xx** | — | Error inside the modal: *"Couldn't reach the server. Try again."* Nothing else changes. |

### 8.4 Copy

| ID | English |
|---|---|
| `admin.stepup.title` | Confirm it's you |
| `admin.stepup.body` | This section shows internal planning notes and unfixed security gaps. Re-enter your password to open it. |
| `admin.stepup.signedInAs` | Signed in as {name} |
| `admin.stepup.password` | Password |
| `admin.stepup.confirm` | Confirm |
| `admin.stepup.confirming` | Checking… |
| `admin.stepup.cancel` | Cancel |
| `admin.stepup.unlock` | Unlock |
| `admin.stepup.errorWrong` | Wrong password. |
| `admin.stepup.errorThrottled` | Too many attempts. Wait a minute and try again. |
| `admin.stepup.errorNetwork` | Couldn't reach the server. Try again. |

**If the TOTP recommendation is adopted** (the security-reviewer's strong
recommendation, unresolved — §14), this modal's body copy changes to
*"Enter the 6-digit code from your authenticator app."*, the input becomes
`inputmode="numeric" autocomplete="one-time-code" maxlength="6"`, and
`admin.stepup.errorWrong` becomes *"Wrong code."* Everything else in §8.2
(placement, replay, cancel behaviour, focus handling) is unchanged. The
design is deliberately factor-agnostic so that decision doesn't reopen this
layout.

---

## 9. BR1–BR3 — Mobile "Report a problem"

### 9.1 BR1 — where it lives (against the real app, not an invented nav)

`mobile/src/AppShell.tsx` has five tabs (`home`/`chat`/`clips`/`goal`/
`team`) and no settings surface. The only account-level screen is
`mobile/src/home/ProfileScreen.tsx`, reached by tapping the avatar circle
in `AppHeader` on the **Home** tab, whose `view` step already carries the
app's non-loop account actions as a stack of `SecondaryLink`s: *Tillbaka*,
*Logga ut*, and (Fas 4.2) *Radera mitt konto*.

**BR1 is a new `SecondaryLink` in that stack, between "Logga ut" and the
erasure entry**, using the default muted colour (not `variant="error"` —
reporting a bug is not destructive):

```
   …
   [ Tillbaka ]
   [ Logga ut ]
   [ Rapportera ett problem ]      ← BR1, new
   ⌄ (extra spacing)
   [ Radera mitt konto ]           ← E1, unchanged (error-coloured)
```

Reasoning, both directions:

- **Why not somewhere more prominent.** CLAUDE.md's brief for this app is
  that the core loop is one tap deep and never buried; the corollary is
  that everything that *isn't* the core loop must not compete with it. A
  bug-report button on the Home screen or in the tab bar would be a
  permanent invitation to a nine-year-old to file "the app is boring".
- **Why Profile and not a new screen.** Adding a settings tab for one link
  would be a menu built for a single item, and `ProfileScreen`'s existing
  `ProfileView` union already models exactly this shape (Fas 4.2 added
  three steps to it). BR2/BR3 become two more values in that union —
  `bugReport` and `bugReportSent` — with no navigation library and no new
  screen container.
- **Ungated by consent.** BR1 renders for anyone with a session, including
  a player whose parental consent is still `pending`. A child stuck in the
  waiting state is precisely the person most likely to have something worth
  reporting, and Decision 7's submission endpoint is specified as plain
  `JwtAuthGuard`, not consent-gated. **Confirmed as a deliberate call, and
  raised in §14** — it's a consent-boundary question, not purely a UX one.

**Flagged as a follow-up, not designed here:** a second entry point on the
generic "Kunde inte hämta…/Försök igen" error state (`LoadingOrRetry`),
which is where a stuck kid actually is. Real value, but it multiplies the
places `screen` is decided and deserves its own small pass.

### 9.2 BR2 — the form

```
┌─────────────────────────────────────┐
│ Något som inte funkar?              │
│ Berätta vad som hände så fixar vi   │
│ det.                                │
│                                     │
│ VAD HÄNDE?                          │
│ ┌─────────────────────────────────┐ │
│ │ ○ Appen kraschade eller frös    │ │
│ │ ● Något saknas eller visas fel  │ │
│ │ ○ Jag kunde inte logga in       │ │
│ │ ○ Ett klipp gick inte att ladda │ │
│ │   upp                           │ │
│ │ ○ Något annat                   │ │
│ └─────────────────────────────────┘ │
│                                     │
│ VAR I APPEN HÄNDE DET?              │
│ ┌───────┐┌───────┐┌───────┐         │
│ │ Hem   ││ Chatt ││ Klipp │  …      │
│ └───────┘└───────┘└───────┘         │
│  (chips, single-select, wraps)      │
│                                     │
│ VILL DU BERÄTTA MER? (FRIVILLIGT)   │
│ ┌─────────────────────────────────┐ │
│ │ T.ex. "Jag tryckte på Jag har   │ │
│ │ tränat och då hände inget."     │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
│                        0/500 tecken │
│                                     │
│ ┌ 💡 Det här skickar vi med ──────┐ │
│ │ Ditt skärmnamn och ditt lag,    │ │
│ │ vilken version av appen du har, │ │
│ │ vilken sorts telefon och vilket │ │
│ │ språk appen är på — plus det du │ │
│ │ valt och skrivit här ovanför.   │ │
│ │                                 │ │
│ │ Vi skickar aldrig var du är,    │ │
│ │ vilken telefon det är, din      │ │
│ │ IP-adress eller vad du gjort i  │ │
│ │ appen tidigare.                 │ │
│ │                                 │ │
│ │ Det går bara till oss som       │ │
│ │ bygger appen — aldrig till      │ │
│ │ någon annan i laget.            │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [           Skicka           ]      │
│ [           Avbryt           ]      │
└─────────────────────────────────────┘
```

**Field set — exactly Decision 7's, nothing more:**

| Wire field | Source | Notes |
|---|---|---|
| `category` | Radio list, **required** | 5 enum values, kid-legible labels (not `missing_or_wrong_data`). |
| `screen` | Chip picker, **required** | See §9.3 — a deliberate deviation from "auto-captured". |
| `description` | Textarea, optional, hard-capped at 500 chars | Counter appears from the first character; the input is *capped*, not validated-then-rejected. |
| `app_version` | Auto, from the Expo build | Not shown as an editable field. |
| `platform` | Auto (`ios`/`android`/`web`) | " |
| `os_version` | Auto | " |
| `locale` | Auto, the player's current `PlayerLocale` | " |
| `player_id` | Server-side, from the session | Never sent by the client. |

**Nothing else is collected.** No location, no device identifier, no
advertising id, no IP capture in the app layer, no action trail, no
screenshot, no log attachment.

**Submit is disabled** until `category` and `screen` are both chosen.
Description is genuinely optional (Decision 7's own reasoning: a category
alone is still a useful report, and demanding writing from a nine-year-old
suppresses reports).

### 9.3 `screen` is picked by the player, not auto-captured — a deviation, argued

Decision 7's auto-capture allow-list includes "current screen identifier".
Against the real app, that is not implementable in a useful way:
`ProfileScreen` is reachable **only** from the Home tab's `AppHeader`, so
"the screen the player was on when they opened this form" is always `home`.
An auto-captured `screen` would be a constant, and a constant that *looks*
like a signal is worse than no signal.

So `screen` becomes a required picker: *"Var i appen hände det?"*. This is:

- **A reduction in capture, never an expansion** — the app now records
  nothing about where the child was; it records only what the child chose
  to tell us. That direction is always safe against the ADR's allow-list.
- **Still a genuine closed enum** — the picker's options are 1:1 with the
  Postgres enum, so the security-reviewer's `screen`-must-not-be-a-varchar
  fix is fully preserved. The client is not free to send anything else, and
  the DTO must still reject anything else.
- **Better triage data**, since the child names where the *problem* was,
  not where they happened to be standing when they found the report link.

**Flagged in §13/§14** so it's an explicit accepted deviation, not a
silent one.

**The enum, concretely** (10 values, picker order = this order):

```
home | chat | clips | clip_upload | goal | team | leaderboard
| profile | onboarding | other
```

`roster` from the ADR's illustrative list is folded into `team` (it's the
Team tab's own sub-screen and no child would distinguish them);
`clip_upload` and `leaderboard` are added because both are real, distinct,
frequently-broken surfaces (`UploadFlow`, `LeaderboardScreen`).

### 9.4 States

| State | Screen |
|---|---|
| `idle` | As §9.2, Skicka disabled. |
| `ready` | Category + screen chosen → Skicka enabled. |
| `submitting` | Skicka shows the existing `PrimaryButton` `loading` spinner; all inputs `editable={false}`. |
| `success` | → BR3. |
| `rate-limited` (`429` / `bug_report_rate_limited`) | Stays on BR2, toast: *"Du har skickat några rapporter idag redan. Testa igen imorgon."* Nothing is cleared — the child can come back tomorrow with the same text still typed if they don't leave the screen. |
| `too-long` (`400`, shouldn't happen) | Inline error under the textarea: *"Texten är för lång — korta ner den lite."* The 500-char cap makes this unreachable from this UI; handled because a stale client could hit it. |
| `generic-failure` / offline | Stays on BR2, toast `shared.genericErrorTryAgain` ("Något gick fel. Testa igen."), nothing cleared. |
| `cancel` | Back to Profile `view`, all in-progress input discarded, no confirmation prompt (nothing durable was created — same posture as E2's Avbryt). |

### 9.5 BR3 — success

```
┌─────────────────────────────────────┐
│                                     │
│                📨                   │
│                                     │
│             Tack!                   │
│                                     │
│  Vi har fått din rapport och tittar │
│  på den. Du behöver inte göra       │
│  något mer.                         │
│                                     │
│  [            Klart            ]    │
└─────────────────────────────────────┘
```

Deliberately makes **no promise of a reply** — there is no reply channel in
this design (Decision 7's `PATCH` updates status only; there is no admin
notes field and no message back to the child). Copy that implied "we'll get
back to you" would be a promise the system structurally cannot keep. Same
discipline as E5's "Trycker du inte på länken händer ingenting".

Reuses `ErasureCheckEmailScreen`'s exact icon/heading/body/single-CTA shape
— no new screen pattern for this.

---

## 10. i18n — concrete keys

### 10.1 Namespace and file

The entry point lives on `ProfileScreen`, which uses
`useTranslation('home')`. All new keys go in
`mobile/src/i18n/locales/{locale}/home.json`, following that file's existing
shape: one nested top-level object per feature (`erasureRequest`,
`erasureStatusCard`, …) plus one added leaf under `profileScreen.view`.

### 10.2 New keys, sv + en

| Key | Swedish | English |
|---|---|---|
| `profileScreen.view.reportProblem` | Rapportera ett problem | Report a problem |
| `bugReport.heading` | Något som inte funkar? | Something not working? |
| `bugReport.sub` | Berätta vad som hände så fixar vi det. | Tell us what happened and we'll fix it. |
| `bugReport.categoryLabel` | Vad hände? | What happened? |
| `bugReport.categories.crash` | Appen kraschade eller frös | The app crashed or froze |
| `bugReport.categories.missing_or_wrong_data` | Något saknas eller visas fel | Something is missing or looks wrong |
| `bugReport.categories.login_issue` | Jag kunde inte logga in | I couldn't sign in |
| `bugReport.categories.upload_failed` | Ett klipp gick inte att ladda upp | A clip wouldn't upload |
| `bugReport.categories.other` | Något annat | Something else |
| `bugReport.screenLabel` | Var i appen hände det? | Where in the app did it happen? |
| `bugReport.screens.home` | Hem | Home |
| `bugReport.screens.chat` | Chatt | Chat |
| `bugReport.screens.clips` | Klipp | Shorts |
| `bugReport.screens.clip_upload` | Ladda upp klipp | Uploading a clip |
| `bugReport.screens.goal` | Mål | Goal |
| `bugReport.screens.team` | Laget | Team |
| `bugReport.screens.leaderboard` | VM-Guld-tabellen | The leaderboard |
| `bugReport.screens.profile` | Din profil | Your profile |
| `bugReport.screens.onboarding` | När jag skapade kontot | When I set up my account |
| `bugReport.screens.other` | Vet inte / något annat | Not sure / somewhere else |
| `bugReport.descriptionLabel` | Vill du berätta mer? (frivilligt) | Want to tell us more? (optional) |
| `bugReport.descriptionPlaceholder` | T.ex. "Jag tryckte på Jag har tränat och då hände inget." | E.g. "I tapped I trained and nothing happened." |
| `bugReport.descriptionCounter` (`{{count}}`) | {{count}}/500 tecken | {{count}}/500 characters |
| `bugReport.descriptionTooLong` | Texten är för lång — korta ner den lite. | That's a bit too long — shorten it a little. |
| `bugReport.disclosureTitle` | Det här skickar vi med | What we send along |
| `bugReport.disclosureSent` | Ditt skärmnamn och ditt lag, vilken version av appen du har, vilken sorts telefon och vilket språk appen är på — plus det du valt och skrivit här ovanför. | Your screen name and your team, which version of the app you have, what kind of phone, and what language the app is in — plus what you picked and wrote above. |
| `bugReport.disclosureNotSent` | Vi skickar aldrig var du är, vilken telefon det är, din IP-adress eller vad du gjort i appen tidigare. | We never send where you are, which phone it is, your IP address, or what you've done in the app before. |
| `bugReport.disclosureWho` | Det går bara till oss som bygger appen — aldrig till någon annan i laget. | It only goes to us who build the app — never to anyone else on your team. |
| `bugReport.submit` | Skicka | Send |
| `bugReport.rateLimited` | Du har skickat några rapporter idag redan. Testa igen imorgon. | You've already sent a few reports today. Try again tomorrow. |
| `bugReport.successHeading` | Tack! | Thanks! |
| `bugReport.successBody` | Vi har fått din rapport och tittar på den. Du behöver inte göra något mer. | We got your report and we'll look at it. You don't need to do anything else. |
| `bugReport.successCta` | Klart | Done |
| `bugReport.a11yCategoryGroup` | Välj vad som hände | Choose what happened |
| `bugReport.a11yScreenGroup` | Välj var i appen det hände | Choose where in the app it happened |

Reused, **not** re-added: `shared.cancel` ("Avbryt"), `shared.retry`,
`shared.genericErrorTryAgain`.

### 10.3 i18n discipline

- `{{count}}` is the only interpolation; everything else is a whole
  sentence, so no layout depends on Swedish word order or string length.
- The disclosure block is **three separate keys**, not one paragraph with
  embedded newlines: `disclosureSent` / `disclosureNotSent` /
  `disclosureWho` are three distinct claims and some locales will want
  different sentence counts for each.
- The chip picker **wraps and grows**; no chip has a fixed width. German
  ("Beim Einrichten meines Kontos") is roughly 2.5× the Swedish for
  `screens.onboarding`, and a fixed-width chip row would break there
  first.
- The category radio rows are **multi-line-capable** (`numberOfLines`
  unset), for the same reason.
- The counter is `{{count}}/500 tecken` — the number and the unit word are
  in the key, so a locale that puts the unit elsewhere can.

### 10.4 The other six locales

`cs`/`fi`/`de`/`nb`/`da`/`fr` get the same keys via the
best-effort-AI-then-native-review pass this repo has used since
`clip-library-grid.md` — same flat/nested key shape, same `{{var}}`
convention, no new i18n machinery.

### 10.5 Decision 8's consent-page sentence — suggestion, not spec

Decision 8 asks for a disclosure addition to
`backend/src/consent/consent-page.templates.ts`'s existing copy. That file
is the subject of its own copy doc convention
(`docs/design/adr0018-tagging-disclosure-copy.md`, all 8 locales, both
`CONSENT_CONFIRM_COPY` and `SELF_VERIFICATION_CONFIRM_COPY`). Producing the
8-locale × 2-object set is a separate small copy deliverable, not folded in
here. **Suggested sv/en shape**, matching that doc's placement rule (append
to `body2`, one sentence, plain words, no new gate):

- **sv (parent-facing)**: *"Appen har också en knapp där ${safeName} kan
  rapportera om något inte fungerar — då skickas ${safeName}s skärmnamn och
  lag, information om telefonen och appen, och det ${safeName} själv skriver,
  till oss som utvecklar appen."*
- **en (parent-facing)**: *"The app also has a button where ${safeName} can
  report something not working — that sends ${safeName}'s screen name and
  team, information about the phone and the app, and whatever ${safeName}
  writes, to us who develop the app."*

---

## 11. Accessibility (desktop console)

The mobile screen inherits this app's existing patterns (`accessibilityRole`,
`accessibilityState`, the `a11y*` label keys in §10.2). The console is a new
context and needs its own notes.

**Keyboard**

- Everything actionable is a real `<button>`, `<a>`, `<input>`, or
  `<select>` — no `div` with a click handler anywhere. Tab order follows
  visual order: header → nav → filter bar → table/content → pagination.
- A **skip link** ("Skip to content") as the first focusable element,
  visible on focus. The four-item nav is short, but the error table's rows
  are not.
- **Visible focus ring everywhere**, 2px, `ink`, never removed. This is a
  keyboard-heavy tool; `outline: none` anywhere in this console is a bug.
- Nav: a `<nav>` with a `<ul>` of links; the current pillar carries
  `aria-current="page"`.
- AD2's expandable row toggle is a `<button aria-expanded="true|false"
  aria-controls="detail-<id>">`. Enter/Space toggle; the detail panel gets
  `tabindex="-1"` and receives focus on expand so the stack is immediately
  reachable.
- AD3's list is a listbox-like pattern: ↑/↓ move the selected report,
  Enter/click opens it in the detail pane, and the detail pane is in the
  natural tab order after the list. The list row's quick-action button is
  focusable, **never hover-only**.
- AD4's three tabs are a real tablist (`role="tablist"` /
  `role="tab" aria-selected` / `role="tabpanel"`), ←/→ to move, Home/End
  to jump.

**AD5's modal — the case that matters most**

- `role="dialog" aria-modal="true"`, labelled by its `<h2>`
  (`aria-labelledby`) and described by its body (`aria-describedby`).
- On open: focus moves to the **password input** (not the dialog container,
  not the first button) — the operator's only job here is typing.
- **Focus is trapped** for the modal's lifetime: Tab from Confirm wraps to
  the ✕, Shift+Tab from ✕ wraps to Confirm. Background content gets
  `inert` (or `aria-hidden="true"` + a focus guard) so a screen reader
  can't wander into the dimmed pillar behind it.
- **Esc closes** it, equivalent to Cancel — and closing **returns focus to
  the element that triggered the gated fetch** (the Planning nav item, or
  the tab, or the Unlock button), never to `<body>`.
- The error message is inside an `aria-live="assertive"` region **and**
  wired to the input via `aria-describedby` + `aria-invalid="true"`, so a
  wrong password is announced without the operator having to go looking.
- Success closes the modal and moves focus to the newly-rendered panel's
  heading, so a screen-reader user hears what unlocked.
- The dim/overlay is not the only cue: the dialog has a real border and
  elevation, for anyone with `prefers-reduced-transparency`.

**Data**

- Every table is a real `<table>` with a `<caption>` (visually hidden where
  a visible heading already exists), `<th scope="col">`, and a `<tbody>`.
- **Charts are never the only representation.** Every value in §4.3 is
  present as text on the same screen (bar labels or the adjacent table).
  Each chart container carries `role="img"` with an `aria-label` summarising
  it in one sentence ("Current streak histogram: 41 players at 0 days, 24 at
  1–3 days, …"), and the decorative SVG inside is `aria-hidden`.
- **Never colour alone.** Partial weeks are hatched *and* labelled;
  withheld buckets are hatched, greyed *and* carry the word "withheld"; the
  planning trust badges have text, not just an outline colour.
- Result counts and status changes are announced through
  `aria-live="polite"` regions ("Showing 50 of 231", "Saved").
- Timestamps render as `<time datetime="…">` with a visible Europe/Stockholm
  rendering and the ISO value in the attribute.
- `prefers-reduced-motion`: no spinner rotation, no skeleton shimmer —
  static placeholders instead.
- Body text ≥13px, line-height ≥1.45; contrast checked against §1's tokens
  (`textMuted` on `white` = 5.1:1, passes AA at 13px; `--withheld` on
  `white` = 3.1:1, so it is **never used for text that carries meaning on
  its own** — the word "withheld" itself renders in `textMuted`, and
  `--withheld` is used for the hatch fill and the row tint only).

---

## 12. Layouts this doc deliberately did not draw

Named explicitly, per the brief, because each is the kind of thing that
looks like an obvious next feature and would be a design bug:

1. **A clickable statistic.** No bar, tile, funnel segment, or bucket row
   on AD1 is a link. Making the "58% trained in 7 days" tile clickable
   would imply a list of the other 42%, which does not and must not exist.
2. **A "teams needing attention" / "least active teams" list.** The single
   most natural product instinct here, and a direct violation of ADR-0020
   Decision 3 — it is a per-team ranking by definition.
3. **A team or player search box, anywhere in the console.** Including in
   AD3, where the reporter's screen name *is* on screen: no search field,
   no filter, no "find other reports by this player". §6.3.
4. **A "bug reports per team / per player" chart.** Decision 5 names this
   exact anti-pattern — it would reintroduce a per-player breakdown through
   a different table without touching `UsageMetricsService` at all.
5. **A link from AD3's reporter block into AD1**, or vice versa. The two
   pillars share no navigation, no filter state, and no identifier.
6. **A total-teams KPI tile.** Withheld, matching the email — §4.1, and
   raised as an open question in §14 (along with the residual that the
   "active team pots" KPI already bounds it from below) since the project
   owner's own request said "how many users, teams".
7. **A player or team column on AD2.** There is no such column in
   `ErrorLogEntry`; rendering an empty or greyed one would imply otherwise.
8. **An admin user list / invite / "manage admins" screen.** Phase 7 is one
   operator, structurally (Decision 2). ADR-0023 changes this; this doc
   does not pre-build it.
9. **An edit/save affordance on AD4.** Read-only for v1 (Decision 10);
   §7.4.
10. **A raw-file browser or download link for the planning docs.** The
    security-reviewer's applied fix requires the ConfigMap mount to be
    disjoint from any statically-served directory — a "download the raw
    markdown" button in the UI would be building back the exact bypass that
    fix exists to prevent.

---

## 13. Flagged for others, not decided here

**backend-developer**

- **`GET /api/v1/admin/usage-metrics`'s DTO must omit `totalTeams`** —
  structurally, not just "the UI doesn't render it" (§4.1). Its own
  docstring already gives the reason for the email; a browsable view makes
  it stronger.
- **The same DTO must include `foldedIntoAppWide` and `minTeamsPerBucket`**
  per metric/report — without them AD1 cannot distinguish "withheld" from
  "no teams", which is §4.4's whole point.
- **Optional, not required for v1: `withheldBuckets: TeamSizeBucket[]` on
  `TeamSizeBucketedMetric`.** Derivable inside
  `UsageMetricsService.applyFloor` as `nonEmpty` minus `reported`; **labels
  only, never counts**. It is the minimum field that would let AD1 name
  which bucket was withheld instead of saying "one or more", and let state
  A positively say the unlisted buckets were empty. §4.4 is specified to be
  correct and complete *without* it — build the field only if the naming is
  actually wanted.
- **Two config values the console needs in order to render its own copy
  honestly**: the `ErrorLogEntry` retention cutoff (`{retentionDays}`) and
  the stack-truncation frame count (`{maxFrames}`). Both are config knobs
  in ADR-0022 Decision 6, not fixed facts, so the console must read them
  (a field on the `/admin/errors` response, or the recommended
  `/admin/auth/session` payload) rather than print a literal — see §2's
  standing copy rule.
- **A small `GET /api/v1/admin/auth/session` → `{ displayName,
  authenticatedAt, environment }`** (behind `AdminAuthGuard`) would let the
  console (a) know it's signed in on first paint without firing a
  data request and interpreting a 401, (b) render the "Signed in as"
  identity chip and AD5's read-only username line, and (c) render §2's
  environment badge. Additive, exposes nothing new, and it's the natural
  seam for ADR-0023's SSO identity later. Not designed in the ADR.
- **The `planning/*` responses should carry a `syncedAt`** (the ConfigMap
  file's mtime is enough) so §7.6's staleness warning is possible. Silent
  staleness is the built-in failure mode of a hand-applied ConfigMap.
- **`/planning/roadmap` should return its two halves already grouped, with
  a source label and any section headings**, rather than one flat list the
  console has to re-split. Per ADR-0022's 2026-08-07 amendment both halves
  now come from the same ConfigMap at the same trust level, so the grouping
  is purely presentational (§7.2) — but the console must not re-derive it,
  and must not re-filter or re-parse checkbox syntax client-side. Which
  lines in `ACTION_PLAN.md` count as open is the parser's problem (the
  amendment's own "Next Up" / numbered-`N. [ ]` / ignore-backticked-literal
  constraints), and this view renders whatever it is handed.
- **The step-up `POST` shares the login route's per-IP throttle.** Repeated
  step-up failures can therefore lock the operator out of ordinary sign-in.
  Either give the step-up path its own bucket, or accept it knowingly —
  §8.3 handles it in the UI either way, but the operator-lockout shape
  should be a deliberate choice.
- **Confirm `PATCH /admin/bug-reports/:id` accepts any target status**
  (§6.4). If it's forward-only, the UI disables earlier segments rather
  than failing on click.
- **`GET /admin/bug-reports` must not return `real_name` or
  `parent_contact`** — screen name + team only (§6.3). Also confirm the
  list response carries per-status counts, or AD3's chips show no numbers.
- **The escaping guarantee covers the reporter's screen name and team
  name too**, not just `description`/`app_version`/`os_version` — neither
  has any charset validation in `backend/src` today
  (`create-player.dto.ts:59-62, 92-97`), so both are stored-XSS carriers
  into a page that holds the admin session (§6.2).
- **Confirm `POST /api/v1/bug-reports` is *not* consent-gated** (no
  `assertConsentApproved`) — BR1 renders for pending-consent players by
  design (§9.1), and the two must agree.
- **Error code naming** for BR2's rate limit (this doc assumes an
  `ApiError.code` of `bug_report_rate_limited`, matching
  `erasure_rate_limited`'s existing shape).
- **`Retry-After` on the login/step-up `429`** would let AD0/AD5 show a
  real wait instead of a generic "wait a minute".
- **The `screen` enum's 10 values** (§9.3) need to match the Postgres enum
  exactly, including `clip_upload`/`leaderboard` and the omission of
  `roster`.

**frontend-developer**

- `ProfileScreen`'s `ProfileView` union gains `bugReport` and
  `bugReportSent`; no new props are needed (the form sends no team/player
  data — the server derives it from the session).
- `app_version`/`os_version`/`platform` come from Expo's own constants; no
  new native permission and no new dependency should be introduced for
  this. If any of the three isn't cleanly available, send `null`/omit
  rather than adding a device-info library — the field's absence is
  strictly better than a library that also reads an identifier.

**security-reviewer** (if a follow-up pass is wanted on this doc)

- §9.3's `screen`-is-picked-not-auto-captured deviation (a reduction in
  capture, but a deviation from Decision 7's wording).
- §6.3's reporter-identity rules — whether "screen name + team name, detail
  pane only, no filter/search/link" is the right boundary, or whether team
  should be an id.
- §9.1's ungated-by-consent entry point.
- §6.2's widening of the escaping guarantee to the reporter identity
  fields — this was a real hole in the original ADR fix's field list, and
  is worth confirming nothing else in this console renders an unvalidated
  user string that this doc still missed.

**Plausible additive follow-ups, deliberately not designed**

- Free-text search and real server-side sorting on AD2 (§5.3); an
  aggregated "top errors by route + name" view for triage.
- A second bug-report entry point on the generic retry/error state (§9.1).
- ADR-0022 Decision 4's optional "N new errors, N new bug reports" digest
  line in the existing monthly email — it would need one sentence of copy,
  not a design.

---

## 14. Open questions for the project owner

These need a decision only the project owner can make; the rest of this doc
is designed around them and none of them blocks starting the build.

1. **Should the console show a plain app-wide team count?** The original
   request said *"see how many users, teams"*, but the shipped
   `UsageMetricsReport.totalTeams` is deliberately never rendered, because
   printing it alongside the team-size buckets makes a withheld bucket
   derivable by subtraction. Three options: **(a)** keep it withheld
   everywhere, exactly as the monthly email already does — this doc's
   recommendation and what §4.2 draws; **(b)** show it *only* when no
   team-size bucket rows are displayed at all (safe arithmetically, but a
   KPI tile that appears and disappears between loads is genuinely
   confusing); **(c)** show it always and drop the team-size breakdowns
   entirely, trading a cross-section for a headline. Not guessed here.
   **One thing to weigh whichever way this goes, stated rather than left
   unmentioned:** the "active team pots" KPI (§4.2) is
   `teamPoolGrowth.activePotCount`, and at beta scale that is already a
   tight *lower* bound on the team count — with 11 pots shown and buckets
   3–5:7 / 6+:2 printed, the residual available to a withheld '1–2' bucket
   is at most 2. So option (a) does not fully close the subtraction path;
   it only removes the exact figure. This is **mirrored, not introduced**
   by this design — the shipped monthly email already prints both numbers
   on the same page (`usage-report-sections.ts:159` and `:198`) — but if
   the answer to this question is "the arithmetic matters", the pot KPI is
   part of it and dropping `totalTeams` alone would be a false sense of
   closure.
2. **Console language: English-only, or all 8 locales?** Recommendation:
   **English-only**, argued rather than asserted. *For:* the console has
   exactly one reader, who reads English fluently (this repo's code, ADRs,
   `ACTION_PLAN.md` and commit messages are all English by CLAUDE.md's own
   default); every string on it is a technical operator term (`route
   template`, `status code`, `bucket`, `stack`, `triaged`) whose Swedish
   equivalents would be either loanwords or worse; and the alternative
   costs **8 new locale files plus a translation-review pass for every
   future console string**, permanently, for a single reader. *Cost, stated
   honestly:* (i) it makes the console the one product surface not covered
   by the app's i18n discipline, so a future second operator who doesn't
   read English needs the whole thing retrofitted; (ii) copy quality on an
   English-only surface tends to drift, because no translation pass ever
   forces a re-read. **Mitigation that makes the cost cheap either way, and
   which this doc's copy tables are already written for:** put every console
   string in a single `strings.ts` map keyed exactly as §3.3/§4.6/§5.5/
   §6.6/§7.7/§8.4 name them, rather than inline in markup — an i18n
   retrofit then becomes "add a second map", not "find every string". If the
   project owner would rather the console be Swedish, say so now: the keys
   are designed to survive it, but the tone would want a real pass, not a
   translation of these tables.
3. **Should a pending-consent child be able to submit a bug report?** This
   doc says **yes**, ungated (§9.1) — the child stuck waiting for approval
   is the one most likely to need to report something, and Decision 7
   specifies plain `JwtAuthGuard`. The residual, stated plainly: a child's
   freeform text reaches the developer before a parent has approved
   anything at all. The alternative (gate BR1 on consent) is defensible and
   costs one line, but it silences exactly the reports that matter most.
4. **Should the step-up factor be TOTP instead of the same password?** The
   2026-08-02 security-reviewer pass strongly recommends TOTP and shows why
   a second password prompt adds nothing against the threat Decision 10
   itself names (a compromised credential). ADR-0022's "Left open" section
   says this "should be resolved before those endpoints ship." §8.4 keeps
   AD5's layout factor-agnostic so either answer lands without a redesign —
   but the answer is the project owner's, and it changes three strings.
5. **Bug-report reporter identity: screen name + team name, or screen name
   + team id?** Decision 7 justifies carrying identity for reproduction.
   Team *name* is more useful to a human and slightly more identifying;
   team *id* is enough to look up in `psql` if it ever actually matters.
   §6.3 currently draws the name.

---

## 15. Implementation checklist

- [ ] AD0 shows one identical error for a wrong username and a wrong
      password; the two cases are indistinguishable in the UI and in
      timing-independent copy.
- [ ] AD0's form is a real `<form>` with `autocomplete="username"` /
      `"current-password"`; Enter submits; a password manager can fill it.
- [ ] A `401` on any authenticated view returns to AD0 with the
      session-expired notice **and** returns to the same pillar after a
      successful sign-in.
- [ ] AD1 renders all four §4.4 states with distinct copy and no blank cell
      or zero bar: **D** zero teams; **C** teams exist but no bucket clears
      the floor; **B** some buckets printed, `foldedIntoAppWide: true`;
      **A** some buckets printed, `foldedIntoAppWide: false` — including
      the specific "every team has 6+ eligible players" case
      (`byTeamSizeBucket: [{'6+', N}]`, `folded: false`), which must render
      **one row and no suppression notice at all**.
- [ ] No absent bucket ever gets a `▨ withheld` placeholder row, and no
      string on the page asserts that an unlisted bucket contains teams
      (§4.4's constraint — the data cannot support that claim).
- [ ] The suppression notice never states a single reason (it must be
      correct for both suppression causes — §4.4's note 2).
- [ ] `{min}`, `{days}`, `{retentionDays}` and `{maxFrames}` are all
      interpolated from server/config values — grep the console's strings
      for a literal `5`, `90` or `20` in operator-facing copy (§2's
      standing copy rule).
- [ ] `totalTeams` appears nowhere in the network response, not just
      nowhere on screen.
- [ ] No element on AD1 is clickable except `Refresh`.
- [ ] AD2 renders a job row (no method, no status), an unmatched-route row
      (`(unmatched)`), and a 20-frame stack without the table losing its
      shape.
- [ ] AD2's empty-never and empty-filtered states use different copy.
- [ ] AD2 has no player/team column and no search box.
- [ ] AD3 renders a report whose `description` is `<script>alert(1)</script>`
      as visible literal text, and the same for `app_version`, `os_version`,
      **the reporter's screen name, and the team name** — register a test
      player whose screen name is `<img src=x onerror=alert(1)>`, file one
      report from it, and open the detail pane. Check the list row's
      `title=` attribute too.
- [ ] AD3 renders a report with no description at all (block omitted, not
      empty).
- [ ] AD3 has no reporter column, no reporter filter, and no link out of the
      reporter block.
- [ ] AD3's status change persists, announces "Saved" politely, and does not
      make the row vanish from under the cursor.
- [ ] AD3 handles a `404` on `PATCH` (reporter erased mid-session) with its
      own copy, not the generic error.
- [ ] AD4's two roadmap sources render as two visibly separate groups with
      neutral **shape** labels, and no badge anywhere claims a trust level
      or a tracking status — all four sources arrive on the same ConfigMap
      (§7.2).
- [ ] AD4's banner states, on every tab, that everything in this pillar is
      internal ConfigMap-delivered content.
- [ ] AD4 has no interactive checkbox, no edit control, and no raw-file
      download.
- [ ] Leaving AD4 clears the fetched planning content from the DOM.
- [ ] AD5 opens over the preserved pillar, replays the pending request on
      success, and lands on the tab that triggered it.
- [ ] A wrong password in AD5 keeps the operator signed in; the modal stays
      open; Cancel returns to a fully working console.
- [ ] A plain `401` during a step-up attempt goes to AD0, not to AD5's error
      state.
- [ ] AD5 traps focus, opens focus on the password field, closes on Esc, and
      returns focus to the trigger.
- [ ] Every console table is a real `<table>` with headers; every chart has
      an `aria-label` and a text/table equivalent on the same screen.
- [ ] Nothing in the console conveys meaning by colour alone (withheld,
      partial week, trust badge).
- [ ] BR1 appears on Profile for a player whose consent is still pending.
- [ ] BR2's Skicka stays disabled until both category and screen are chosen;
      description stays genuinely optional.
- [ ] BR2 sends exactly the eight allow-listed fields — verify on the wire
      that no location, device id, IP, or action trail is attached.
- [ ] BR2's disclosure block names what is **not** sent, in words, above the
      submit button — not behind a tap-to-expand.
- [ ] BR2's rate-limited and generic-failure states keep the typed text.
- [ ] BR3 promises no reply.
- [ ] All new copy renders without clipping in `de` and `fi` (the longest of
      the eight for these strings) — chips wrap, radio rows grow.
