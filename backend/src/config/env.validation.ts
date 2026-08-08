import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsOptional()
  @IsNumberString()
  PORT?: string;

  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsNotEmpty()
  REDIS_URL!: string;

  @IsNotEmpty()
  JWT_SECRET!: string;

  // Fas 4 encryption-at-rest, 2026-07-28 — see
  // common/crypto/pii-encryption.util.ts. Required, not optional-degrade
  // like SMTP: a missing key must never fall back to storing
  // parent_contact/real_name in plaintext, since the entire point is
  // guaranteeing they're encrypted. Base64-encoded 32-byte AES-256 key —
  // generate with `openssl rand -base64 32`.
  @IsNotEmpty()
  PII_ENCRYPTION_KEY!: string;

  @IsOptional()
  @IsNotEmpty()
  JWT_EXPIRES_IN?: string;

  // All optional: mail sending degrades to a clearly-logged no-op rather
  // than failing app boot when unset (see MailService) — lets the rest of
  // the app keep working while SMTP is still being configured.
  @IsOptional()
  @IsNotEmpty()
  SMTP_HOST?: string;

  @IsOptional()
  @IsNumberString()
  SMTP_PORT?: string;

  @IsOptional()
  @IsNotEmpty()
  SMTP_USER?: string;

  @IsOptional()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsNotEmpty()
  SMTP_FROM?: string;

  // The address a parent's browser can actually reach to click the consent
  // link — a LAN IP during local testing, a real domain once deployed.
  // Optional with a localhost fallback in code so nothing crashes if unset.
  @IsOptional()
  @IsNotEmpty()
  APP_PUBLIC_URL?: string;

  // Comma-separated list of origins allowed to call this API cross-origin
  // (e.g. the site container's own origin, so its embedded "create/join a
  // team" widget can call GET /teams/invite and POST /players directly).
  // Optional, degrades to CORS disabled entirely if unset — same posture
  // as SMTP/APP_PUBLIC_URL, not a silent wildcard default. See main.ts.
  @IsOptional()
  @IsNotEmpty()
  CORS_ORIGIN?: string;

  // --- Fas 3 (video clips / MinIO) -------------------------------------------
  // docs/adr/0010-video-storage-and-serving.md Decision 1 — MinIO gets the
  // identical "required stateful dependency" treatment as
  // DATABASE_URL/REDIS_URL, not mail's optional-degrade treatment: a video
  // feature this app now ships can't silently no-op the way an unconfigured
  // SMTP relay can.
  @IsNotEmpty()
  MINIO_ENDPOINT!: string;

  // Optional — the endpoint a *real client* (phone, browser) can actually
  // reach to PUT/GET a presigned URL, as opposed to MINIO_ENDPOINT, which
  // this app's own pod uses for its internal admin calls (bucket
  // creation/policy) and which is typically a cluster-internal Service DNS
  // name (e.g. `http://minio:9000`) no external client can resolve at all.
  // Confirmed live 2026-07-26: with no distinction, every presigned upload/
  // playback URL handed to a real client pointed at `http://minio:9000`,
  // which just hangs/fails outside the cluster — not a database or
  // environment-performance issue, a wrong-hostname bug. Falls back to
  // MINIO_ENDPOINT when unset so this stays a no-op change for CI/tests,
  // which talk to MinIO from inside the same network MINIO_ENDPOINT
  // already resolves on.
  @IsOptional()
  @IsNotEmpty()
  MINIO_PUBLIC_ENDPOINT?: string;

  @IsNotEmpty()
  MINIO_ACCESS_KEY!: string;

  @IsNotEmpty()
  MINIO_SECRET_KEY!: string;

  // Optional — ObjectStorageService defaults to 'clips' (ADR-0010's bucket
  // layout) if unset.
  @IsOptional()
  @IsNotEmpty()
  MINIO_BUCKET?: string;

  // Tunable product config, per ADR-0010's own framing ("a config value...
  // not architecturally rigid") — all optional with the ADR's recommended
  // defaults applied in code (see video-clips.constants.ts).
  @IsOptional()
  @IsNumberString()
  CLIP_RETENTION_DAYS?: string;

  @IsOptional()
  @IsNumberString()
  CLIP_PENDING_UPLOAD_TTL_MINUTES?: string;

  // --- Fas 8 (staff SSO/RBAC — docs/adr/0023-pt-role-and-staff-sso-rbac.md
  // Part B) -------------------------------------------------------------
  // Signs/verifies the staff_session and staff_auth_pending cookies
  // (StaffSessionTokenService/PendingStaffAuthService). Required, same
  // posture as JWT_SECRET/PII_ENCRYPTION_KEY — unlike the OAuth client
  // credentials below, this doesn't depend on a real OAuth application
  // being registered anywhere first, so there's no reason to let it
  // degrade.
  @IsNotEmpty()
  STAFF_JWT_SECRET!: string;

  // Comma-separated admin email allow-list (Decision B1). Optional —
  // degrades to "no one is admin yet", not a wildcard/first-sign-up
  // default — since the real list is a project-owner decision made once
  // real staff accounts exist.
  @IsOptional()
  ADMIN_EMAILS?: string;

  // 'true' (default if unset) or 'false' — StaffAuthController reads this
  // as a plain string, not @nestjs/config's boolean coercion, matching
  // this file's existing convention for tri-state optional flags.
  @IsOptional()
  @IsIn(['true', 'false'])
  STAFF_COOKIE_SECURE?: string;

  // OAuth client credentials, one pair per provider (Google/Microsoft) —
  // all optional: the project owner still has to register each real OAuth
  // application separately (docs/adr/0023-pt-role-and-staff-sso-rbac.md
  // Decision B6), so the app must still boot cleanly before that happens.
  // A login attempt for an unconfigured provider fails with a clear error
  // at request time instead (see StaffOidcClientsService.requireEnv).
  //
  // Deliberately @IsOptional() alone, NOT stacked with @IsNotEmpty(): both
  // docker-compose.yml's `${VAR:-}` interpolation and this app's own
  // container runtimes can hand these to the process as a defined empty
  // string rather than truly unset — and class-validator's @IsOptional()
  // only skips validation for undefined/null, never for ''. Stacking
  // @IsNotEmpty() on top used to fail boot on every empty-but-present
  // value (confirmed live: the docker-compose smoke test's `api` container
  // crash-looped on "Invalid environment configuration" for exactly this
  // reason). requireEnv's own `if (!value)` check already treats ''
  // exactly like undefined at request time, so nothing is lost here.
  @IsOptional()
  GOOGLE_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  GOOGLE_OAUTH_CLIENT_SECRET?: string;

  @IsOptional()
  MICROSOFT_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  MICROSOFT_OAUTH_CLIENT_SECRET?: string;

  // Apple's "client secret" is a JWT this app signs itself
  // (StaffOidcClientsService.buildAppleClientSecret) from these four
  // pieces, not a single static secret string — see Decision B6.
  @IsOptional()
  APPLE_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  APPLE_TEAM_ID?: string;

  @IsOptional()
  APPLE_KEY_ID?: string;

  @IsOptional()
  APPLE_PRIVATE_KEY?: string;

  // --- Fas 5 (usage analytics — docs/adr/0020-usage-analytics-product-
  // metrics.md) ---------------------------------------------------------
  // All three are @IsOptional() ALONE, deliberately not stacked with
  // @IsNotEmpty()/@IsNumberString(), for the reason this file's OAuth block
  // above already documents and env.validation.spec.ts pins down: a k8s
  // Secret key created from an unset GitHub Actions secret, and
  // docker-compose's `${VAR:-}` interpolation, both hand the process a
  // defined EMPTY STRING rather than an absent value — and class-validator's
  // @IsOptional() only skips undefined/null. Every consumer below treats ''
  // exactly like unset, so nothing is lost by validating loosely here, and
  // an optional reporting knob must never be able to crash-loop the API on
  // boot.
  //
  // Where the report is emailed (Decision 5). Unset/empty = the scheduled
  // job no-ops with a log line, the same graceful degrade MailService
  // already has when SMTP is unconfigured.
  @IsOptional()
  USAGE_REPORT_RECIPIENT_EMAIL?: string;

  // Cadence (Decision 6) — a cron expression, default monthly. Read from
  // process.env at import time rather than through ConfigService (see
  // usage-metrics/usage-report-cron.util.ts for why), and a malformed value
  // falls back to the default instead of failing.
  @IsOptional()
  USAGE_REPORT_CRON?: string;

  // Decision 3's security-reviewer-required minimum-population floor: the
  // fewest TEAMS a team-size bucket may contain before it's reported as its
  // own bucket instead of being folded into the app-wide number. Default 5;
  // clamped to a hard minimum in code so a mis-set value can't disable the
  // protection outright.
  @IsOptional()
  USAGE_REPORT_MIN_TEAMS_PER_BUCKET?: string;

  // --- Fas 7 (admin control center — docs/adr/0022-admin-control-center.md
  // Decision 6) ----------------------------------------------------------
  // Both are @IsOptional() ALONE, deliberately not stacked with
  // @IsNotEmpty()/@IsNumberString(), for exactly the reason the Fas 5 block
  // above spells out: an empty-but-PRESENT value ('' from a k8s Secret key
  // whose GitHub Actions secret was never set, or from docker-compose's
  // `${VAR:-}`) passes @IsOptional() only when it's undefined/null, so
  // stacking either of those decorators would crash-loop the API on boot
  // over an optional operational knob. Both are parsed by
  // error-log/error-log.util.ts's positiveIntFromConfig, which treats '',
  // non-numeric, zero, negative and fractional values as "use the default".
  //
  // How long a row in `error_log_entry` is kept before the daily sweep
  // deletes it (Decision 6 recommends 90 days). Default 90. Also echoed by
  // the admin API so the console can interpolate the real number instead of
  // hardcoding it — docs/design/phase7-admin-console-flows.md §5.2/§13.
  @IsOptional()
  ERROR_LOG_RETENTION_DAYS?: string;

  // How many stack frames are kept when a row is written (Decision 6's
  // "e.g. first ~20 frames" — explicitly a recommendation, not a fixed
  // number, which is why it's a knob at all). Default 20, and echoed by the
  // admin API for the same reason as above.
  @IsOptional()
  ERROR_LOG_STACK_MAX_FRAMES?: string;
}

// Fails fast on boot rather than surfacing a confusing runtime error the
// first time a request touches Postgres/Redis/JWT.
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }

  return validatedConfig;
}
