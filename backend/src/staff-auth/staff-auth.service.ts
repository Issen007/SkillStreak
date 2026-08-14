import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { CallbackParamsType, IdTokenClaims, generators } from 'openid-client';
import { Repository } from 'typeorm';
import {
  StaffAccountRevokedException,
  StaffOAuthCallbackRejectedException,
  StaffOAuthPendingAuthInvalidException,
  StaffOAuthStateMismatchException,
} from '../common/errors/exceptions';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { readAdminEmailAllowList } from './admin-email-allow-list.util';
import {
  StaffAccount,
  StaffAccountRole,
  StaffAuthProvider,
} from './entities/staff-account.entity';
import {
  PendingStaffAuthPayload,
  PendingStaffAuthService,
} from './pending-staff-auth.service';
import { StaffOidcClientsService } from './staff-oidc-clients.service';
import { StaffSessionTokenService } from './staff-session-token.service';

export interface StaffLoginRedirect {
  authorizationUrl: string;
  pendingAuthCookieValue: string;
}

export interface StaffLoginResult {
  sessionToken: string;
  account: StaffAccount;
}

// Apple requires `response_mode=form_post` whenever `name`/`email` scope is
// requested — StaffAuthController's callback route accepts both GET and
// POST for exactly this reason (openid-client's callbackParams() reads
// whichever the request actually carries).
const SCOPE_BY_PROVIDER: Record<StaffAuthProvider, string> = {
  [StaffAuthProvider.GOOGLE]: 'openid email profile',
  [StaffAuthProvider.MICROSOFT]: 'openid email profile',
  [StaffAuthProvider.APPLE]: 'openid email name',
};

// How recent the IdP's own `auth_time` must be for a step-up flow to
// count. Generous enough to absorb a real person typing a password and an
// MFA code at an unfamiliar provider, plus clock skew between us and the
// IdP; far shorter than the freshness window the planning endpoints then
// grant (see ADMIN_STEP_UP_FRESHNESS_MS), so this can never be the thing
// that silently extends it.
const STEP_UP_MAX_AUTH_AGE_MS = 5 * 60 * 1000;

// Allowance for the IdP's clock running ahead of ours. Small on purpose:
// this is the only thing stopping a future-dated auth_time from being
// permanently "fresh".
const STEP_UP_CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

// ADR-0023 Part B — orchestrates the three-provider OIDC login/callback
// flow: state/PKCE/nonce generation and verification (Decision B6,
// required per security-reviewer's Part B pass, Finding 3), StaffAccount
// provisioning/role-derivation (Decision B1), and staff_session issuance
// (Decision B2).
@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    private readonly oidcClients: StaffOidcClientsService,
    private readonly pendingStaffAuthService: PendingStaffAuthService,
    private readonly staffSessionTokenService: StaffSessionTokenService,
    private readonly configService: ConfigService,
    @InjectRepository(StaffAccount)
    private readonly staffAccountRepository: Repository<StaffAccount>,
  ) {}

  /**
   * `options.stepUp` implements ADR-0022 Decision 10's step-up re-auth,
   * resolved 2026-08-08 in favour of OIDC re-authentication over the ADR's
   * literal TOTP recommendation. That recommendation was written
   * 2026-08-02 against Decision 2's world of one local admin password;
   * ADR-0023 superseded Decision 2 three days later and removed app-held
   * staff credentials entirely, so "prompt for a second app-managed
   * secret" no longer describes anything this app has. Re-running the IdP
   * flow with `prompt=login` satisfies the reviewer's actual requirement —
   * that possessing a live session must not be enough — and inherits
   * whatever MFA the provider already enforces, without this app storing a
   * second authentication secret.
   *
   * `max_age` is sent alongside `prompt=login` deliberately: OIDC makes
   * the `auth_time` claim REQUIRED in the ID token whenever `max_age` is
   * requested, which turns "the IdP says it re-authenticated the user just
   * now" into something completeLogin can actually verify, rather than
   * trusting that `prompt=login` was honoured.
   *
   * It is a real number of seconds, never `0` — see the call site. Zero
   * is what OIDC says to send for "must re-authenticate now" and is
   * exactly what several IdPs drop as falsy, taking the `auth_time`
   * claim with it and breaking this flow entirely.
   */
  async buildLoginRedirect(
    provider: StaffAuthProvider,
    options: { stepUp?: boolean } = {},
  ): Promise<StaffLoginRedirect> {
    const client = await this.oidcClients.getClient(provider);

    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const authorizationUrl = client.authorizationUrl({
      scope: SCOPE_BY_PROVIDER[provider],
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // `max_age` in SECONDS, matching our own freshness window — not
      // the `max_age: 0` this used to send.
      //
      // Zero is the pathological value: OIDC says it means "must
      // re-authenticate now", but several IdPs (Google among them) treat
      // it as falsy and drop the parameter entirely — which also drops
      // the `auth_time` claim it exists to make REQUIRED. The callback
      // then failed closed on a missing claim, which is why the Planning
      // tab returned `oauth_callback_rejected` every time rather than
      // occasionally. `prompt: 'login'` is what actually forces the
      // re-authentication; `max_age` is what makes the IdP tell us when
      // it happened.
      ...(options.stepUp
        ? { prompt: 'login', max_age: STEP_UP_MAX_AUTH_AGE_MS / 1000 }
        : {}),
      ...(provider === StaffAuthProvider.APPLE
        ? { response_mode: 'form_post' }
        : {}),
    });

    const pendingAuthCookieValue = this.pendingStaffAuthService.sign({
      provider,
      state,
      nonce,
      codeVerifier,
      ...(options.stepUp ? { stepUp: true } : {}),
    });

    return { authorizationUrl, pendingAuthCookieValue };
  }

  // Keeps openid-client's own request-parsing specifics (GET query vs.
  // Apple's form_post body) out of the controller entirely.
  async readCallbackParams(
    provider: StaffAuthProvider,
    request: Request,
  ): Promise<CallbackParamsType> {
    const client = await this.oidcClients.getClient(provider);
    return client.callbackParams(request);
  }

  async completeLogin(
    provider: StaffAuthProvider,
    pendingAuthCookieValue: string | undefined,
    callbackParams: CallbackParamsType,
  ): Promise<StaffLoginResult> {
    if (!pendingAuthCookieValue) {
      throw new StaffOAuthPendingAuthInvalidException();
    }

    let pending: PendingStaffAuthPayload;
    try {
      pending = await this.pendingStaffAuthService.verify(
        pendingAuthCookieValue,
      );
    } catch {
      throw new StaffOAuthPendingAuthInvalidException();
    }

    if (pending.provider !== provider) {
      // A callback claiming to be for one provider, presenting a
      // pending-auth cookie minted for a different one — reject the same
      // way as an outright state mismatch, not a more specific message
      // (deliberately generic, same posture as this codebase's other
      // auth-boundary exceptions).
      throw new StaffOAuthStateMismatchException();
    }

    const receivedState =
      typeof callbackParams.state === 'string'
        ? callbackParams.state
        : undefined;
    // Our own explicit check, run BEFORE ever calling into openid-client —
    // required, not left to the library's own defaults alone (Decision B6,
    // security-reviewer's Part B pass, Finding 3).
    if (!receivedState || receivedState !== pending.state) {
      throw new StaffOAuthStateMismatchException();
    }

    const client = await this.oidcClients.getClient(provider);
    const redirectUri = this.oidcClients.redirectUriFor(provider);

    let claims: IdTokenClaims;
    try {
      const tokenSet = await client.callback(redirectUri, callbackParams, {
        code_verifier: pending.codeVerifier,
        state: pending.state,
        nonce: pending.nonce,
      });
      claims = tokenSet.claims();
    } catch {
      // openid-client itself rejects a nonce mismatch, an expired/replayed
      // authorization code, or a PKCE verifier mismatch here (RPError/
      // OPError) — surfaced uniformly, never echoing the library's own
      // error text to the client.
      throw new StaffOAuthCallbackRejectedException();
    }

    // A step-up flow is only satisfied by a genuinely fresh
    // authentication. `max_age: 0` made `auth_time` REQUIRED, so a missing
    // claim means the IdP did not honour the request and this must fail
    // closed rather than quietly downgrading to an ordinary login — which
    // would hand out the freshness stamp the planning endpoints trust.
    let verifiedStepUpAt: number | undefined;
    if (pending.stepUp) {
      const authTime = claims.auth_time;
      const authTimeMs = typeof authTime === 'number' ? authTime * 1000 : null;

      // Named so a failure says WHICH condition fired. The response to
      // the client stays identical and generic — but this rejection was
      // impossible to diagnose from production without knowing whether
      // the claim was missing, stale, or future-dated, and finding that
      // out cost a round trip through the error log and a stack trace
      // mapped back through compiled JavaScript.
      const reason =
        authTimeMs === null
          ? 'auth_time missing from the ID token'
          : Date.now() - authTimeMs > STEP_UP_MAX_AUTH_AGE_MS
            ? 'auth_time older than the step-up window'
            : // Bounded in the other direction too: without this a
              // future-dated auth_time (an IdP with a fast clock) passes
              // trivially and stays "fresh" indefinitely.
              authTimeMs > Date.now() + STEP_UP_CLOCK_SKEW_TOLERANCE_MS
              ? 'auth_time is in the future beyond clock skew'
              : null;

      if (reason) {
        // Logged, never returned: the client gets the same generic
        // message whatever went wrong, and the operator gets the one
        // sentence that makes it fixable.
        this.logger.warn(
          `Step-up re-authentication rejected for ${provider}: ${reason}.`,
        );
        throw new StaffOAuthCallbackRejectedException();
      }
      verifiedStepUpAt = authTime;
    }

    const account = await this.provisionOrRefreshAccount(provider, claims);

    // A revoked account is not handed a credential, however valid the
    // OIDC round trip was. Both guards reject it per request, so this is
    // not the only barrier — but issuing a session to an account someone
    // deliberately suspended is the kind of thing that reads as working
    // until the day a guard is refactored.
    if (account.revokedAt) {
      throw new StaffAccountRevokedException();
    }

    // The step-up proof travels on the session this callback issues, not on
    // the StaffAccount row — see StaffJwtPayload.stepUpAt.
    const sessionToken = this.staffSessionTokenService.issueFor(
      account.id,
      account.role,
      { stepUpAt: verifiedStepUpAt },
    );

    return { sessionToken, account };
  }

  private async provisionOrRefreshAccount(
    provider: StaffAuthProvider,
    claims: IdTokenClaims,
  ): Promise<StaffAccount> {
    const now = new Date();
    const existing = await this.staffAccountRepository.findOne({
      where: { authProvider: provider, authProviderSubject: claims.sub },
    });

    if (existing) {
      return this.refreshExistingAccount(provider, claims, existing, now);
    }

    // First login ever for this (provider, sub) — every provider
    // (including Apple) supplies email/name on a user's very first
    // authorization; Apple just never does so again afterward (Decision
    // B1's named exception).
    if (!claims.email) {
      throw new StaffOAuthCallbackRejectedException();
    }
    const adminEmails = readAdminEmailAllowList(this.configService);
    const role = adminEmails.has(claims.email.trim().toLowerCase())
      ? StaffAccountRole.ADMIN
      : StaffAccountRole.PT;

    const created = this.staffAccountRepository.create({
      role,
      authProvider: provider,
      authProviderSubject: claims.sub,
      email: claims.email,
      displayName: claims.name ?? null,
      revokedAt: null,
      lastLoginAt: now,
    });
    try {
      return await this.staffAccountRepository.save(created);
    } catch (error) {
      if (
        isPostgresUniqueViolation(error, 'UQ_staff_account_provider_subject')
      ) {
        // Two near-simultaneous first-time logins for the same (provider,
        // sub) raced this insert — e.g. a double-click on "Sign in with
        // Google," or the callback URL opened in two tabs. Unlike the
        // screen-name/invite-code races this pattern is borrowed from, the
        // two racers here are the *same* OAuth identity, not two different
        // people contending for one resource — so the loser isn't a real
        // conflict, it's just the winner's row now existing. Re-fetch and
        // fall through to the ordinary existing-account login path. The
        // winner's insert has already committed by the time our own insert
        // fails on the constraint, so this re-fetch is not itself racy.
        const winner = await this.staffAccountRepository.findOne({
          where: { authProvider: provider, authProviderSubject: claims.sub },
        });
        if (winner) {
          return this.refreshExistingAccount(provider, claims, winner, now);
        }
      }
      throw error;
    }
  }

  private async refreshExistingAccount(
    provider: StaffAuthProvider,
    claims: IdTokenClaims,
    existing: StaffAccount,
    now: Date,
  ): Promise<StaffAccount> {
    // Google/Microsoft: refresh email/display_name/role from the fresh
    // claims every login, per Decision B1. Apple: NEVER — the claims are
    // absent on every login after the first, so the persisted values from
    // account creation stand untouched.
    if (provider !== StaffAuthProvider.APPLE) {
      if (claims.email) {
        existing.email = claims.email;
      }
      if (claims.name !== undefined) {
        existing.displayName = claims.name ?? null;
      }
      const adminEmails = readAdminEmailAllowList(this.configService);
      existing.role = adminEmails.has(existing.email.trim().toLowerCase())
        ? StaffAccountRole.ADMIN
        : StaffAccountRole.PT;
    }

    // Deliberately does NOT clear revokedAt — revocation is a separate,
    // manual lever (see StaffAccount.revokedAt's own comment) and must
    // never be undone implicitly by a successful login.
    //
    // This block used to add that a revoked account minting a fresh
    // session here was harmless, "since PtAuthGuard's by-construction zero
    // ambient authority (nothing, for pt routes pending Part A)" meant
    // there was no capability to withhold. Part A shipped, that stopped
    // being true, and both guards now reject a revoked account per
    // request. Withholding the session at login as well (see completeLogin)
    // is belt-and-braces rather than the only barrier — but a revoked
    // account should not be handed a credential at all.
    existing.lastLoginAt = now;
    return this.staffAccountRepository.save(existing);
  }
}
