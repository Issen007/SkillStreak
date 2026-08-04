import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { CallbackParamsType, IdTokenClaims, generators } from 'openid-client';
import { Repository } from 'typeorm';
import {
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

// ADR-0023 Part B — orchestrates the three-provider OIDC login/callback
// flow: state/PKCE/nonce generation and verification (Decision B6,
// required per security-reviewer's Part B pass, Finding 3), StaffAccount
// provisioning/role-derivation (Decision B1), and staff_session issuance
// (Decision B2).
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly oidcClients: StaffOidcClientsService,
    private readonly pendingStaffAuthService: PendingStaffAuthService,
    private readonly staffSessionTokenService: StaffSessionTokenService,
    private readonly configService: ConfigService,
    @InjectRepository(StaffAccount)
    private readonly staffAccountRepository: Repository<StaffAccount>,
  ) {}

  async buildLoginRedirect(
    provider: StaffAuthProvider,
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
      ...(provider === StaffAuthProvider.APPLE
        ? { response_mode: 'form_post' }
        : {}),
    });

    const pendingAuthCookieValue = this.pendingStaffAuthService.sign({
      provider,
      state,
      nonce,
      codeVerifier,
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

    const account = await this.provisionOrRefreshAccount(provider, claims);

    const sessionToken = this.staffSessionTokenService.issueFor(
      account.id,
      account.role,
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

    // Deliberately does NOT touch revokedAt either way — revocation is a
    // separate, manual lever (see StaffAccount.revokedAt's own comment)
    // never implicitly cleared by a successful login. A revoked account
    // can still mint a fresh staff_session here; what that session
    // actually grants is entirely down to AdminAuthGuard's own per-request
    // revocation check (nothing, for admin routes) and PtAuthGuard's
    // by-construction zero ambient authority (nothing, for pt routes
    // pending Part A) — so there is no meaningful capability to withhold
    // at login time itself.
    existing.lastLoginAt = now;
    return this.staffAccountRepository.save(existing);
  }
}
