import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { StaffAuthProvider } from './entities/staff-account.entity';
import {
  STAFF_PENDING_AUTH_COOKIE_NAME,
  STAFF_PENDING_AUTH_COOKIE_PATH,
  STAFF_SESSION_COOKIE_NAME,
  STAFF_SESSION_COOKIE_PATH,
} from './staff-cookies';
import { StaffAuthService } from './staff-auth.service';

const PENDING_AUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours, per Decision B2

// ADR-0023 Part B — SSO login/callback/logout for all three providers.
// No local signup/login form ever rendered here (Decision B5) — every
// route below either redirects to a provider or is redirected back from
// one.
@Controller('api/v1/staff-auth')
export class StaffAuthController {
  constructor(
    private readonly staffAuthService: StaffAuthService,
    private readonly configService: ConfigService,
  ) {}

  // Decision B5 — the one real local surface (this route + the callback
  // below) gets a plain per-IP rate limit, the same ThrottlerGuard pattern
  // already used on ConsentController/onboarding/session-reissue, as
  // defense against volumetric abuse — not a bot-signup concern (there is
  // no local form to protect).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':provider/login')
  async login(
    @Param('provider') providerParam: string,
    @Res() res: Response,
  ): Promise<void> {
    const provider = this.parseProvider(providerParam);
    const { authorizationUrl, pendingAuthCookieValue } =
      await this.staffAuthService.buildLoginRedirect(provider);

    res.cookie(
      STAFF_PENDING_AUTH_COOKIE_NAME,
      pendingAuthCookieValue,
      this.pendingCookieOptions(provider),
    );
    res.redirect(authorizationUrl);
  }

  // ADR-0022 Decision 10's step-up re-auth, as an IdP round trip rather
  // than the ADR's literal TOTP (see StaffAuthService.buildLoginRedirect
  // for why that recommendation's premise no longer holds). Same shape as
  // /login above — a redirect, not JSON — so the console navigates here
  // and lands back on the callback exactly as it does for a fresh sign-in.
  //
  // docs/design/phase7-admin-console-flows.md §13 asked for a deliberate
  // answer on whether step-up shares /login's per-IP bucket and can
  // therefore lock the operator out of ordinary sign-in. Checked against
  // the installed @nestjs/throttler (6.5.0) rather than assumed: its
  // generateKey is `${ClassName}-${HandlerName}-${throttlerName}` hashed
  // with the tracker, so two distinct handlers already count separately
  // even under the same named throttler. The limits below are /login's,
  // the counter is not — no second global throttler needed to get there.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':provider/step-up')
  async stepUp(
    @Param('provider') providerParam: string,
    @Res() res: Response,
  ): Promise<void> {
    const provider = this.parseProvider(providerParam);
    const { authorizationUrl, pendingAuthCookieValue } =
      await this.staffAuthService.buildLoginRedirect(provider, {
        stepUp: true,
      });

    res.cookie(
      STAFF_PENDING_AUTH_COOKIE_NAME,
      pendingAuthCookieValue,
      this.pendingCookieOptions(provider),
    );
    res.redirect(authorizationUrl);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':provider/callback')
  async callbackGet(
    @Param('provider') providerParam: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleCallback(providerParam, req, res);
  }

  // Apple requires `response_mode=form_post` whenever `name`/`email` scope
  // is requested (see StaffAuthService's SCOPE_BY_PROVIDER) — its callback
  // arrives as a POST with a form-encoded body, not a GET redirect.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':provider/callback')
  @HttpCode(HttpStatus.OK)
  async callbackPost(
    @Param('provider') providerParam: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleCallback(providerParam, req, res);
  }

  // POST-only, mirrors ADR-0022 Decision 2's CSRF-safe logout-via-POST
  // reasoning (a GET-triggerable logout is a cross-site request-forgeable
  // annoyance vector — low stakes here, but no reason to reintroduce it).
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res() res: Response): void {
    res.clearCookie(STAFF_SESSION_COOKIE_NAME, {
      path: STAFF_SESSION_COOKIE_PATH,
    });
    res.status(HttpStatus.OK).json({ ok: true });
  }

  /**
   * The pending-auth cookie must survive the IdP round trip, which is a
   * CROSS-SITE return — so `sameSite: 'strict'` (what this used to send)
   * means the browser withholds it on the very request it exists for, and
   * the callback rejects every real sign-in with
   * `oauth_pending_auth_invalid`. Found 2026-08-08 by a security review;
   * it passed e2e only because supertest does not enforce SameSite.
   *
   * - Google/Microsoft come back as a top-level GET navigation, which
   *   `lax` permits — the tightest value that actually works.
   * - Apple comes back as a cross-site form POST (`response_mode=
   *   form_post`, required whenever name/email scope is requested), which
   *   `lax` does NOT permit. That leaves `none`, which browsers only honour
   *   alongside `Secure` — forced on for Apple regardless of
   *   STAFF_COOKIE_SECURE, since Apple requires an HTTPS redirect URI
   *   anyway and a plain-HTTP local Apple login was never possible.
   *
   * The real `staff_session` cookie keeps `strict`: it is only ever sent by
   * the console's own same-site requests, so nothing about this applies to
   * it.
   *
   * NOT VERIFIED AGAINST A LIVE IdP — this is the standard fix for the
   * standard mistake, but staff SSO has evidently never completed in a real
   * browser, so treat the first live login as the actual test.
   */
  private pendingCookieOptions(provider: StaffAuthProvider): CookieOptions {
    const isApple = provider === StaffAuthProvider.APPLE;
    return {
      httpOnly: true,
      sameSite: isApple ? 'none' : 'lax',
      secure: isApple ? true : this.cookieSecure(),
      path: STAFF_PENDING_AUTH_COOKIE_PATH,
      maxAge: PENDING_AUTH_COOKIE_MAX_AGE_MS,
    };
  }

  private async handleCallback(
    providerParam: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const provider = this.parseProvider(providerParam);
    const pendingAuthCookieValue = req.cookies?.[
      STAFF_PENDING_AUTH_COOKIE_NAME
    ] as string | undefined;

    const callbackParams = await this.staffAuthService.readCallbackParams(
      provider,
      req,
    );
    const { sessionToken } = await this.staffAuthService.completeLogin(
      provider,
      pendingAuthCookieValue,
      callbackParams,
    );

    // The pending-auth cookie is single-use by construction (its own
    // state/nonce/code_verifier are only ever meaningful for one
    // authorization attempt) — clear it either way once consumed.
    res.clearCookie(STAFF_PENDING_AUTH_COOKIE_NAME, {
      path: STAFF_PENDING_AUTH_COOKIE_PATH,
    });
    res.cookie(STAFF_SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.cookieSecure(),
      path: STAFF_SESSION_COOKIE_PATH,
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    });
    res.status(HttpStatus.OK).json({ ok: true });
  }

  private parseProvider(providerParam: string): StaffAuthProvider {
    const validProviders: string[] = Object.values(StaffAuthProvider);
    if (!validProviders.includes(providerParam)) {
      throw new NotFoundException('No such staff-auth provider.');
    }
    return providerParam as StaffAuthProvider;
  }

  // ADR-0023 Decision B2 — renamed from ADR-0022's ADMIN_COOKIE_SECURE for
  // consistency. Defaults true; ubuntu01's own hand-applied ConfigMap sets
  // it false (no live TLS there — see k8s/configmap.yaml's own comment).
  private cookieSecure(): boolean {
    return this.configService.get<string>('STAFF_COOKIE_SECURE') !== 'false';
  }
}
