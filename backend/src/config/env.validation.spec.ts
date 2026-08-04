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
});
