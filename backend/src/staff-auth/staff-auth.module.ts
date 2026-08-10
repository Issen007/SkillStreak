import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffAccount } from './entities/staff-account.entity';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AdminStepUpGuard } from './guards/admin-step-up.guard';
import { PtAuthGuard } from './guards/pt-auth.guard';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import { PendingStaffAuthService } from './pending-staff-auth.service';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { StaffSessionViewService } from './staff-session-view.service';
import { StaffOidcClientsService } from './staff-oidc-clients.service';
import { StaffSessionTokenService } from './staff-session-token.service';

// ADR-0023 Part B. `staff_session`'s 24h default lifetime (Decision B2)
// comes from this module's own JwtModule registration — a wholly separate
// JwtModule instance/secret from AuthModule's player-JWT one (STAFF_
// JWT_SECRET, never JWT_SECRET; see StaffSessionTokenService). The
// pending-auth cookie (PendingStaffAuthService) reuses this same
// JwtService/secret with its own 10-minute expiresIn override per sign()
// call, not a second secret — there's no boundary-crossing risk to guard
// against between "a pending OAuth attempt" and "a live staff session,"
// both are this app's own short-lived, purely internal state.
@Module({
  imports: [
    TypeOrmModule.forFeature([StaffAccount]),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.getOrThrow<string>('STAFF_JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [StaffAuthController],
  providers: [
    StaffSessionViewService,
    StaffOidcClientsService,
    PendingStaffAuthService,
    StaffSessionTokenService,
    StaffAuthService,
    StaffAuthGuard,
    AdminAuthGuard,
    AdminStepUpGuard,
    PtAuthGuard,
  ],
  // Re-exported (not just imported), mirroring AuthModule's own comment:
  // any future module using `@UseGuards(AdminAuthGuard)`/`@UseGuards(
  // PtAuthGuard)` (the not-yet-built admin console / Part A's `pt/`
  // module) needs these guards' own dependencies resolvable in *its own*
  // DI scope, not just here.
  exports: [
    TypeOrmModule.forFeature([StaffAccount]),
    JwtModule,
    StaffSessionTokenService,
    StaffAuthGuard,
    AdminAuthGuard,
    AdminStepUpGuard,
    PtAuthGuard,
  ],
})
export class StaffAuthModule {}
