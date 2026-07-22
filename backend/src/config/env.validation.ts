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

  // --- Fas 3 (video clips / MinIO) -------------------------------------------
  // docs/adr/0010-video-storage-and-serving.md Decision 1 — MinIO gets the
  // identical "required stateful dependency" treatment as
  // DATABASE_URL/REDIS_URL, not mail's optional-degrade treatment: a video
  // feature this app now ships can't silently no-op the way an unconfigured
  // SMTP relay can.
  @IsNotEmpty()
  MINIO_ENDPOINT!: string;

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
