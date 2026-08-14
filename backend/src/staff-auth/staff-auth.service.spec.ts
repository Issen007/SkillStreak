import {
  StaffAccountRevokedException,
  StaffOAuthCallbackRejectedException,
  StaffOAuthPendingAuthInvalidException,
  StaffOAuthStateMismatchException,
} from '../common/errors/exceptions';
import {
  StaffAccount,
  StaffAccountRole,
  StaffAuthProvider,
} from './entities/staff-account.entity';
import { StaffAuthService } from './staff-auth.service';

interface AuthorizationUrlCallArgs {
  state: string;
  nonce: string;
  code_challenge: string;
  code_challenge_method: string;
  response_mode?: string;
  prompt?: string;
  max_age?: number;
}

// ADR-0023 Decision B6 (required per security-reviewer's Part B pass,
// Finding 3 — see the ADR's Status): state/PKCE/nonce must be generated,
// held server-side, and verified on callback for all three providers.
// This spec exercises StaffAuthService directly (plain constructor
// injection with jest-mocked collaborators, same style as
// players.service.spec.ts/weekly-goal.service.spec.ts) rather than a full
// Nest TestingModule, since none of its dependencies need real DI wiring
// for these cases.
describe('StaffAuthService', () => {
  function buildService(
    options: {
      adminEmails?: string;
      existingAccount?: Partial<StaffAccount> | null;
    } = {},
  ) {
    const authorizationUrl = jest
      .fn<string, [AuthorizationUrlCallArgs]>()
      .mockReturnValue('https://provider.example/authorize?...');
    const callback = jest.fn();
    const client = { authorizationUrl, callback, callbackParams: jest.fn() };

    const oidcClients = {
      getClient: jest.fn().mockResolvedValue(client),
      redirectUriFor: jest
        .fn()
        .mockReturnValue(
          'https://api.example/api/v1/staff-auth/google/callback',
        ),
    };

    const pendingStaffAuthService = {
      sign: jest.fn().mockReturnValue('signed-pending-token'),
      verify: jest.fn(),
    };

    const staffSessionTokenService = {
      issueFor: jest.fn().mockReturnValue('signed-session-token'),
      verify: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'ADMIN_EMAILS' ? (options.adminEmails ?? '') : undefined,
      ),
    };

    const findOne = jest
      .fn()
      .mockResolvedValue(options.existingAccount ?? null);
    const create = jest.fn((data: Partial<StaffAccount>) => data);
    const save = jest.fn((entity: Partial<StaffAccount>) =>
      Promise.resolve({ id: entity.id ?? 'new-account-id', ...entity }),
    );
    const staffAccountRepository = { findOne, create, save };

    const service = new StaffAuthService(
      oidcClients as never,
      pendingStaffAuthService as never,
      staffSessionTokenService as never,
      configService as never,
      staffAccountRepository as never,
    );

    return {
      service,
      client,
      oidcClients,
      pendingStaffAuthService,
      staffSessionTokenService,
      configService,
      staffAccountRepository,
    };
  }

  describe('buildLoginRedirect', () => {
    it('generates state/nonce/PKCE and ties them to a signed pending-auth cookie', async () => {
      const { service, client, pendingStaffAuthService } = buildService();

      const result = await service.buildLoginRedirect(StaffAuthProvider.GOOGLE);

      expect(client.authorizationUrl).toHaveBeenCalledTimes(1);
      const authParams = client.authorizationUrl.mock.calls[0][0];
      expect(typeof authParams.state).toBe('string');
      expect(authParams.state.length).toBeGreaterThan(0);
      expect(typeof authParams.nonce).toBe('string');
      expect(authParams.nonce.length).toBeGreaterThan(0);
      expect(typeof authParams.code_challenge).toBe('string');
      expect(authParams.code_challenge_method).toBe('S256');

      expect(pendingStaffAuthService.sign).toHaveBeenCalledWith({
        provider: StaffAuthProvider.GOOGLE,
        state: authParams.state,
        nonce: authParams.nonce,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
        codeVerifier: expect.any(String),
      });
      expect(result.pendingAuthCookieValue).toBe('signed-pending-token');
      expect(result.authorizationUrl).toBe(
        'https://provider.example/authorize?...',
      );
    });

    // ADR-0022 Decision 10's step-up, resolved 2026-08-08 as OIDC
    // re-authentication rather than the ADR's literal TOTP (whose premise
    // — a local admin password — ADR-0023 removed three days after that
    // recommendation was written).
    it('forces a real re-authentication for a step-up flow, and records it in the pending cookie rather than a query parameter', async () => {
      const { service, client, pendingStaffAuthService } = buildService();

      await service.buildLoginRedirect(StaffAuthProvider.GOOGLE, {
        stepUp: true,
      });

      const authParams = client.authorizationUrl.mock.calls[0][0];
      expect(authParams.prompt).toBe('login');
      // max_age is what makes auth_time REQUIRED in the ID token, which is
      // what completeLogin can then actually verify — prompt alone is only
      // a request.
      // NOT 0, which is what this asserted until the Planning tab was
      // reported broken in production. OIDC says max_age=0 means "must
      // re-authenticate now", but IdPs including Google treat the zero as
      // falsy and drop the parameter — taking the REQUIRED `auth_time`
      // claim with it, so the callback then failed closed on a missing
      // claim every single time. A real number in seconds is what makes
      // the IdP report when it authenticated; `prompt: 'login'` is what
      // forces it to.
      expect(authParams.max_age).toBe(300);
      expect(authParams.prompt).toBe('login');
      expect(pendingStaffAuthService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ stepUp: true }),
      );
    });

    it('does not request re-authentication for an ordinary login', async () => {
      const { service, client, pendingStaffAuthService } = buildService();

      await service.buildLoginRedirect(StaffAuthProvider.GOOGLE);

      const authParams = client.authorizationUrl.mock.calls[0][0];
      expect(authParams.prompt).toBeUndefined();
      expect(authParams.max_age).toBeUndefined();
      expect(pendingStaffAuthService.sign).toHaveBeenCalledWith(
        expect.not.objectContaining({ stepUp: true }),
      );
    });

    it('requests Apple in form_post response mode (required whenever name/email scope is requested)', async () => {
      const { service, client } = buildService();

      await service.buildLoginRedirect(StaffAuthProvider.APPLE);

      const authParams = client.authorizationUrl.mock.calls[0][0];
      expect(authParams.response_mode).toBe('form_post');
    });
  });

  describe('completeLogin — state/nonce rejection (security-reviewer Finding 3)', () => {
    it('rejects a callback with no pending-auth cookie at all, without ever calling the OIDC client', async () => {
      const { service, client } = buildService();

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, undefined, {
          state: 'whatever',
        }),
      ).rejects.toBeInstanceOf(StaffOAuthPendingAuthInvalidException);
      expect(client.callback).not.toHaveBeenCalled();
    });

    it('rejects a callback whose pending-auth cookie fails to verify (missing/invalid/expired)', async () => {
      const { service, client, pendingStaffAuthService } = buildService();
      pendingStaffAuthService.verify.mockRejectedValue(
        new Error('jwt expired'),
      );

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'stale-cookie', {
          state: 'whatever',
        }),
      ).rejects.toBeInstanceOf(StaffOAuthPendingAuthInvalidException);
      expect(client.callback).not.toHaveBeenCalled();
    });

    it('rejects a callback whose state parameter does not match the one minted at login, without ever calling the OIDC client', async () => {
      const { service, client, pendingStaffAuthService } = buildService();
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 'expected-state',
        nonce: 'expected-nonce',
        codeVerifier: 'expected-verifier',
      });

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
          state: 'attacker-supplied-state',
        }),
      ).rejects.toBeInstanceOf(StaffOAuthStateMismatchException);
      // The whole point of Finding 3's fix: our own state check runs
      // BEFORE ever exchanging the code with the provider — an attacker
      // presenting a mismatched state can never reach the token exchange.
      expect(client.callback).not.toHaveBeenCalled();
    });

    it('rejects a callback with no state parameter at all', async () => {
      const { service, client, pendingStaffAuthService } = buildService();
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 'expected-state',
        nonce: 'expected-nonce',
        codeVerifier: 'expected-verifier',
      });

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {}),
      ).rejects.toBeInstanceOf(StaffOAuthStateMismatchException);
      expect(client.callback).not.toHaveBeenCalled();
    });

    it('rejects a callback for a different provider than the one the pending-auth cookie was minted for', async () => {
      const { service, client, pendingStaffAuthService } = buildService();
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.MICROSOFT,
        state: 'expected-state',
        nonce: 'expected-nonce',
        codeVerifier: 'expected-verifier',
      });

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
          state: 'expected-state',
        }),
      ).rejects.toBeInstanceOf(StaffOAuthStateMismatchException);
      expect(client.callback).not.toHaveBeenCalled();
    });

    it('passes the expected state/nonce/code_verifier to the OIDC client, and rejects if it throws (e.g. a nonce mismatch)', async () => {
      const { service, client, pendingStaffAuthService } = buildService();
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 'expected-state',
        nonce: 'expected-nonce',
        codeVerifier: 'expected-verifier',
      });
      // Simulates openid-client's own internal nonce-mismatch rejection
      // (an RPError) during the token exchange.
      client.callback.mockRejectedValue(new Error('nonce mismatch'));

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
          state: 'expected-state',
          code: 'auth-code',
        }),
      ).rejects.toBeInstanceOf(StaffOAuthCallbackRejectedException);

      expect(client.callback).toHaveBeenCalledWith(
        'https://api.example/api/v1/staff-auth/google/callback',
        { state: 'expected-state', code: 'auth-code' },
        {
          code_verifier: 'expected-verifier',
          state: 'expected-state',
          nonce: 'expected-nonce',
        },
      );
    });
  });

  describe('completeLogin — account provisioning (Decision B1)', () => {
    function mockSuccessfulCallback(
      client: { callback: jest.Mock },
      claims: Record<string, unknown>,
    ) {
      client.callback.mockResolvedValue({ claims: () => claims });
    }

    // The step-up flow is only satisfied by a genuinely fresh
    // authentication. Since `max_age: 0` makes auth_time REQUIRED, a
    // missing or old claim means the IdP did not honour the request — and
    // this must fail closed rather than silently downgrading to an
    // ordinary login, which would hand out the freshness stamp
    // AdminStepUpGuard trusts.
    it('rejects a step-up callback whose ID token carries no auth_time claim', async () => {
      const { service, client, pendingStaffAuthService } = buildService({
        adminEmails: 'boss@example.com',
      });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
        stepUp: true,
      });
      mockSuccessfulCallback(client, {
        sub: 'google-sub-1',
        email: 'boss@example.com',
      });

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
          state: 's',
          code: 'c',
        }),
      ).rejects.toBeInstanceOf(StaffOAuthCallbackRejectedException);
    });

    it('rejects a step-up callback whose auth_time is too old to be this re-authentication', async () => {
      const { service, client, pendingStaffAuthService } = buildService({
        adminEmails: 'boss@example.com',
      });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
        stepUp: true,
      });
      mockSuccessfulCallback(client, {
        sub: 'google-sub-1',
        email: 'boss@example.com',
        auth_time: Math.floor((Date.now() - 60 * 60 * 1000) / 1000),
      });

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
          state: 's',
          code: 'c',
        }),
      ).rejects.toBeInstanceOf(StaffOAuthCallbackRejectedException);
    });

    it('accepts a step-up callback with a fresh auth_time', async () => {
      const { service, client, pendingStaffAuthService } = buildService({
        adminEmails: 'boss@example.com',
      });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
        stepUp: true,
      });
      mockSuccessfulCallback(client, {
        sub: 'google-sub-1',
        email: 'boss@example.com',
        auth_time: Math.floor(Date.now() / 1000),
      });

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
          state: 's',
          code: 'c',
        }),
      ).resolves.toMatchObject({ sessionToken: 'signed-session-token' });
    });

    // An ordinary login must not start demanding a claim it never asked
    // for — only the step-up flow requests max_age, so only it can rely on
    // auth_time being present.
    it('does not require auth_time for an ordinary (non-step-up) login', async () => {
      const { service, client, pendingStaffAuthService } = buildService({
        adminEmails: 'boss@example.com',
      });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });
      mockSuccessfulCallback(client, {
        sub: 'google-sub-1',
        email: 'boss@example.com',
      });

      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
          state: 's',
          code: 'c',
        }),
      ).resolves.toMatchObject({ sessionToken: 'signed-session-token' });
    });

    it('creates a new admin-role account for an email on ADMIN_EMAILS at first login', async () => {
      const {
        service,
        client,
        pendingStaffAuthService,
        staffAccountRepository,
      } = buildService({ adminEmails: 'Boss@Example.com' });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });
      mockSuccessfulCallback(client, {
        sub: 'google-sub-1',
        email: 'boss@example.com',
        name: 'The Boss',
      });

      const result = await service.completeLogin(
        StaffAuthProvider.GOOGLE,
        'pending-cookie',
        { state: 's', code: 'c' },
      );

      expect(staffAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: StaffAccountRole.ADMIN }),
      );
      expect(result.sessionToken).toBe('signed-session-token');
    });

    it('creates a new pt-role account by default for an email not on ADMIN_EMAILS', async () => {
      const {
        service,
        client,
        pendingStaffAuthService,
        staffAccountRepository,
      } = buildService({ adminEmails: 'boss@example.com' });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });
      mockSuccessfulCallback(client, {
        sub: 'google-sub-2',
        email: 'new-pt@example.com',
        name: 'A PT',
      });

      await service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
        state: 's',
        code: 'c',
      });

      expect(staffAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: StaffAccountRole.PT }),
      );
    });

    it('falls back to the existing-account login path when two first-time logins for the same identity race the insert (code-critic finding)', async () => {
      const {
        service,
        client,
        pendingStaffAuthService,
        staffAccountRepository,
      } = buildService({ adminEmails: 'boss@example.com' });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });
      mockSuccessfulCallback(client, {
        sub: 'google-sub-race',
        email: 'boss@example.com',
        name: 'The Boss',
      });

      // First findOne (before the insert attempt) sees nothing; the insert
      // then loses the race to a concurrent request for the same
      // (provider, sub) and fails on the unique index; the second findOne
      // (after catching the violation) sees the winner's already-committed
      // row.
      const winnerRow: Partial<StaffAccount> = {
        id: 'winner-account-id',
        role: StaffAccountRole.PT,
        authProvider: StaffAuthProvider.GOOGLE,
        authProviderSubject: 'google-sub-race',
        email: 'boss@example.com',
        displayName: 'The Boss',
        revokedAt: null,
      };
      staffAccountRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winnerRow);
      staffAccountRepository.save.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'UQ_staff_account_provider_subject',
        }),
      );

      const result = await service.completeLogin(
        StaffAuthProvider.GOOGLE,
        'pending-cookie',
        { state: 's', code: 'c' },
      );

      // Recovers via the existing-account path (refreshes role/email from
      // the live claims/allow-list) rather than throwing a 500 to the user.
      expect(staffAccountRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'winner-account-id',
          role: StaffAccountRole.ADMIN,
        }),
      );
      expect(result.sessionToken).toBe('signed-session-token');
    });

    it('rejects a brand-new account with no email claim at all (required even for Apple, on its first login only)', async () => {
      const { service, client, pendingStaffAuthService } = buildService();
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.APPLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });
      mockSuccessfulCallback(client, { sub: 'apple-sub-1' });

      await expect(
        service.completeLogin(StaffAuthProvider.APPLE, 'pending-cookie', {
          state: 's',
        }),
      ).rejects.toBeInstanceOf(StaffOAuthCallbackRejectedException);
    });

    it('refreshes email/display_name/role from fresh claims for an existing Google/Microsoft account', async () => {
      const {
        service,
        client,
        pendingStaffAuthService,
        staffAccountRepository,
      } = buildService({
        adminEmails: 'new-admin@example.com',
        existingAccount: {
          id: 'existing-1',
          role: StaffAccountRole.PT,
          authProvider: StaffAuthProvider.GOOGLE,
          authProviderSubject: 'google-sub-3',
          email: 'old-email@example.com',
          displayName: 'Old Name',
          revokedAt: null,
        },
      });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });
      mockSuccessfulCallback(client, {
        sub: 'google-sub-3',
        email: 'new-admin@example.com',
        name: 'New Name',
      });

      await service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
        state: 's',
        code: 'c',
      });

      expect(staffAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new-admin@example.com',
          displayName: 'New Name',
          // Re-derived from the fresh email against ADMIN_EMAILS — proves
          // this isn't just carrying the old 'pt' role forward.
          role: StaffAccountRole.ADMIN,
        }),
      );
    });

    it('never refreshes email/display_name/role for an existing Apple account, even though claims omit them (Decision B1 named exception)', async () => {
      const {
        service,
        client,
        pendingStaffAuthService,
        staffAccountRepository,
      } = buildService({
        adminEmails: 'frozen-apple-email@example.com',
        existingAccount: {
          id: 'existing-apple-1',
          role: StaffAccountRole.PT,
          authProvider: StaffAuthProvider.APPLE,
          authProviderSubject: 'apple-sub-1',
          email: 'frozen-apple-email@example.com',
          displayName: 'Frozen Name',
          revokedAt: null,
        },
      });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.APPLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });
      // Every login after the first omits email/name entirely — a hard
      // Apple platform behavior, not something this test invents.
      mockSuccessfulCallback(client, { sub: 'apple-sub-1' });

      await service.completeLogin(StaffAuthProvider.APPLE, 'pending-cookie', {
        state: 's',
        code: 'c',
      });

      expect(staffAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'frozen-apple-email@example.com',
          displayName: 'Frozen Name',
          // Role also stays exactly as first-set for Apple — there is no
          // live email claim to re-derive it from on this login.
          role: StaffAccountRole.PT,
        }),
      );
    });

    it('never clears revokedAt on a successful login — revocation is a separate, manual lever', async () => {
      const revokedAt = new Date('2026-01-01T00:00:00Z');
      const {
        service,
        client,
        pendingStaffAuthService,
        staffAccountRepository,
      } = buildService({
        existingAccount: {
          id: 'revoked-1',
          role: StaffAccountRole.PT,
          authProvider: StaffAuthProvider.GOOGLE,
          authProviderSubject: 'google-sub-revoked',
          email: 'revoked@example.com',
          displayName: 'Revoked',
          revokedAt,
        },
      });
      pendingStaffAuthService.verify.mockResolvedValue({
        provider: StaffAuthProvider.GOOGLE,
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });
      mockSuccessfulCallback(client, {
        sub: 'google-sub-revoked',
        email: 'revoked@example.com',
        name: 'Revoked',
      });

      // Changed 2026-08-11: a revoked account is no longer handed a
      // session at all. The property this test exists for — that a
      // successful login never quietly un-revokes an account — is still
      // asserted below, and is now joined by the stronger one.
      await expect(
        service.completeLogin(StaffAuthProvider.GOOGLE, 'pending-cookie', {
          state: 's',
          code: 'c',
        }),
      ).rejects.toBeInstanceOf(StaffAccountRevokedException);

      expect(staffAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt }),
      );
    });
  });
});
