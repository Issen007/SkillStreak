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
