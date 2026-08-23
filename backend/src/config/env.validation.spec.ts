// class-validator's decorators rely on reflect-metadata, normally
// side-effect-imported once by main.ts before anything else runs — no
// other spec file exercises a decorated class directly via validateEnv,
// so this is the first spec that needs it loaded explicitly.
import 'reflect-metadata';
import { validateEnv } from './env.validation';

// Confirmed live 2026-08-04: the docker-compose smoke test's `api`
// container crash-looped on "Invalid environment configuration" the
// moment ADR-0023 Part B's OAuth credential fields landed. Root cause:
// docker-compose.yml's `${VAR:-}` interpolation (and, equivalently, a
// GitHub Actions secret that's never been set flowing through
// `--from-literal=KEY="$KEY"` into a k8s Secret) hands these fields to the
// process as a defined empty string, never a truly-absent/undefined one —
// but class-validator's @IsOptional() only skips validation for
// undefined/null, not ''. Stacking @IsNotEmpty() on top of @IsOptional()
// for a field whose real-world "unset" value is '' fails boot every time.
function baseRequiredEnv(): Record<string, string> {
  return {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret',
    PII_ENCRYPTION_KEY: 'test-pii-key',
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ACCESS_KEY: 'test-access-key',
    MINIO_SECRET_KEY: 'test-secret-key',
    STAFF_JWT_SECRET: 'test-staff-jwt-secret',
  };
}

describe('validateEnv', () => {
  it('boots cleanly with every optional OAuth credential set to an empty string, not just genuinely unset', () => {
    const config = {
      ...baseRequiredEnv(),
      ADMIN_EMAILS: '',
      GOOGLE_OAUTH_CLIENT_ID: '',
      GOOGLE_OAUTH_CLIENT_SECRET: '',
      MICROSOFT_OAUTH_CLIENT_ID: '',
      MICROSOFT_OAUTH_CLIENT_SECRET: '',
      APPLE_OAUTH_CLIENT_ID: '',
      APPLE_TEAM_ID: '',
      APPLE_KEY_ID: '',
      APPLE_PRIVATE_KEY: '',
    };

    expect(() => validateEnv(config)).not.toThrow();
  });

  it('boots cleanly with the OAuth credentials genuinely absent (real k8s optional secretKeyRef behavior)', () => {
    expect(() => validateEnv(baseRequiredEnv())).not.toThrow();
  });

  // Same trap, same fix, for Fas 5's usage-report knobs
  // (docs/adr/0020-usage-analytics-product-metrics.md): docker-compose.yml
  // passes USAGE_REPORT_RECIPIENT_EMAIL as `${VAR:-}` and CI creates the
  // matching k8s Secret key from a GitHub secret the project owner may
  // never set — both arrive as ''. An optional reporting knob must never be
  // able to crash-loop the API on boot.
  it('boots cleanly with every usage-report variable set to an empty string', () => {
    expect(() =>
      validateEnv({
        ...baseRequiredEnv(),
        USAGE_REPORT_RECIPIENT_EMAIL: '',
        USAGE_REPORT_CRON: '',
        USAGE_REPORT_MIN_TEAMS_PER_BUCKET: '',
      }),
    ).not.toThrow();
  });

  it('still fails fast when a genuinely required variable is missing', () => {
    const config: Partial<Record<string, string>> = baseRequiredEnv();
    delete config.DATABASE_URL;
    expect(() => validateEnv(config)).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('still fails fast when a genuinely required variable is an empty string', () => {
    expect(() =>
      validateEnv({ ...baseRequiredEnv(), STAFF_JWT_SECRET: '' }),
    ).toThrow(/Invalid environment configuration/);
  });
  // ADR-0030's rollout allow-list. An empty value is the *off* switch and
  // the expected production setting for a while — booting must not depend
  // on the key being absent rather than blank, which is the distinction
  // `@IsOptional()` alone makes and `@IsOptional() + @IsNotEmpty()`
  // silently breaks.
  it('boots with the public-sharing allow-list absent or blank', () => {
    expect(() => validateEnv(baseRequiredEnv())).not.toThrow();
    expect(() =>
      validateEnv({
        ...baseRequiredEnv(),
        PUBLIC_SHARING_ENABLED_TEAM_IDS: '',
      }),
    ).not.toThrow();
    expect(() =>
      validateEnv({
        ...baseRequiredEnv(),
        PUBLIC_SHARING_ENABLED_TEAM_IDS: 'team-a,team-b',
      }),
    ).not.toThrow();
  });

  // ADR-0030 finding 4's bounce mailbox. Same trap, six more keys — and
  // blank is the value every environment starts with, since the mailbox
  // has to be provisioned before it can be pointed at. A ConfigMap
  // shipping these as empty strings must boot the pod, not crash it.
  it('boots with the bounce-mailbox settings absent or blank', () => {
    const blank = {
      BOUNCE_IMAP_HOST: '',
      BOUNCE_IMAP_PORT: '',
      BOUNCE_IMAP_USER: '',
      BOUNCE_IMAP_PASSWORD: '',
      BOUNCE_IMAP_SECURE: '',
      BOUNCE_IMAP_MAILBOX: '',
    };

    expect(() => validateEnv(baseRequiredEnv())).not.toThrow();
    expect(() => validateEnv({ ...baseRequiredEnv(), ...blank })).not.toThrow();
    expect(() =>
      validateEnv({
        ...baseRequiredEnv(),
        BOUNCE_IMAP_HOST: 'imap.example.net',
        BOUNCE_IMAP_PORT: '993',
        BOUNCE_IMAP_USER: 'bounces@skillstreak.xyz',
        BOUNCE_IMAP_PASSWORD: 'secret',
        BOUNCE_IMAP_SECURE: 'true',
        BOUNCE_IMAP_MAILBOX: 'INBOX',
      }),
    ).not.toThrow();
  });
});

/*
 * The same trap, on the six fields the earlier rounds missed.
 *
 * Each of these was `@IsOptional()` stacked with `@IsNotEmpty()` — the
 * exact pairing this file's own comments warn about four separate times,
 * and which the OAuth, usage-report and bounce-mailbox blocks were each
 * fixed for in turn. Nobody swept the rest. SMTP_HOST and APP_PUBLIC_URL
 * are the ones that matter: both are routinely set and cleared while mail
 * is being configured, and a blank one refused the boot outright rather
 * than degrading to "no mail", which is what every consumer of them
 * already expects from a missing value.
 */
describe.each([
  'CONTACT_RECIPIENT_EMAIL',
  'JWT_EXPIRES_IN',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_FROM',
  'APP_PUBLIC_URL',
  'CORS_ORIGIN',
])('%s set to an empty string', (name) => {
  it('is treated as absent rather than refusing the boot', () => {
    expect(() =>
      validateEnv({ ...baseRequiredEnv(), [name]: '' }),
    ).not.toThrow();
  });
});

it('still refuses a required variable that is present but blank', () => {
  expect(() =>
    validateEnv({ ...baseRequiredEnv(), DATABASE_URL: '' }),
  ).toThrow();
});
