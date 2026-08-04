import { ConfigService } from '@nestjs/config';

// ADR-0023 Decision B1 — a small, explicit allow-list of admin email
// addresses, comma-separated, case-insensitively matched against the
// verified `email` claim (or, for an existing account, the persisted
// StaffAccount.email row — see AdminAuthGuard). A pure, in-memory
// ConfigService read, deliberately not its own DB round trip — genuinely
// free, and re-run on every AdminAuthGuard check (see that guard).
export function readAdminEmailAllowList(
  configService: ConfigService,
): Set<string> {
  const raw = configService.get<string>('ADMIN_EMAILS') ?? '';
  return new Set(
    raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}
