import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PlayerTokenService } from './player-token.service';

// sessionToken lifecycle (per docs/api/phase1-contract.md): a JWT scoped to
// a single playerId, issued once at POST /players, no login/password/OTP
// step. Expiry/refresh/reissue-if-lost is explicitly left as a
// backend-developer implementation detail by the contract — see the
// JWT_EXPIRES_IN default below and the TODO in .env.example.
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        // `expiresIn` is typed by @nestjs/jwt as `number | StringValue`
        // (ms-style strings like '180d') — env vars come in as plain
        // `string`, so this is a deliberate, narrow cast at the
        // config/library boundary, not a loosening of app-level typing.
        const expiresIn = (configService.get<string>('JWT_EXPIRES_IN') ??
          '180d') as unknown as NonNullable<
          JwtModuleOptions['signOptions']
        >['expiresIn'];
        return {
          secret: configService.getOrThrow<string>('JWT_SECRET'),
          signOptions: { expiresIn },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [PlayerTokenService, JwtAuthGuard],
  exports: [PlayerTokenService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
