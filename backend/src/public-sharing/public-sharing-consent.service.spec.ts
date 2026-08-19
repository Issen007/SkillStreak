import { Repository } from 'typeorm';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import {
  PublicSharingConsent,
  PublicSharingConsentStatus,
  PublicSharingRevokedReason,
} from './entities/public-sharing-consent.entity';
import {
  MAX_REMINDER_FAILURES,
  PublicSharingConsentService,
  REMINDER_INTERVAL_MS,
} from './public-sharing-consent.service';

/**
 * ADR-0030's consent lifecycle.
 *
 * A fake repository rather than a TypeORM test module: everything worth
 * asserting here is decision logic — when a consent activates, when it
 * stops, and what a failed reminder counts as — and none of it is about
 * SQL. Findings that need a real database belong in the e2e suite.
 */

/** Minimal in-memory stand-in for the one repository the service uses. */
function fakeRepo() {
  const rows: PublicSharingConsent[] = [];
  const matches = (row: PublicSharingConsent, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const actual = (row as unknown as Record<string, unknown>)[k];
      // The only operator the service uses is LessThanOrEqual, on a date.
      if (v && typeof v === 'object' && '_type' in v) {
        const value = (v as unknown as { _value: Date })._value;
        return actual instanceof Date && actual.getTime() <= value.getTime();
      }
      return actual === v;
    });

  return {
    rows,
    create: (partial: Partial<PublicSharingConsent>) =>
      ({
        id: `id-${rows.length + 1}`,
        status: PublicSharingConsentStatus.PENDING_REVIEW,
        reviewCode: null,
        reviewCodeExpiresAt: null,
        revokeCode: null,
        requestedAt: new Date(),
        approvedAt: null,
        declinedAt: null,
        revokedAt: null,
        revokedReason: null,
        lastReminderAt: null,
        reminderFailureCount: 0,
        ...partial,
      }) as PublicSharingConsent,
    save: jest.fn((row: PublicSharingConsent) => {
      if (!rows.includes(row)) rows.push(row);
      return Promise.resolve(row);
    }),
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    ),
    find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((r) => matches(r, where))),
    ),
    // The locked reads go through a query builder rather than findOne.
    // Only the three calls the service makes are supported: setLock,
    // where('c.<column> = :code'), getOne.
    createQueryBuilder: () => {
      let column: string | null = null;
      let value: unknown = null;
      const qb = {
        setLock: () => qb,
        where: (clause: string, params: Record<string, unknown>) => {
          column = clause.includes('review_code') ? 'reviewCode' : 'revokeCode';
          value = params.code;
          return qb;
        },
        getOne: () =>
          Promise.resolve(
            rows.find(
              (r) =>
                column !== null &&
                (r as unknown as Record<string, unknown>)[column] === value,
            ) ?? null,
          ),
      };
      return qb;
    },
    update: jest.fn((id: string, patch: Partial<PublicSharingConsent>) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return Promise.resolve({ affected: row ? 1 : 0 });
    }),
  };
}

function build(
  parentContact: string | null = 'parent@example.se',
  pendingContactChange = false,
) {
  const repo = fakeRepo();
  const privateInfo = {
    getParentContact: jest.fn(() => Promise.resolve(parentContact)),
    hasPendingContactChange: jest.fn(() =>
      Promise.resolve(pendingContactChange),
    ),
  } as unknown as PlayerPrivateInfoService;
  const mailService = {
    sendMail: jest.fn(() => Promise.resolve({ handedOff: true, rejected: [] })),
  };
  const redisService = {
    tryClaimPublicSharingRequestCooldown: jest.fn(() => Promise.resolve(true)),
    tryClaimPublicSharingRequestDailyCap: jest.fn(() => Promise.resolve(true)),
  };
  // Runs the callback inline against the same fake repository, which is
  // all these tests need — the lock itself is a database behaviour and
  // belongs to the e2e suite, not here.
  const dataSource = {
    transaction: (fn: (m: unknown) => unknown) =>
      Promise.resolve(fn({ getRepository: () => repo })),
  };
  const configService = {
    getOrThrow: jest.fn(() => 'Y2ktb25seS10ZXN0LWtleS0zMi1ieXRlcy1sb25nISE='),
    get: jest.fn(() => 'https://api.example.test'),
  };
  // Only ever read for screen_name — the name the parent's consent page
  // and request email use to say *which* child is being consented for.
  const players = {
    findOne: jest.fn().mockResolvedValue({ screenName: 'FloorballStar15' }),
  };
  const service = new PublicSharingConsentService(
    repo as unknown as Repository<PublicSharingConsent>,
    players as never,
    dataSource as never,
    privateInfo,
    mailService as never,
    redisService as never,
    configService as never,
  );
  // The codes never leave the service (finding 1), so tests read them
  // from the row exactly as the database would hold them.
  const reviewCodeOf = () => repo.rows[0].reviewCode!;
  const revokeCodeOf = () => repo.rows[0].revokeCode!;
  return {
    service,
    repo,
    players,
    privateInfo,
    mailService,
    redisService,
    reviewCodeOf,
    revokeCodeOf,
  };
}

describe('PublicSharingConsentService: granting', () => {
  it('refuses to request without a parent contact', async () => {
    // Decision 10. The monthly reminder is the design's only recurring
    // control, so an account with no recipient for it would have none.
    const { service, repo } = build(null);

    await expect(service.request('p1')).rejects.toThrow(/parent contact/i);
    expect(repo.rows).toHaveLength(0);
  });

  it('starts inactive — a request is not a consent', async () => {
    const { service } = build();
    await service.request('p1');

    expect(await service.isActiveFor('p1')).toBe(false);
  });

  it('activates on approval and issues a revoke code', async () => {
    const { service, reviewCodeOf } = build();
    await service.request('p1');
    const reviewCode = reviewCodeOf();

    const result = await service.approveByReviewCode(reviewCode);

    expect(result).toEqual({ approved: true });
    expect(await service.isActiveFor('p1')).toBe(true);
  });

  it('starts the reminder clock at the grant, not at a calendar boundary', async () => {
    // Decision 6: a family that opts in on the 20th hears on the 20th.
    const { service, repo, reviewCodeOf } = build();
    await service.request('p1');
    const reviewCode = reviewCodeOf();
    await service.approveByReviewCode(reviewCode);

    expect(repo.rows[0].lastReminderAt).toBeInstanceOf(Date);
  });

  it('does not approve on an expired review code', async () => {
    const { service, repo, reviewCodeOf } = build();
    await service.request('p1');
    const reviewCode = reviewCodeOf();
    repo.rows[0].reviewCodeExpiresAt = new Date(Date.now() - 1000);

    expect(await service.approveByReviewCode(reviewCode)).toBeNull();
    expect(await service.isActiveFor('p1')).toBe(false);
  });

  it('declining leaves it inactive and burns the code', async () => {
    const { service, reviewCodeOf } = build();
    await service.request('p1');
    const reviewCode = reviewCodeOf();

    expect(await service.declineByReviewCode(reviewCode)).toEqual({
      declined: true,
    });
    expect(await service.isActiveFor('p1')).toBe(false);
    // The same link must not then approve it.
    expect(await service.approveByReviewCode(reviewCode)).toBeNull();
  });
});

describe('PublicSharingConsentService: revoking', () => {
  async function activated() {
    const built = build();
    await built.service.request('p1');
    const reviewCode = built.reviewCodeOf();
    await built.service.approveByReviewCode(reviewCode);
    return { ...built, revokeCode: built.revokeCodeOf() };
  }

  it('revokes immediately, with no confirmation step', async () => {
    const { service, revokeCode } = await activated();

    expect(await service.revokeByRevokeCode(revokeCode)).toEqual({
      revoked: true,
    });
    expect(await service.isActiveFor('p1')).toBe(false);
  });

  it('keeps the row — revoking publication is not a deletion request', async () => {
    const { service, repo, revokeCode } = await activated();
    await service.revokeByRevokeCode(revokeCode);

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].revokedReason).toBe(
      PublicSharingRevokedReason.PARENT_REVOKED,
    );
  });

  it('cannot be re-approved or re-revoked from old links', async () => {
    const { service, revokeCode } = await activated();
    await service.revokeByRevokeCode(revokeCode);

    // Both codes are cleared on deactivate, so neither link does anything.
    expect(await service.revokeByRevokeCode(revokeCode)).toBeNull();
    expect(await service.isActiveFor('p1')).toBe(false);
  });

  it('re-requesting after a revoke is a fresh grant, not an undo', async () => {
    // Decision 2: re-enabling must not silently restore an old audience.
    const { service, revokeCode } = await activated();
    await service.revokeByRevokeCode(revokeCode);

    await service.request('p1');
    expect(await service.isActiveFor('p1')).toBe(false);
  });
});

describe('PublicSharingConsentService: the monthly reminder', () => {
  async function activated() {
    const built = build();
    await built.service.request('p1');
    const reviewCode = built.reviewCodeOf();
    await built.service.approveByReviewCode(reviewCode);
    return built;
  }

  it('is not due immediately after the grant', async () => {
    const { service } = await activated();
    expect(await service.findDueReminders()).toHaveLength(0);
  });

  it('is due a month later', async () => {
    const { service } = await activated();
    const later = new Date(Date.now() + REMINDER_INTERVAL_MS + 1000);

    expect(await service.findDueReminders(later)).toHaveLength(1);
  });

  it('is not due for a revoked consent', async () => {
    const { service, repo } = await activated();
    repo.rows[0].status = PublicSharingConsentStatus.REVOKED;
    const later = new Date(Date.now() + REMINDER_INTERVAL_MS + 1000);

    expect(await service.findDueReminders(later)).toHaveLength(0);
  });

  it('survives one undeliverable reminder', async () => {
    // Decision 5 disables at two, not one — a parent whose mail server
    // had one bad afternoon should not lose the consent for it.
    const { service, repo } = await activated();

    const result = await service.recordReminderFailure(repo.rows[0].id);

    expect(result.disabled).toBe(false);
    expect(await service.isActiveFor('p1')).toBe(true);
  });

  it('disables on the second consecutive failure', async () => {
    const { service, repo } = await activated();
    const id = repo.rows[0].id;

    await service.recordReminderFailure(id);
    const result = await service.recordReminderFailure(id);

    expect(result.disabled).toBe(true);
    expect(await service.isActiveFor('p1')).toBe(false);
    expect(repo.rows[0].revokedReason).toBe(
      PublicSharingRevokedReason.REMINDER_UNDELIVERABLE,
    );
  });

  it('advances the clock on failure, so two failures take two months', async () => {
    // Without this, a permanently undeliverable address stays perpetually
    // due, is retried on every sweep, and reaches the disable threshold
    // in minutes — turning "two missed months" into "two attempts".
    const { service, repo } = await activated();
    const id = repo.rows[0].id;
    await service.recordReminderFailure(id);

    expect(await service.findDueReminders()).toHaveLength(0);
  });

  it('a delivered reminder clears the failure streak', async () => {
    const { service, repo } = await activated();
    const id = repo.rows[0].id;
    await service.recordReminderFailure(id);

    await service.recordReminderSent(id);

    expect(repo.rows[0].reminderFailureCount).toBe(0);
    // And the next single failure must not now disable it.
    expect((await service.recordReminderFailure(id)).disabled).toBe(false);
  });

  it('needs fewer failures than a month has sweeps to matter', () => {
    // Guards the constant itself: if MAX_REMINDER_FAILURES were ever
    // raised to something large, "fails closed" would quietly become
    // "stays open indefinitely behind a dead address".
    expect(MAX_REMINDER_FAILURES).toBeLessThanOrEqual(3);
  });
});

/**
 * The blocking security-review findings, 2026-08-17. Each of these
 * would have passed before the fix, which is the point of pinning them.
 */
describe('PublicSharingConsentService: security-review findings', () => {
  it('never returns the approval code to its caller (finding 1)', async () => {
    const { service } = build();

    const result = await service.request('p1');

    // The link's only exit from this process is the parent's inbox.
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'requested']);
    expect(JSON.stringify(result)).not.toContain('reviewCode');
  });

  it('mails the parent rather than handing the code back (finding 1)', async () => {
    const { service, mailService, reviewCodeOf } = build();
    await service.request('p1');

    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    const sent = mailService.sendMail.mock.calls[0][0] as {
      to: string;
      text: string;
    };
    expect(sent.to).toBe('parent@example.se');
    expect(sent.text).toContain(reviewCodeOf());
  });

  it('refuses while a contact change is pending (finding 3)', async () => {
    // Otherwise a player repoints the parent contact at an address they
    // control, waits out the grace period, and approves their own consent.
    const { service, repo } = build('parent@example.se', true);

    await expect(service.request('p1')).rejects.toThrow(/contact change/i);
    expect(repo.rows).toHaveLength(0);
  });

  it('freezes the granting address so later mail cannot be repointed (finding 3)', async () => {
    const { service, repo } = build();
    await service.request('p1');

    expect(repo.rows[0].recipientContactSnapshot).toBeTruthy();
    // Encrypted at rest, not the bare address.
    expect(repo.rows[0].recipientContactSnapshot).not.toContain('parent@');
  });

  it('refuses to re-request over an active consent (finding 7)', async () => {
    // Overwriting in place skipped deactivate(), and with it ADR-0019's
    // un-publish hook — leaving clips published with no consent behind
    // them — and erased the record that a parent ever approved.
    const { service, reviewCodeOf } = build();
    await service.request('p1');
    await service.approveByReviewCode(reviewCodeOf());

    await expect(service.request('p1')).rejects.toThrow(/already active/i);
    expect(await service.isActiveFor('p1')).toBe(true);
  });

  it('preview does not mutate or decide (finding 2)', async () => {
    const { service, repo, reviewCodeOf } = build();
    await service.request('p1');
    const before = { ...repo.rows[0] };

    const preview = await service.previewByReviewCode(reviewCodeOf());

    expect(preview).toEqual({
      playerId: 'p1',
      status: 'pending_review',
      // Screen name, never real name — the parent has to know which of
      // their children they are approving for.
      screenName: 'FloorballStar15',
    });
    // A link scanner prefetching the URL must not grant anything.
    expect(await service.isActiveFor('p1')).toBe(false);
    expect(repo.rows[0].status).toBe(before.status);
    expect(repo.rows[0].reviewCode).toBe(before.reviewCode);
  });

  it('treats a missing expiry as expired, not as eternal (finding 9)', async () => {
    const { service, repo, reviewCodeOf } = build();
    await service.request('p1');
    const code = reviewCodeOf();
    repo.rows[0].reviewCodeExpiresAt = null;

    expect(await service.previewByReviewCode(code)).toBeNull();
    expect(await service.approveByReviewCode(code)).toBeNull();
  });
});

/**
 * Security review finding 8 — rate limiting on asking a parent.
 *
 * The threat ADR-0013 names for the PT flow ("a compromised session
 * spamming a family's inbox with a scary email") plus one specific to
 * this design: re-requesting invalidates the disable link the parent
 * already holds, so an unthrottled endpoint is also a way to keep a
 * parent's "off" button perpetually broken.
 */
describe('PublicSharingConsentService: request rate limiting', () => {
  it('refuses a request inside the burst cooldown', async () => {
    const { service, redisService, repo } = build();
    redisService.tryClaimPublicSharingRequestCooldown.mockResolvedValue(false);

    await expect(service.request('p1')).rejects.toThrow(/recently/i);
    // Nothing written and nothing mailed — a refused request must leave
    // the existing consent state, and the parent's link, untouched.
    expect(repo.rows).toHaveLength(0);
  });

  it('refuses a request over the daily cap', async () => {
    const { service, redisService } = build();
    redisService.tryClaimPublicSharingRequestDailyCap.mockResolvedValue(false);

    await expect(service.request('p1')).rejects.toThrow(/too many/i);
  });

  it('sends no mail when a limit refuses the request', async () => {
    const { service, redisService, mailService } = build();
    redisService.tryClaimPublicSharingRequestCooldown.mockResolvedValue(false);

    await expect(service.request('p1')).rejects.toThrow();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('claims the limits only after the validity checks pass', async () => {
    // A request that was going to be refused anyway should not consume
    // the caller's quota — but probing the checks should still cost, as
    // in the PT flow. Here the parent contact is missing, so the request
    // fails before either claim.
    const { service, redisService } = build(null);

    await expect(service.request('p1')).rejects.toThrow(/parent contact/i);
    expect(
      redisService.tryClaimPublicSharingRequestCooldown,
    ).not.toHaveBeenCalled();
  });
});
