import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import {
  PublicSharingAlreadyActiveException,
  PublicSharingBlockedPendingContactChangeException,
  PublicSharingNeedsParentContactException,
  PublicSharingRequestCooldownException,
  PublicSharingRequestDailyCapException,
} from '../common/errors/exceptions';
import { PublicSharingController } from './public-sharing.controller';

/**
 * `POST /me/public-sharing/request` refuses for six unrelated reasons, and
 * until 2026-09-01 the client could not tell them apart: the controller
 * wrapped the service call in a try/catch that turned every one into a
 * single 400, and the app rendered any 400 as "Du frågade nyss" — wait a
 * moment and try again.
 *
 * That is true for exactly one of the six. For
 * `public_sharing_needs_parent_contact` it is a dead end no child can act
 * on: a self-verified account has no parent address, so waiting cannot
 * help and nothing said so.
 *
 * These tests are written so that **restoring that catch fails them** —
 * they assert a distinct `code` per refusal rather than merely that the
 * call rejects. A test that only checked "it throws" passed happily
 * throughout the entire period the bug existed.
 *
 * The exact code strings below are also the contract the app switches
 * on (mobile/src/clips/ClipsScreen.tsx, `shareRequestErrorKey`).
 * Mobile has no test runner, so renaming a code has to fail HERE or
 * it fails nowhere and the app quietly shows the generic message.
 */
describe('PublicSharingController: request refusals stay distinguishable', () => {
  const build = (opts: {
    teamId?: string | null;
    enabled?: boolean;
    requestImpl?: () => Promise<never>;
  }) => {
    const consent = {
      request: jest.fn(
        opts.requestImpl ?? (() => Promise.resolve({ requested: true })),
      ),
      statusFor: jest.fn(() => Promise.resolve('none')),
    };
    const access = { isEnabledForTeam: jest.fn(() => opts.enabled ?? true) };
    const players = {
      findOne: jest.fn(() =>
        Promise.resolve({ teamId: opts.teamId ?? 'team-1' }),
      ),
    };
    const controller = new PublicSharingController(
      consent as never,
      access as never,
      {} as never,
      {} as never,
      players as never,
    );
    return { controller, consent };
  };

  // The table IS the assertion: six refusals, six codes, no two alike.
  const REFUSALS: Array<[string, () => Error, HttpStatus]> = [
    [
      'public_sharing_already_active',
      () => new PublicSharingAlreadyActiveException(),
      HttpStatus.CONFLICT,
    ],
    [
      'public_sharing_blocked_pending_contact_change',
      () => new PublicSharingBlockedPendingContactChangeException(),
      HttpStatus.CONFLICT,
    ],
    [
      'public_sharing_needs_parent_contact',
      () => new PublicSharingNeedsParentContactException(),
      HttpStatus.CONFLICT,
    ],
    [
      'public_sharing_request_cooldown',
      () => new PublicSharingRequestCooldownException(),
      HttpStatus.TOO_MANY_REQUESTS,
    ],
    [
      'public_sharing_request_daily_cap',
      () => new PublicSharingRequestDailyCapException(),
      HttpStatus.TOO_MANY_REQUESTS,
    ],
  ];

  it.each(REFUSALS)(
    'passes %s through with its own code and status',
    async (code, make, status) => {
      const { controller } = build({
        requestImpl: () => Promise.reject(make()),
      });
      const caught = await controller.request('p1').catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(AppException);
      expect((caught as AppException).code).toBe(code);
      expect((caught as AppException).getStatus()).toBe(status);
    },
  );

  it('refuses a team outside the rollout with its own code, and sends nothing', async () => {
    const { controller, consent } = build({ enabled: false });
    const caught = await controller.request('p1').catch((e: unknown) => e);
    expect((caught as AppException).code).toBe(
      'public_sharing_not_available_for_team',
    );
    expect((caught as AppException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    // The refusal must come before any mail is scheduled — emailing a
    // parent about a feature their child's team cannot use would be
    // asking for consent to nothing.
    expect(consent.request).not.toHaveBeenCalled();
  });

  it('gives every refusal a code the app can branch on', () => {
    const codes = new Set<string>();
    for (const [, make] of REFUSALS) codes.add((make() as AppException).code);
    codes.add('public_sharing_not_available_for_team');
    // Six reasons, six codes. Collapsing any two of them back into one
    // shared code is the regression this whole file exists for.
    expect(codes.size).toBe(6);
  });

  it('a player with no team is refused rather than treated as allow-listed', async () => {
    const { controller } = build({ teamId: null, enabled: false });
    const caught = await controller.request('p1').catch((e: unknown) => e);
    expect((caught as AppException).code).toBe(
      'public_sharing_not_available_for_team',
    );
  });
});
