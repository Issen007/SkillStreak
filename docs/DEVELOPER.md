# DEVELOPER.md — the codebase, explained by a human route through it

For someone who has been handed this repository and has to work in it.
Not a reference — the ADRs are the reference, and there are thirty-four of
them. This is the thing to read first so that those thirty-four make sense
in an order.

[docs/DEVELOPMENT.md](DEVELOPMENT.md) covers getting it running. This
covers what you are looking at once it does.

---

## The one thing that explains most of the odd decisions

The users are children, roughly 9–13.

That sounds like a product fact and is really an engineering constraint,
because it removes options that are otherwise automatic. You cannot reach
for an analytics SDK, a crash-reporting SaaS, a hosted media service, or a
third-party AI vision API — not because someone dislikes them, but because
each one puts a child's data in front of a party that has not been
assessed, and the app's whole promise to a parent is that this does not
happen.

So a surprising amount of this codebase is *the boring version of a solved
problem, built in-house*. Error tracking is a Postgres table. Analytics is
a Postgres table. Media is self-hosted MinIO. When you find yourself
thinking "why didn't they just use X", that is usually the answer, and the
ADR for it will say so.

The four rules that are non-negotiable, in CLAUDE.md and repeated here
because they will shape your first change:

1. **No location data. Ever.** Not "not yet" — there is no code path.
2. **Closed team bubbles.** A player sees only their own verified team.
   The one deliberate exception is a player's own clips, published only
   while that player's own parent holds an active sharing consent
   (ADR-0030).
3. **Screen names, not real names**, and real names are isolated in their
   own table.
4. **A parent approves before any media upload**, per child.

If a change of yours weakens one of these, the expectation is that you say
so out loud rather than quietly ship it.

---

## The map

```
backend/     NestJS API + the admin/trainer console it serves itself
mobile/      Expo / React Native app (iOS, Android, and a web export)
site/        Static marketing site (nginx, two vhosts, no build step)
ai/          clip-tagger — the only Python service
k8s/         Production cluster manifests
k8s-ai/      The separate GPU cluster's manifests
tools/       Local ops scripts that are not part of the product
docs/adr/    Why anything is the way it is
```

Two clusters, deliberately (ADR-0028): the app runs on one, GPU inference
on another. A video analyser is a workload that will OOM and get
restarted, and it must not be able to take the streak app down with it.

---

## backend/ — where to start reading

NestJS, TypeScript, Postgres via TypeORM, Redis for anything rebuildable.
About 364 source files and 97 spec files.

**The division of Postgres and Redis is a rule, not a preference**
(ADR-0002): Redis holds streaks, leaderboards and rate limits — all of
which can be recomputed — and is **never the only copy of anything**. If
you find yourself putting the sole record of something in Redis, that is
the bug.

Modules are one directory each under `src/`, and most are unremarkable.
These are the ones worth reading before you touch anything:

| Module | Why it matters |
|---|---|
| `training-logs/` | The core loop. `points.util.ts` holds the evidence-tier multipliers (ADR-0025) — points scale with how well a session is evidenced, not how long it is claimed to be. |
| `video-clips/` | Upload, the metadata-strip remux, retention. Every clip's bytes are unreachable outside the uploader's team at two independent layers, not one. |
| `public-sharing/` | ADR-0030's revocable consent. The most carefully argued module in the repo, and the one where a mistake is worst. |
| `account-erasure/` | GDPR erasure, including the "last player on the team" cascade. |
| `error-log/` | Crash and failed-job visibility. Notable for what it refuses to hold. |
| `staff-auth/` | SSO for coaches and admins. A completely separate cookie and secret universe from the player JWT — never mix them. |
| `common/errors/` | Every exception class. Worth skimming once; the naming carries meaning the wire format deliberately does not. |

### The console is not what you expect

`backend/console/` is a hand-written `app.js` with no bundler, no
framework, and no build step, served by the API itself. That is
deliberate: the `staff_session` cookie is `SameSite=Strict`, so the
console only authenticates at all when it is same-origin with the API.

Practical consequence: **no CDN scripts and no npm packages in there.**
When the analytics tab needed graphs, they were hand-drawn SVG.

### Migrations

46 of them in `src/database/migrations/`, run explicitly — never
`synchronize: true`. They run under a Postgres advisory lock
(`scripts/migrate-with-lock.ts`) because more than one replica starts at
once.

**Run them locally before you believe a schema change works.** A change
that compiles, passes tests, and builds a Docker image can still fail
`migration:run`, and that has happened here.

---

## mobile/ — Expo, and one thing that will surprise you

There is **no navigation library**. `AppRoot.tsx` is a small state machine
(`checking-session` → `onboarding` → `home`), and `AppShell.tsx` owns the
tab bar. For an app this size that is less machinery, not more — but if
you arrive expecting React Navigation, this is why you cannot find it.

`src/api/` is the whole server boundary. `client.ts` is the fetch wrapper;
everything else is typed endpoints on top of it.

**i18n is nine locales with a parity check in CI.** Adding a user-facing
string means adding it to all nine — `sv`, `en`, `da`, `nb`, `fi`, `de`,
`fr`, `es`, `cs` — and the keys are typed, so `tsc` will catch a missing
one before the checker does.

### Know which mobile checks can block you

Only `Mobile typecheck` is required in CI. `Mobile lint`,
`Mobile expo-doctor` and `Mobile build drift` are advisory and **cannot
fail a merge**, so run them yourself:

```bash
cd mobile && npx tsc --noEmit && pnpm lint
```

`Mobile lint` is deliberately two rules rather than a rule set.
`react-hooks/rules-of-hooks` errors, because breaking it is a crash — two
hooks below an early return once took the Shorts tab out on every open,
through a `tsc`-clean TestFlight build. `exhaustive-deps` only warns.

`Mobile build drift` answers a question nothing else can: whether the code
in `mobile/` has run ahead of any app a person can actually install. CI
builds and deploys the API on every merge and has never built the app, so
the two drift silently. It once caught the installed build being three
days and eleven commits stale.

---

## How a change reaches a user

Three destinations, and they move at completely different speeds. Knowing
which one your change is on is most of avoiding the mistakes this project
has actually made.

| What | How it ships | How fast |
|---|---|---|
| **API + site** | Merge to `main` → CI builds, versions, deploys | Minutes |
| **Mobile app** | An EAS build, then a store review | Days |
| **The site's static content** | Same as the API | Minutes |

**The app is the slow one, and nothing automates it.** A backend change
merged this morning is live this morning. A mobile change merged this
morning is live whenever someone runs an EAS build and Apple approves it.
Several confident "it's shipped" reports in this project's history were
about code that was only ever in the repo.

### The branch rule

`review` is the single integration branch. Feature branches merge into
`review`. **Nobody merges to `main` except the project owner**, via a PR,
once a day in the morning — except a security fix, which does not wait.

Merging to `main` auto-versions: `+0.0.1` per merge, cascading at 9, so
`v0.0.9` → `v0.1.0`. It is a release counter in base 10, deliberately
**not** semver, and carries no compatibility meaning. Do not "fix" it to
`v0.0.10`.

### Ask the running thing, not the repo

Every image is stamped with what it was built from, and `GET /health`
returns it:

```bash
curl -s https://api.skillstreak.xyz/health
```

Use it. On 2026-07-30 production's site pod served an internal-LAN-built
image for a stretch, and real visitors to the "get the app" page saw a
`192.168.55.x` address. CI had built both images correctly; something
outside CI pointed production at the wrong one. Nothing in the repo could
have told you.

The same instinct applies to `kubectl`: **always pass
`--context=skillstreak`.** The default context on the owner's machine is a
different project entirely, and the wrong cluster looks identical and
reports success.

---

## Environment parity

There are exactly two deployments: **production** (`main`, real domains)
and **internal test** (`review`, LAN-only `192.168.55.x`, no public DNS or
TLS).

Any change touching a URL, hostname, QR code, deep link or CORS origin has
to be correct in both. The existing mechanism is **build-time, not
runtime**: CI builds separate images per environment with different build
args, and backend config comes from each cluster's own ConfigMap. Extend
that pattern rather than adding runtime detection alongside it.

---

## Testing

```bash
cd backend && pnpm test        # ~1200 unit tests, a few seconds
cd backend && pnpm lint
cd mobile  && npx tsc --noEmit && pnpm lint
```

The house style for a test is worth naming, because it is unusual and it
is load-bearing: **prove the guard by reintroducing the bug it catches.**
When a fix lands, the test for it is verified by reverting the fix and
watching the test fail. A test that passes against both the broken and the
fixed code has told you nothing, and several in this repo were written
after discovering exactly that.

---

## Where the reasoning lives

`docs/adr/` — 34 records, one per decision, including the ones where the
answer was no. They are unusually long for ADRs on purpose: most of them
exist because the obvious answer was unavailable, and the value is in the
argument rather than the conclusion.

If you only read four:

- **ADR-0002** — the data model, and the Postgres/Redis split.
- **ADR-0010** — video storage. Why MinIO rather than a media SaaS, and
  the two-layer access control.
- **ADR-0022** — the admin console, and Decision 6's error log. The
  clearest example of the "what a table refuses to hold" style of
  reasoning this codebase uses.
- **ADR-0030** — revocable public-sharing consent. The most subtle rules
  in the app.

`CLAUDE.md` at the repository root is written for an AI assistant and is
also, in practice, the most current summary of the project's rules — the
branch policy, the constraints, the incidents worth knowing about. Read it
even though it is not addressed to you.

---

## Things that have gone wrong here, so you can recognise them

Each of these cost real time and each looked fine from wherever it was
checked:

- A PR reported merged that was still open. The owner merges in the GitHub
  UI and cannot merge what has no PR.
- A mobile app three days and eleven commits behind any installable build,
  while the API deployed on every merge.
- An SMTP secret correct in GitHub Actions and absent from the cluster,
  for three deploys.
- Production serving the internal-test image.
- A mailed consent link that 404'd, because a file name had been written
  into the URL path. Nobody clicked it until a parent did.
- A config `<script>` on the marketing site that was a syntax error, so
  every API call the page made went to `undefined/...` — while the page
  answered 200 throughout and monitoring said "up".

The pattern is one thing: **the repository and the running artifact
disagreeing, silently.** When something is reported broken and the code
says it is fine, believe the report and go ask the running thing.
