// Offline dev-session-minting script — docs/adr/0023-pt-role-and-staff-sso-
// rbac.md Decision B3. `ubuntu01` (no TLS, no public DNS) can't genuinely
// exercise a real three-provider OAuth handshake (Google/Microsoft require
// HTTPS with only a localhost exception; Apple requires a verified HTTPS
// domain with no exception at all) — rather than build a network-reachable
// "dev login" bypass route to compensate (a standing attack-surface risk
// this ADR explicitly argues against), this prints a valid, signed
// staff_session cookie value directly, mirroring ADR-0004/0005's existing
// Coach/captain-assignment seed-script precedent for "set a piece of
// privileged state without building a full flow for it."
//
// Deliberately NO network-reachable HTTP counterpart exists anywhere in
// this codebase for this capability — never add one. The only thing this
// requires is what every other credential-rotation action in this app
// already requires: direct possession of the target cluster's own
// STAFF_JWT_SECRET value (read from .env here, exactly like every other
// script in this directory).
//
// This script does NOT touch Postgres — it only signs a token for
// whatever staffAccountId you give it. It's your job to make sure that id
// actually names a real, non-revoked `staff_account` row (with the right
// `auth_provider`/`email`, if you're testing AdminAuthGuard's live
// ADMIN_EMAILS re-check) before relying on downstream RBAC behaving as
// expected — this is purely "mint a signed session," not "provision an
// account."
//
// Usage: `pnpm run mint:dev-staff-session <staffAccountId> <admin|pt>`
// (reads STAFF_JWT_SECRET from .env, same as the other scripts). Paste the
// printed value as the `staff_session` cookie (Path=/api/v1) in your
// browser's devtools, or set it directly with:
//   document.cookie = "staff_session=<value>; path=/api/v1"
// while on the target host's own origin (http:// is fine on ubuntu01 —
// STAFF_COOKIE_SECURE is 'false' there, see k8s/configmap.yaml's comment).
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { AppConfigModule } from '../config/app-config.module';
import { StaffAccountRole } from '../staff-auth/entities/staff-account.entity';
import { StaffSessionTokenService } from '../staff-auth/staff-session-token.service';

// A small, purpose-scoped module — not the full StaffAuthModule, which
// also pulls in TypeOrmModule.forFeature([StaffAccount]) and therefore a
// live Postgres connection this offline script deliberately doesn't need.
@Module({
  imports: [
    AppConfigModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.getOrThrow<string>('STAFF_JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [StaffSessionTokenService],
})
class MintDevStaffSessionModule {}

function parseRole(value: string | undefined): StaffAccountRole {
  if (value === StaffAccountRole.ADMIN || value === StaffAccountRole.PT) {
    return value;
  }
  throw new Error(
    `role must be one of: ${Object.values(StaffAccountRole).join(', ')} (got ${value ?? '<none>'})`,
  );
}

async function run(): Promise<void> {
  const [staffAccountId, roleArg] = process.argv.slice(2);
  if (!staffAccountId) {
    throw new Error(
      'Usage: pnpm run mint:dev-staff-session <staffAccountId> <admin|pt>',
    );
  }
  const role = parseRole(roleArg);

  const appContext = await NestFactory.createApplicationContext(
    MintDevStaffSessionModule,
    { logger: ['warn', 'error'] },
  );

  try {
    const staffSessionTokenService = appContext.get(StaffSessionTokenService);
    const token = staffSessionTokenService.issueFor(staffAccountId, role);

    console.log(`staff_session cookie value for ${staffAccountId} (${role}):`);
    console.log(token);
    console.log('');
    console.log(
      'Paste into devtools: document.cookie = "staff_session=' +
        token +
        '; path=/api/v1"',
    );
  } finally {
    await appContext.close();
  }
}

run().catch((error: unknown) => {
  console.error('mint-dev-staff-session script failed:', error);
  process.exitCode = 1;
});
