import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/errors/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validate at the boundary (incoming requests), per CLAUDE.md — reject
  // unknown fields rather than silently accepting/ignoring them (e.g. a
  // client trying to slip a location field into a request body).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());

  // CORS, off by default — only enabled if CORS_ORIGIN is explicitly set
  // (see env.validation.ts), and only for the specific origins listed, not
  // a wildcard. This applies app-wide (NestJS's enableCors isn't
  // per-route), not literally scoped to just GET /teams/invite and
  // POST /players — the two endpoints this originally existed for.
  //
  // 'Authorization' is deliberately included here (confirmed live
  // 2026-07-26): the site's own try-it app (the Expo web export, served
  // from the same site container as the marketing page but on a
  // different origin/port — see site/nginx.conf) is a real client of
  // every authenticated endpoint, not just the two unauthenticated
  // onboarding ones. Without it, the browser's CORS preflight for any
  // Bearer-authenticated request (starting with GET /players/me, the
  // first call the home screen makes) fails before the request is ever
  // sent — onboarding itself still works (it needs no Authorization
  // header), but the app goes blank/stuck-loading immediately after,
  // since every real screen past onboarding depends on an authenticated
  // call. This was previously treated as an incidental "safety net" for
  // routes with no other real access control, but CORS was never a
  // meaningful barrier to a non-browser client anyway, and CORS_ORIGIN is
  // scoped to this project's own known site origins, not a wildcard — so
  // there's no real security tradeoff here, only a functional one.
  // No credentials mode (every *player*-facing endpoint authenticates via
  // a Bearer sessionToken, never a cookie), so there's no cross-origin
  // credential-leak risk to configure around for that surface. The staff
  // (admin/pt) `staff_session` cookie added by docs/adr/0023-pt-role-and-
  // staff-sso-rbac.md Part B is deliberately NOT covered by this `enableCors`
  // block at all — its own `SameSite=Strict` is the boundary for that
  // surface (ADR-0022 Decision 2's XSS-vs-CSRF reasoning, reused verbatim),
  // and it's meant for a same-origin admin/PT console page, not a
  // cross-origin fetch client.
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  if (corsOrigin) {
    app.enableCors({
      origin: corsOrigin.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  }

  // Cookie parsing for the staff_session/staff_auth_pending cookies (ADR-
  // 0023 Part B) — no secret passed to cookie-parser itself, since both
  // cookie values are self-verifying signed JWTs (StaffSessionTokenService/
  // PendingStaffAuthService), not cookie-parser's own signed-cookie
  // feature. Every other route in this app remains Bearer-token-only and
  // never reads req.cookies at all.
  app.use(cookieParser());

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
