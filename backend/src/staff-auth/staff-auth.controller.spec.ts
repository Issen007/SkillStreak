import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { StaffAuthController } from './staff-auth.controller';
import type { StaffAuthService } from './staff-auth.service';
import {
  STAFF_CONSOLE_PATH,
  STAFF_PENDING_AUTH_COOKIE_NAME,
  STAFF_SESSION_COOKIE_NAME,
} from './staff-cookies';

/**
 * Covers what happens *after* a successful sign-in.
 *
 * This existed as `res.json({ ok: true })` for the whole of ADR-0023, which
 * technically worked and was useless: the only caller of this endpoint is a
 * browser finishing an OIDC round trip, and it landed on raw JSON. These
 * tests exist so that reverting to a JSON body — an easy thing to do while
 * refactoring, and invisible to every other test — fails loudly.
 */
describe('StaffAuthController (callback landing)', () => {
  function setup() {
    const staffAuthService = {
      readCallbackParams: jest.fn().mockResolvedValue({ code: 'c' }),
      completeLogin: jest.fn().mockResolvedValue({ sessionToken: 'token-1' }),
    } as unknown as StaffAuthService;

    const controller = new StaffAuthController(
      staffAuthService,
      new ConfigService({}),
    );

    // Held as plain jest.fn()s rather than read back off `res`, so the
    // assertions below never reference an unbound method.
    const mocks = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn(),
      json: jest.fn(),
    };
    const res = {
      ...mocks,
      status: jest.fn().mockReturnThis(),
    } as unknown as Response;

    const req = {
      cookies: { [STAFF_PENDING_AUTH_COOKIE_NAME]: 'pending' },
    } as unknown as Request;

    return { controller, res, req, mocks, staffAuthService };
  }

  it('redirects a completed sign-in to the console instead of answering JSON', async () => {
    const { controller, res, req, mocks } = setup();

    await controller.callbackGet('google', req, res);

    expect(mocks.redirect).toHaveBeenCalledWith(302, STAFF_CONSOLE_PATH);
    expect(mocks.json).not.toHaveBeenCalled();
  });

  it("redirects Apple's form_post callback to the same place", async () => {
    const { controller, res, req, mocks } = setup();

    await controller.callbackPost('apple', req, res);

    expect(mocks.redirect).toHaveBeenCalledWith(302, STAFF_CONSOLE_PATH);
    expect(mocks.json).not.toHaveBeenCalled();
  });

  it('still sets the session cookie and clears the pending one', async () => {
    const { controller, res, req, mocks } = setup();

    await controller.callbackGet('google', req, res);

    const [name, value, options] = mocks.cookie.mock.calls.find(
      ([cookieName]) => cookieName === STAFF_SESSION_COOKIE_NAME,
    ) as [string, string, { sameSite: string; httpOnly: boolean }];

    expect(name).toBe(STAFF_SESSION_COOKIE_NAME);
    expect(value).toBe('token-1');
    // Strict is what makes the same-origin console requirement real — if
    // this ever relaxes, the console could move off-origin, so pin it.
    expect(options.sameSite).toBe('strict');
    expect(options.httpOnly).toBe(true);
    expect(mocks.clearCookie).toHaveBeenCalledWith(
      STAFF_PENDING_AUTH_COOKIE_NAME,
      expect.anything(),
    );
  });

  it('redirects to a fixed path, never to anything caller-supplied', () => {
    // The redirect target is a module constant, not a request value. A
    // `?next=` here would be an open redirect on the one endpoint that has
    // just minted a session cookie.
    expect(STAFF_CONSOLE_PATH.startsWith('/')).toBe(true);
    expect(STAFF_CONSOLE_PATH).not.toMatch(/^\/\//); // not protocol-relative
  });
});

describe('StaffAuthController: provider availability', () => {
  function build(configured: string[]) {
    const oidcClients = {
      configuredProviders: jest.fn().mockReturnValue(configured),
      isConfigured: jest.fn((p: string) => configured.includes(p)),
    };
    const controller = new StaffAuthController(
      {} as never,
      { get: jest.fn() } as never,
      {} as never,
      oidcClients as never,
    );
    return { controller, oidcClients };
  }

  it('advertises only providers with a registered OAuth application', () => {
    // The console draws its buttons from this. Listing an unregistered
    // provider is what sent operators into a 500 on a dead button.
    expect(build(['google']).controller.providers()).toEqual({
      providers: ['google'],
    });
  });

  it('reports an empty list rather than guessing when nothing is set up', () => {
    expect(build([]).controller.providers()).toEqual({ providers: [] });
  });

  it('exposes provider names only — never a client id or redirect URI', () => {
    // The route is unauthenticated by necessity (it is read before anyone
    // signs in), so the shape of the response is the control.
    const body = build(['google', 'apple']).controller.providers();
    expect(Object.keys(body)).toEqual(['providers']);
    expect(JSON.stringify(body)).toBe('{"providers":["google","apple"]}');
  });

  it('refuses an unconfigured provider with 503, not 500', async () => {
    // 500 reads as "this is broken"; the OAuth application simply has not
    // been registered for this deployment.
    const { controller } = build(['google']);
    await expect(
      controller.login('microsoft', {} as never),
    ).rejects.toMatchObject({ status: 503 });
  });
});
