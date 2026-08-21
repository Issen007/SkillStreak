import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { securityHeaders } from './common/security-headers.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
  // AppExceptionFilter is NOT registered here any more (was:
  // `app.useGlobalFilters(new AppExceptionFilter())`) — since
  // docs/adr/0022-admin-control-center.md Decision 6 it injects
  // ErrorLogService to record every error branch into `error_log_entry`,
  // and a filter constructed with `new` gets no DI at all. It's provided as
  // an APP_FILTER in AppModule instead, which is the same global scope with
  // a working injector. The response envelope is byte-identical either way.

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

  // **Trust proxy — this is what makes every `@Throttle()` in this app
  // per-IP rather than one global bucket.**
  //
  // `@nestjs/throttler` keys its limits on `req.ip`, and Express reports
  // `req.ip` as the socket peer unless told how many proxies sit in
  // front. Nothing set this until 2026-08-20, so behind the Cilium
  // gateway every visitor shared one address and therefore one bucket:
  // roughly ten page views a minute exhausted the analytics limit
  // site-wide, and — more seriously — the "tighter-than-default per-IP
  // rate limit" that `onboarding.controller.ts` documents on child signup,
  // and the one on staff login, were never per-IP at all. A single
  // scripted client could lock out either for everyone.
  //
  // **The direction of error matters, so this is a hop COUNT, never
  // `true`.** `X-Forwarded-For` is a client-supplied header that each
  // proxy appends to. Trusting N hops means taking the Nth entry from the
  // right — the address the last trusted proxy actually observed.
  //   * Too LOW degrades to today's behaviour: you land on a proxy's
  //     address, limits are coarser than intended, nothing is exploitable.
  //   * Too HIGH (and `true` is "infinitely high") reads an entry the
  //     client wrote, so anyone can forge an arbitrary source address —
  //     evading their own limit and, worse, poisoning the bucket of any
  //     address they choose.
  // Under-counting is safe and over-counting is a vulnerability, so the
  // default is the smallest value that is right for the current topology
  // (one gateway hop), and raising it must follow a real count of the
  // proxies in front of the pod rather than a guess.
  const trustedProxyHops = Number(
    configService.get<string>('TRUSTED_PROXY_HOPS') ?? '1',
  );
  const hops =
    Number.isFinite(trustedProxyHops) && trustedProxyHops >= 0
      ? Math.trunc(trustedProxyHops)
      : 1;
  app.set('trust proxy', hops);
  new Logger('Bootstrap').log(
    `Trusting ${hops} proxy hop(s) for client IP (rate limits key on it).`,
  );

  // HSTS on the API's own responses.
  //
  // The site's nginx sets this for the marketing and try-it hosts; this
  // covers api.skillstreak.xyz, which serves the staff console and every
  // authenticated request the app makes. Reported 2026-08-20: a visitor's
  // Safari privacy report showed skillstreak.xyz as "not encrypted",
  // because port 80 answered without redirecting. The redirect fixes the
  // second request; this is what stops the first one being plaintext at
  // all on a later visit.
  //
  // **Only when the request actually arrived over TLS.** `req.secure`
  // reads X-Forwarded-Proto now that `trust proxy` is set above, so this
  // is silent for local HTTP development and for the docker-compose smoke
  // test — sending HSTS over plaintext is both meaningless (a browser
  // ignores it) and a way to make a developer's own machine unreachable
  // on localhost after one visit.
  //
  // One year, no `preload`: preloading is effectively irreversible, and
  // that should be a deliberate decision rather than a side effect.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.secure) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  });

  // See the middleware for why each of these three is here.
  app.use(securityHeaders);

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

  // The staff console (admin + PT), served by the API itself rather than by
  // the `site` Deployment. That is not a packaging convenience — the
  // staff_session cookie is SameSite=Strict and deliberately outside the
  // CORS block above, so the console only authenticates at all if it is
  // same-origin with the API.
  //
  // ADR-0022's security review requires this static root to be disjoint
  // from the admin-planning-docs mount (/srv/admin-planning): those files
  // are readable only through AdminAuthGuard + step-up, and a static
  // handler rooted anywhere above them would serve them to anonymous
  // callers. `console/` is its own directory containing nothing else.
  // One path for both cases on purpose: `backend/console` sits beside
  // `backend/dist` in a checkout, and the image copies it to /app/console
  // beside /app/dist, so `../console` from __dirname resolves in each.
  const consoleRoot = join(__dirname, '..', 'console');
  if (existsSync(join(consoleRoot, 'index.html'))) {
    app.useStaticAssets(consoleRoot, { prefix: '/console' });
  } else {
    // Not fatal: the API's own routes are unaffected, and a missing console
    // should not take the backend down. Say so loudly, though — otherwise
    // the only symptom is a 404 after a successful sign-in.
    //
    // Through the app's own Logger, like every other boot message in this
    // file: a bare `console.warn` prints outside the format the log tooling
    // reads, so the one line that explains a mysterious 404 is the one line
    // nothing would attribute to a service.
    new Logger('Bootstrap').warn(
      'Staff console assets not found — /console will 404.',
    );
  }

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
