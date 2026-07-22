# Backend (`backend/`)

NestJS (TypeScript) API for SkillStreak — see the repo root
[`CLAUDE.md`](../CLAUDE.md) for full project context/constraints and
[`docs/ACTION_PLAN.md`](../docs/ACTION_PLAN.md) for the live phase-by-phase
status. This file is a map for a new contributor: what lives where, how to
run it locally, and where the actual decisions/contracts are written down
(this file deliberately does not duplicate those — see the pointers below).

## Module map

Each module below is a NestJS module under `src/`. "Dormant" means the code
exists (schema, entity, or logic) but has no live, reachable endpoint today —
flagged so you don't build on top of it without first checking whether the
surrounding decision has changed.

| Module | Purpose |
|---|---|
| `auth/` | The player session JWT: issuing (`PlayerTokenService`), verifying + `token_version` revocation check (`JwtAuthGuard`). One JWT universe for players; there is no separate coach-auth JWT universe (see `teams/entities/team-coach.entity.ts` and `coaches/` below). |
| `players/` | The `Player` entity/table and everything safe to read/write about a player *without* touching PII — screen name, avatar, streak counters, consent status, captain flag, session-reissue fields. Never imports `player-private-info/` (hard boundary, see that module). Owns the shared `assertTeamMembership`/`assertIsCaptainOfTeam` checks every Phase 2 team-scoped endpoint calls. |
| `player-private-info/` | The *only* module allowed to hold `real_name`/`parent_contact` (`PlayerPrivateInfo`) and the append-only consent audit trail (`ParentalConsentRecord`). Narrow, purpose-specific methods only — never a bulk/leaderboard-shaped read. |
| `onboarding/` | `POST /players` — creates the player "shell" row, the private-info row, and the initial consent record/token, all in one transaction; one of only two modules allowed to depend on both `players/` and `player-private-info/` (the other is `consent/`). Since ADR-0009 (Fas 2.9), also resolves self-service team creation when `inviteCode` matches nothing and `teamName` is supplied — see `teams/`'s `createTeam` and `team-pool/`'s `createInitialSeasonAndPot`, both called from inside this module's transaction. |
| `consent/` | The parent-facing consent-approval link (`GET`/`POST /consent/:token`, no auth, no side effects on GET) and the captain-facing "resend a reminder" action. Shares the mail template with `onboarding/`. |
| `teams/` | The `Team` entity (invite-code lookup only — no public team listing/search, per the "closed team bubbles" constraint) and the dormant `TeamCoach` join entity. `TeamsService.createTeam` (ADR-0009) is the single entry point for creating a `Team` row anywhere in this codebase — checks `name`/`inviteCode` against `moderation/`'s `ChatModerationCheck` before saving, called only from `onboarding/`'s transaction. |
| `moderation/` | Owns *only* the `CHAT_MODERATION_CHECK` DI binding (ADR-0009 Decision 5) — extracted out of `team-chat/` so `teams/` can reuse the same content-safety check without importing all of `team-chat/`'s unrelated entities/imports. The interface/implementation/wordlist themselves stay in `team-chat/`, unmoved. |
| `coaches/` | Just the `Coach` entity. **Dormant** since Phase 2's kapten pivot — no coach login, no coach-facing endpoint anywhere reads/writes it; only `scripts/seed.ts` still creates one row to satisfy a foreign key. See that entity's file comment before building anything new against it. |
| `team-pool/` | The team-wide, season-long point pool (`TeamSeasonPot`, `Season`) — Postgres is authoritative, atomic `increment()` writes, Redis only caches the gauge. Deliberately separate from individual streak logic (different reset rules/storage), per `CLAUDE.md`. Season/pot creation is otherwise still seed-only (no rollover UI exists yet); `createInitialSeasonAndPot` (ADR-0009) is the one non-seed exception, called only from `onboarding/`'s self-service-team-creation path. |
| `video-clips/` | Fas 3's team video-clip feed — `VideoClip`/`ClipReport` entities + migration, all 5 `docs/api/phase3-contract.md` endpoints (presigned upload-url/complete/feed/delete/report), `ObjectStorageService` (the MinIO S3-API client: presigned PUT/GET, HEAD, delete-if-exists, a best-effort bucket max-object-size policy — see that service's own comment for a verified MinIO limitation), `VideoProcessingService` (shells out to `ffmpeg`/`ffprobe` for the mandatory metadata-stripping remux at `complete` — the only place in this codebase that invokes an external binary), and `ClipRetentionService` (`@nestjs/schedule` `@Cron` jobs: the daily 90-day-default expiry sweep + the hourly `pending_upload` TTL sweep, sharing one mechanism parameterized by status/cutoff). `PlayerPrivateInfoModule` is imported here as this module's *third* legitimate caller of `getParentContact` (ADR-0010's documented widening, after `onboarding/` and `team-chat/`). `TeamChatBlock`/`TeamCoach`/`Coach` are registered directly via `TypeOrmModule.forFeature` (not a full module import) — the feed query's block-filter and the report-notification coach-email lookup, same "grab just the entity" precedent `team-chat/` already set for `Coach`/`TeamCoach`. See `docs/adr/0010-video-storage-and-serving.md`/`docs/api/phase3-contract.md`. |
| `training-logs/` | The "Jag har tränat" write path — `POST /training-logs`. The one Postgres transaction that touches streak fields, the team pool, and (since Phase 2) the goal-completion bonus check, then updates Redis after commit. See `training-logs.service.ts`'s class comment for the write-order contract. |
| `weekly-goal/` | "Veckans mål" — the captain-authored weekly team goal, its CRUD/state machine, team-wide progress aggregate, dashboard, and roster. Reuses the `challenges/` `Challenge` entity/table rather than a new one. |
| `challenges/` | Just the `Challenge` entity (table name unchanged from an earlier "coach challenge" design; the product language is "weekly goal" now — see `weekly-goal/`). |
| `session/` | `Player.token_version` bump + a human-typable one-time reissue code, for a captain to help a teammate who lost their session. **Both routes are currently disabled** (503) — see "Session reissue" below. |
| `badges/` | `Badge`/`BadgeAward` entities + the `BadgeAwardContext` DTO boundary (a constrained discriminated union, not freeform JSON). **Dormant** — no award endpoint exists yet in either Phase 1 or 2. |
| `mail/` | SMTP wrapper (Google Workspace relay by default), degrades to a logged no-op if unconfigured. `mail/templates/` holds the actual email copy. |
| `redis/` | Thin wrapper around the `ioredis` client — every key here is a cache/accelerator over Postgres, safe to lose and rebuildable (`scripts/rebuild-redis-cache.ts`). |
| `common/streak/`, `common/time/` | Pure, DB-free functions: the streak-transition rule and the Europe/Stockholm calendar-day helpers everything else builds on. |
| `common/errors/` | The `AppException` base class + every domain exception, and the filter that normalizes all of them (plus stock Nest `HttpException`s) into one `{ error: { code, message } }` envelope. |
| `database/`, `config/`, `redis/` (module wiring) | TypeORM/Postgres setup + migrations, env-var validation, Redis client wiring. |
| `health/` | `GET /health` — liveness only. |
| `scripts/` | `seed.ts` (idempotent local fixture data), `rebuild-redis-cache.ts`, `verify-smtp.ts`, `send-test-consent-email.ts` — see "Running locally" below. |

### Dormant/disabled features, at a glance

- **Coach auth / coach dashboard** (`coaches/`, `teams/entities/team-coach.entity.ts`) — superseded by Phase 2's kapten pivot. Kept only because the schema already exists and a coach-facing view is plausible again later. See `docs/adr/0004-coach-auth-and-session-reissue.md`'s 2026-07-05 addendum.
- **Badges** (`badges/`) — schema + DTO boundary exist, no award endpoint. `BadgeTriggerReason.COACH_MANUAL_AWARD` specifically assumes a coach identity that doesn't currently exist — see that enum's file comment.
- **Session reissue** (`session/`) — implemented and then deliberately disabled after a confirmed security-review finding (the reissue code, once generated, can be redeemed by *anyone*, not just the intended teammate — full impersonation, not just a leak). Both routes return `503 session_reissue_disabled`. The underlying `SessionService`/`token_version`/single-use-code mechanism is intentionally left intact for a future redesign that binds redemption to the target player. **Do not re-enable these routes without that redesign** — see `docs/ACTION_PLAN.md`'s Phase 2 section and `SessionReissueDisabledException`'s comment for the full finding.
- **`Challenge.challenge_id` tagging on `TrainingLogEntry`** — the column/DTO field exist but nothing reads them; weekly-goal progress is computed live from `(team_id, logged_at, activity_type)`, not per-log tagging (ADR-0005 Decision 2).

## Running locally

The root [`README.md`](../README.md) has the full "clone and go" walkthrough
(Docker Compose, Expo, screenshots). Backend-specific detail:

```bash
# from the repo root
cp .env.example .env
cp backend/.env.example backend/.env
docker compose up -d --build
```

This builds the API image, starts Postgres 18 + Redis + MinIO (Fas 3's
video-clip object store, `docs/adr/0010-video-storage-and-serving.md`),
and runs pending TypeORM migrations automatically via
`docker-entrypoint.sh` (migrations only — **not** the seed script,
deliberately, see that entrypoint's comment). `backend/Dockerfile`'s
runtime image also installs `ffmpeg`/`ffprobe` (required, not optional —
the mandatory metadata-stripping remux at `POST .../clips/:clipId/complete`
shells out to both). Seed a team + invite code + captain player
separately:

```bash
docker compose exec api node dist/scripts/seed.js
```

Other scripts (see `package.json`, all runnable via `pnpm run <script>`
inside `backend/` for local non-Docker dev, or `docker compose exec api
node dist/scripts/<name>.js` against the running container):

- `migration:generate` / `migration:run` / `migration:revert` — schema
  changes always go through a migration, never a manual edit against a
  running schema (per `CLAUDE.md`). See any file under
  `src/database/migrations/` for the "hand-trim the generator's FK-drift
  noise" pattern this project follows.
- `seed` — idempotent fixture data (a team, invite code, a coach row, a
  pre-approved captain player). Safe to re-run.
- `redis:rebuild` — repopulates Redis's caches from Postgres, for after a
  flush/restart.
- `verify:smtp` — connects + authenticates to SMTP without sending
  anything, to confirm `.env`'s mail config before trusting it.
- `send:test-consent-email` — resends a real consent email to an existing
  seeded player, for testing the email round-trip without a fresh signup.

### Tests

```bash
pnpm run test        # unit tests (Jest, colocated *.spec.ts files)
pnpm run test:e2e     # e2e tests (test/*.e2e-spec.ts) — needs Postgres/Redis/MinIO up
```

`test/training-logs-concurrency.e2e-spec.ts` is the regression test for the
row-lock/idempotency pattern described below — worth reading before
changing anything in that area. `test/phase3-video-clips-report-concurrency
.e2e-spec.ts` is the equivalent regression test for the clip-report
race (`VideoClipsService.reportClip`'s pre-check + insert + Redis-cooldown
claim).

**`video-clips/video-processing.service.spec.ts` and
`test/phase3-video-clips.e2e-spec.ts` shell out to real `ffmpeg`/`ffprobe`**
(they generate a synthetic clip with injected metadata, run the actual
remux, and assert the metadata is gone — not a mocked assertion) —
gracefully skipped if neither is on `PATH` (a plain `pnpm test` on a host
without them installed still passes, just without that coverage), but both
tools are present in `backend/Dockerfile`'s image and on `ubuntu-latest`
CI runners by default, so this coverage is real, not aspirational, in both
places that matter. `test/phase3-video-clips.e2e-spec.ts` also needs a
reachable MinIO (`MINIO_ENDPOINT` etc., same env vars as the app itself) —
it PUTs real bytes to a real presigned URL and reads them back to confirm
the served object was actually re-muxed.

## Where the real decisions live (not duplicated here)

- [`docs/adr/0001-backend-framework.md`](../docs/adr/0001-backend-framework.md) — NestJS vs FastAPI.
- [`docs/adr/0002-data-model.md`](../docs/adr/0002-data-model.md) (+ its 2026-07-03 addendum) — the core schema, the `PlayerPrivateInfo` isolation boundary, the consent-gating point, `BadgeAward.context`'s constrained shape.
- [`docs/adr/0003-package-managers.md`](../docs/adr/0003-package-managers.md) — pnpm/uv.
- [`docs/adr/0004-coach-auth-and-session-reissue.md`](../docs/adr/0004-coach-auth-and-session-reissue.md) (+ its 2026-07-05 addendum) — why coach auth is dormant, and the session-reissue mechanism's original design.
- [`docs/adr/0005-kapten-and-weekly-team-goal.md`](../docs/adr/0005-kapten-and-weekly-team-goal.md) — the Phase 2 pivot: captain flag, weekly-goal state machine, the goal-completion bonus formula.
- [`docs/adr/0007-team-chat.md`](../docs/adr/0007-team-chat.md) — the moderation/report/block model `video-clips/` reuses/extends.
- [`docs/adr/0010-video-storage-and-serving.md`](../docs/adr/0010-video-storage-and-serving.md) — Fas 3: MinIO storage, structural team-scoping, the mandatory metadata-stripping remux, retention/deletion.
- [`docs/api/phase1-contract.md`](../docs/api/phase1-contract.md) / [`docs/api/phase2-contract.md`](../docs/api/phase2-contract.md) / [`docs/api/phase3-contract.md`](../docs/api/phase3-contract.md) — the actual request/response contracts this code implements.
- [`docs/ACTION_PLAN.md`](../docs/ACTION_PLAN.md) — what's done, what's deferred, and why, phase by phase.

## A few patterns worth recognizing before you extend them

These show up more than once in this codebase; recognizing the shape means
reusing it instead of reinventing a slightly different version.

- **Consent gating** (`training-logs.service.ts`'s `assertConsentApproved`):
  check once before opening a transaction (fail fast), then re-check under a
  row lock inside it (close the race with a concurrent consent revocation).
  Any future write path gated on consent — e.g. Phase 3's media upload —
  should follow the same two-check shape, not just the first half of it.
- **Team-membership / captain authorization** (`PlayersService
  .assertTeamMembership` / `.assertIsCaptainOfTeam`): a plain service-layer
  check, not a guard class, called from the *service* method that needs it
  (not the controller) so the authorization rule sits next to the business
  rule it protects. Every Phase 2 team-scoped endpoint reuses these two
  methods rather than re-deriving the check.
- **Row-lock + idempotency for a one-time side effect**
  (`WeeklyGoalService.processGoalBonusForLog`): lock the row that decides
  "has this already happened" (`pessimistic_write`), check a persisted
  "already awarded" flag, do the work, set the flag in the same statement.
  This is the general shape for "credit something exactly once, opportunistically,
  inside an existing write's transaction, with no cron job" — a future
  badge-award trigger is the same shape of problem.
- **Best-effort mail send** (`onboarding.service.ts`,
  `consent.service.ts`): the transactional row/token write always
  happens first and independently; the email send is wrapped in its own
  try/catch afterward and only ever logs on failure, never fails the
  request. `mail/templates/consent-request-email.template.ts` is the
  reusable template-rendering shape (plain functions in → `{ subject, html,
  text }` out, with `escapeHtml` on every interpolated value) for any future
  transactional email.
- **Combined visibility filter, one query** (`TeamChatService.listMessages`,
  `VideoClipsService.listClips`): a status filter (`!= 'hidden'`/
  `= 'published'`) and a per-viewer `NOT EXISTS` block filter both live in
  the *same* query-builder chain, never two layered post-processing passes
  — the one place a future refactor could silently leak a blocked/hidden
  row if split apart.
- **Shelling out to a real binary for a mandatory processing step**
  (`VideoProcessingService`'s `ffmpeg`/`ffprobe` remux): write the input to
  a temp file, run the tool via `child_process.execFile` (never a shell
  string — no injection surface), throw on any nonzero exit/empty output,
  clean up temp files in a `finally`. `backend/Dockerfile`'s runtime image
  installs the binary explicitly (`apk add`) rather than assuming it's
  present — check/update that file for any future external-tool
  dependency, the same way this one required it.
- **Scheduled sweeps, not new infra** (`ClipRetentionService`'s two
  `@Cron` jobs): an in-process `@nestjs/schedule` task over a new
  Kubernetes `CronJob`, sharing one delete-object-then-delete-row helper
  parameterized by status/cutoff — the general shape for "periodically
  reclaim rows/objects past some age," not a new pattern per sweep.
