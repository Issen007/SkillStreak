import { Repository } from 'typeorm';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import {
  PublicSharingConsent,
  PublicSharingConsentStatus,
  PublicSharingRevokedReason,
} from './entities/public-sharing-consent.entity';
import { CORRELATION_HEADER } from '../mail/dsn.parser';
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
        lastReminderToken: null,
        lastReminderFailureAt: null,
        lastReminderFailureToken: null,
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
          if (clause.includes('last_reminder_token')) {
            column = 'lastReminderToken';
            value = params.token;
          } else if (clause.includes('review_code')) {
            column = 'reviewCode';
            value = params.code;
          } else {
            column = 'revokeCode';
            value = params.code;
          }
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
    // Accepts either a bare id or a criteria object. The conditional
    // form is what stops the reminder sweep writing a stale `status` over
    // a concurrent revoke, so the fake has to honour the predicate rather
    // than matching on id alone — otherwise the test for that race would
    // pass against a fake that cannot express it.
    update: jest.fn(
      (
        criteria: string | Partial<PublicSharingConsent>,
        patch: Partial<PublicSharingConsent>,
      ) => {
        const where =
          typeof criteria === 'string' ? { id: criteria } : criteria;
        const row = rows.find((r) =>
          Object.entries(where).every(
            ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
          ),
        );
        if (row) Object.assign(row, patch);
        return Promise.resolve({ affected: row ? 1 : 0 });
      },
    ),
    count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((r) => matches(r, where)).length),
    ),
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
    releasePublicSharingRequestCooldown: jest.fn(() => Promise.resolve()),
    refundPublicSharingRequestDailyCap: jest.fn(() => Promise.resolve()),
  };
  // Runs the callback inline against the same fake repository, which is
  // all these tests need — the lock itself is a database behaviour and
  // belongs to the e2e suite, not here.
  const dataSource = {
    // Entity-aware, like the real manager: revoking now un-publishes the
    // player's clips in the same transaction, so a fake that hands back the
    // consent repository for every entity would hide that call entirely.
    transaction: (fn: (m: unknown) => unknown) =>
      Promise.resolve(
        fn({
          getRepository: (entity: unknown) =>
            entity === VideoClip ? clipRepo : repo,
        }),
      ),
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
  // Clips the fake player has published, so the un-publish on revoke can be
  // asserted rather than assumed.
  const publishedClips = { affected: 0, cleared: false };
  const clipRepo = {
    createQueryBuilder: () => {
      const qb = {
        update: () => qb,
        // Records that the un-publish actually ran, and with the right
        // value — asserting the call happened is not the same as asserting
        // it cleared anything.
        set: (patch: { publishedPubliclyAt: Date | null }) => {
          publishedClips.cleared = patch.publishedPubliclyAt === null;
          return qb;
        },
        where: () => qb,
        andWhere: () => qb,
        execute: () => Promise.resolve(publishedClips),
      };
      return qb;
    },
  };

  const service = new PublicSharingConsentService(
    repo as unknown as Repository<PublicSharingConsent>,
    clipRepo as never,
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
    publishedClips,
  };
}

describe('PublicSharingConsentService: granting', () => {
  it('refuses to request without a parent contact', async () => {
    // Decision 10. The monthly reminder is the design's only recurring
    // control, so an account with no recipient for it would have none.
    const { service, repo } = build(null);

    await expect(service.request('p1')).rejects.toMatchObject({
      code: 'public_sharing_needs_parent_contact',
    });
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

describe('PublicSharingConsentService: ending consent un-publishes', () => {
  /*
   * Owner's decision, 2026-08-22. The public feed already re-reads consent
   * through an INNER JOIN, so nothing leaks while a consent is revoked —
   * these tests are about what happens *after* a re-approval.
   *
   * `published_publicly_at` used to survive a revoke, so re-approving
   * silently republished every clip the child had shared before, with no
   * fresh decision by them and nothing shown to the parent who had just
   * agreed. Sharing now starts from nothing: permission is granted, not
   * republication.
   */
  it("takes the parent-revoked player's clips out of the feed", async () => {
    const { service, repo, revokeCodeOf, publishedClips } = build();
    await service.request('player-1');
    await service.approveByReviewCode(repo.rows[0].reviewCode!);
    publishedClips.affected = 3;

    await expect(service.revokeByRevokeCode(revokeCodeOf())).resolves.toEqual({
      revoked: true,
    });
    expect(publishedClips.cleared).toBe(true);
  });

  it('does the same when reminders go undeliverable', async () => {
    const { service, repo, publishedClips } = build();
    await service.request('player-1');
    await service.approveByReviewCode(repo.rows[0].reviewCode!);
    publishedClips.affected = 2;
    publishedClips.cleared = false;

    // Auto-revocation after the configured run of failed reminders is a
    // consent ending too, and must un-publish for the same reason.
    for (let i = 0; i < MAX_REMINDER_FAILURES; i++) {
      repo.rows[0].lastReminderToken = `token-${i}`;
      await service.recordReminderUndeliverable(`token-${i}`, new Date());
    }

    expect(repo.rows[0].status).toBe('revoked');
    expect(publishedClips.cleared).toBe(true);
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
    const row = repo.rows[0];
    await service.sendReminder(row);

    const result = await service.recordReminderUndeliverable(
      row.lastReminderToken!,
    );

    expect(result).toMatchObject({ disabled: false });
    expect(await service.isActiveFor('p1')).toBe(true);
  });

  it('disables on the second consecutive failure', async () => {
    const { service, repo } = await activated();
    const row = repo.rows[0];

    await service.sendReminder(row);
    await service.recordReminderUndeliverable(row.lastReminderToken!);
    await service.sendReminder(row);
    const result = await service.recordReminderUndeliverable(
      row.lastReminderToken!,
    );

    expect(result).toMatchObject({ disabled: true });
    expect(await service.isActiveFor('p1')).toBe(false);
    expect(row.revokedReason).toBe(
      PublicSharingRevokedReason.REMINDER_UNDELIVERABLE,
    );
  });

  it('advances the clock on a send, so two failures take two months', async () => {
    // Without this, a permanently undeliverable address stays perpetually
    // due, is retried on every sweep, and reaches the disable threshold
    // in minutes — turning "two missed months" into "two attempts".
    const { service, repo } = await activated();
    const row = repo.rows[0];
    await service.sendReminder(row);
    await service.recordReminderUndeliverable(row.lastReminderToken!);

    expect(await service.findDueReminders()).toHaveLength(0);
  });

  it('a reminder that was delivered clears the failure streak', async () => {
    const { service, repo } = await activated();
    const row = repo.rows[0];
    await service.sendReminder(row);
    await service.recordReminderUndeliverable(row.lastReminderToken!);
    expect(row.reminderFailureCount).toBe(1);

    // Month 2 goes out (streak carried), month 3 judges it as delivered.
    await service.sendReminder(row);
    await service.sendReminder(row);

    expect(row.reminderFailureCount).toBe(0);
    expect(await service.isActiveFor('p1')).toBe(true);
  });
});

/**
 * ADR-0030 finding 4 — asynchronous bounce detection.
 *
 * These are the tests for the thing that kept the reminder sweep
 * unwritten for a month. A bounce arrives DAYS after the send that
 * caused it, so the naive shape — reset the counter whenever a reminder
 * goes out — makes Decision 5's disable mathematically unreachable no
 * matter how dead the address is. The first test here is that exact
 * sequence.
 */
describe('PublicSharingConsentService: asynchronous bounces', () => {
  async function activated() {
    const built = build();
    await built.service.request('p1');
    await built.service.approveByReviewCode(built.reviewCodeOf());
    return built;
  }

  it('disables after two consecutive reminders bounce, one month apart', async () => {
    // The regression that motivated the whole design. Under a
    // "reset on send" counter this runs 0 → 1 → 0 → 1 forever and the
    // consent stays live behind a permanently dead address.
    const { service, repo } = await activated();
    const row = repo.rows[0];

    // Month 1: reminder goes out, bounces days later.
    await service.sendReminder(row);
    const firstToken = row.lastReminderToken!;
    expect(firstToken).toBeTruthy();
    await service.recordReminderUndeliverable(firstToken);
    expect(row.reminderFailureCount).toBe(1);
    expect(await service.isActiveFor('p1')).toBe(true);

    // Month 2: the previous reminder DID bounce, so the streak survives
    // the new send rather than being reset by it.
    await service.sendReminder(row);
    expect(row.reminderFailureCount).toBe(1);
    const secondToken = row.lastReminderToken!;
    expect(secondToken).not.toBe(firstToken);

    const result = await service.recordReminderUndeliverable(secondToken);

    expect(result).toMatchObject({ matched: true, disabled: true });
    expect(await service.isActiveFor('p1')).toBe(false);
    expect(row.revokedReason).toBe(
      PublicSharingRevokedReason.REMINDER_UNDELIVERABLE,
    );
  });

  it('a month that delivered resets the streak a bounced month started', async () => {
    // The counter is settled one send LATE, by construction: a send can
    // only ever judge the reminder before it, because its own bounce has
    // not had time to arrive. Reading the timeline is the only way this
    // test makes sense, so it is spelled out.
    const { service, repo } = await activated();
    const row = repo.rows[0];

    // Month 1 goes out and bounces.
    await service.sendReminder(row);
    await service.recordReminderUndeliverable(row.lastReminderToken!);
    expect(row.reminderFailureCount).toBe(1);

    // Month 2's send judges month 1, which bounced — so the streak is
    // carried, NOT reset. This is the step that makes reaching 2
    // possible at all.
    await service.sendReminder(row);
    expect(row.reminderFailureCount).toBe(1);

    // No bounce comes back for month 2.

    // Month 3's send judges month 2, which was delivered — so the streak
    // resets here.
    await service.sendReminder(row);
    expect(row.reminderFailureCount).toBe(0);

    // Which makes month 3 bouncing a first failure, not a second.
    const result = await service.recordReminderUndeliverable(
      row.lastReminderToken!,
    );

    expect(result).toMatchObject({ counted: true, disabled: false });
    expect(row.reminderFailureCount).toBe(1);
    expect(await service.isActiveFor('p1')).toBe(true);
  });

  it('a late DSN for a superseded reminder is ignored, not miscounted', async () => {
    // Month 2's bounce arriving after month 3 has already gone out. The
    // token no longer matches, so it cannot be charged against the wrong
    // month — the honest cost of token-only attribution, pinned here so
    // it stays a known behaviour rather than a surprise.
    const { service, repo } = await activated();
    const row = repo.rows[0];

    await service.sendReminder(row);
    const staleToken = row.lastReminderToken!;
    await service.sendReminder(row);

    expect(await service.recordReminderUndeliverable(staleToken)).toEqual({
      matched: false,
    });
    expect(row.reminderFailureCount).toBe(0);
  });

  it('counts two bounces for the SAME reminder only once', async () => {
    // A duplicate DSN, or one MTA reporting the same failure twice, is
    // one missed month — not two. Without this idempotency a single dead
    // address disables a consent within minutes of the first send, which
    // turns Decision 5's "two consecutive undeliverable reminders" into
    // "two delivery reports".
    const { service, repo } = await activated();
    const row = repo.rows[0];
    await service.sendReminder(row);
    const token = row.lastReminderToken!;

    const first = await service.recordReminderUndeliverable(token);
    const second = await service.recordReminderUndeliverable(token);

    expect(first).toMatchObject({ counted: true, disabled: false });
    expect(second).toMatchObject({ counted: false, disabled: false });
    expect(row.reminderFailureCount).toBe(1);
    expect(await service.isActiveFor('p1')).toBe(true);
  });

  it('reports an unknown token as unmatched rather than guessing', async () => {
    const { service } = await activated();

    expect(
      await service.recordReminderUndeliverable('not-a-real-token'),
    ).toEqual({
      matched: false,
    });
  });

  it('ignores an empty token', async () => {
    const { service } = await activated();
    expect(await service.recordReminderUndeliverable('')).toEqual({
      matched: false,
    });
  });

  it('ignores a bounce for a consent the parent already revoked', async () => {
    // The parent revoked while the DSN was still in transit. There is
    // nothing left to disable, and counting it would be recording a
    // failure against a consent that no longer exists.
    const { service, repo, revokeCodeOf } = await activated();
    const row = repo.rows[0];
    await service.sendReminder(row);
    const token = row.lastReminderToken!;
    await service.revokeByRevokeCode(revokeCodeOf());

    const result = await service.recordReminderUndeliverable(token);

    expect(result).toMatchObject({ matched: true, counted: false });
    expect(row.revokedReason).toBe(PublicSharingRevokedReason.PARENT_REVOKED);
  });

  it('stamps a fresh unguessable token on every reminder', async () => {
    const { service, repo } = await activated();
    const row = repo.rows[0];

    const tokens = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      await service.sendReminder(row);
      tokens.add(row.lastReminderToken!);
      // Break the streak each time so the loop does not disable it.
      row.lastReminderFailureAt = null;
    }

    expect(tokens.size).toBe(5);
    for (const token of tokens) {
      // base64url, and long enough that guessing one is not a way to
      // disable a stranger's consent.
      expect(token).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    }
  });

  it('carries the token out on the message, in both places a DSN may return', async () => {
    const { service, repo, mailService } = await activated();
    const row = repo.rows[0];
    mailService.sendMail.mockClear();

    await service.sendReminder(row);

    const sent = mailService.sendMail.mock.calls[0][0] as {
      messageId?: string;
      headers?: Record<string, string>;
      text: string;
    };
    const token = row.lastReminderToken!;
    // The header is the strong signal; the Message-ID is the fallback
    // for MTAs that strip X- headers when returning the original.
    expect(sent.headers?.[CORRELATION_HEADER]).toBe(token);
    expect(sent.messageId).toContain(token);
  });

  it('persists the token before sending, so a fast bounce still matches', async () => {
    // A DSN can arrive while the SMTP call is still returning. If the
    // token were saved after the send, that bounce would find no row to
    // attribute itself to and the failure would go uncounted.
    const { service, repo, mailService } = await activated();
    const row = repo.rows[0];
    let tokenAtSendTime: string | null = null;
    mailService.sendMail.mockImplementationOnce(() => {
      tokenAtSendTime = row.lastReminderToken;
      return Promise.resolve({ handedOff: true, rejected: [] });
    });

    await service.sendReminder(row);

    expect(tokenAtSendTime).toBe(row.lastReminderToken);
    expect(tokenAtSendTime).toBeTruthy();
  });

  it('counts a refused-at-handoff address through the same counter', async () => {
    // The synchronous half, closed 2026-08-18. Both evidence paths feed
    // one streak rather than each needing its own threshold.
    const { service, repo, mailService } = await activated();
    const row = repo.rows[0];
    mailService.sendMail.mockResolvedValue({
      handedOff: false,
      rejected: ['parent@example.se'],
      reason: 'all_rejected',
    });

    await service.sendReminder(row);

    expect(row.reminderFailureCount).toBe(1);
  });

  it('does not send, and does not mint a token, for an inactive consent', async () => {
    const { service, repo, revokeCodeOf, mailService } = await activated();
    const row = repo.rows[0];
    await service.revokeByRevokeCode(revokeCodeOf());
    mailService.sendMail.mockClear();

    const result = await service.sendReminder(row);

    expect(result).toEqual({ sent: false, disabled: false });
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('treats a row with undefined bounce columns as not bounced', async () => {
    // A fixture or a partially-hydrated row can carry `undefined` where
    // the database would hold `null`; the check must not mistake that
    // for a recorded bounce, nor throw on it.
    const { service, repo } = await activated();
    const row = repo.rows[0];
    for (const field of [
      'lastReminderFailureAt',
      'lastReminderFailureToken',
      'lastReminderToken',
      'lastReminderAt',
    ]) {
      (row as unknown as Record<string, unknown>)[field] = undefined;
    }

    await expect(service.sendReminder(row)).resolves.toMatchObject({
      sent: true,
    });
    expect(row.reminderFailureCount).toBe(0);
  });

  it('counts a second bounce that lands in the same tick as its send', async () => {
    // The regression behind switching idempotency from timestamps to
    // tokens. With a `bouncedAt >= sentAt` comparison, a send and a
    // bounce sharing one instant made the second GENUINE bounce look
    // like a duplicate of the first, so it was dropped and the consent
    // that should have been disabled stayed live.
    const { service, repo } = await activated();
    const row = repo.rows[0];
    const at = new Date('2026-08-19T10:00:00.000Z');

    await service.sendReminder(row, at);
    await service.recordReminderUndeliverable(row.lastReminderToken!, at);
    expect(row.reminderFailureCount).toBe(1);

    // Same instant throughout — only the token distinguishes the months.
    await service.sendReminder(row, at);
    const result = await service.recordReminderUndeliverable(
      row.lastReminderToken!,
      at,
    );

    expect(result).toMatchObject({ counted: true, disabled: true });
    expect(await service.isActiveFor('p1')).toBe(false);
  });
});

describe('PublicSharingConsentService: security review 2026-08-19', () => {
  async function activated() {
    const built = build();
    await built.service.request('p1');
    await built.service.approveByReviewCode(built.reviewCodeOf());
    return built;
  }

  // --- Finding 1 (blocking) ------------------------------------------
  it('disables an address the SMTP server refuses every month', async () => {
    // THE REGRESSION. A 550 at RCPT TO is the most common dead-mailbox
    // case on domains that reject synchronously, and it used to be
    // uncountable: the failure was recorded without a token, so the next
    // send saw nothing against the previous reminder and reset the
    // streak. Six months produced counts [1,1,1,1,1,1] and the consent
    // stayed ACTIVE forever.
    const { service, repo, mailService } = await activated();
    const row = repo.rows[0];
    mailService.sendMail.mockResolvedValue({
      handedOff: false,
      rejected: ['parent@example.se'],
      reason: 'all_rejected',
    });

    const counts: number[] = [];
    for (let month = 0; month < 6; month += 1) {
      await service.sendReminder(row);
      counts.push(row.reminderFailureCount);
    }

    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(MAX_REMINDER_FAILURES);
    expect(await service.isActiveFor('p1')).toBe(false);
    expect(row.revokedReason).toBe(
      PublicSharingRevokedReason.REMINDER_UNDELIVERABLE,
    );
  });

  it('disables when the mailer is not configured at all', async () => {
    // `not_configured` is also a delivery failure — a reminder nobody
    // ever sent supervises nothing.
    const { service, repo, mailService } = await activated();
    const row = repo.rows[0];
    mailService.sendMail.mockResolvedValue({
      handedOff: false,
      rejected: [],
      reason: 'not_configured',
    });

    await service.sendReminder(row);
    await service.sendReminder(row);

    expect(await service.isActiveFor('p1')).toBe(false);
  });

  it('mixes the two evidence paths into one streak', async () => {
    // A handoff refusal one month and a bounce the next is still two
    // consecutive undeliverable reminders.
    const { service, repo, mailService } = await activated();
    const row = repo.rows[0];

    mailService.sendMail.mockResolvedValueOnce({
      handedOff: false,
      rejected: ['parent@example.se'],
      reason: 'all_rejected',
    });
    await service.sendReminder(row);
    expect(row.reminderFailureCount).toBe(1);

    await service.sendReminder(row);
    const result = await service.recordReminderUndeliverable(
      row.lastReminderToken!,
    );

    expect(result).toMatchObject({ disabled: true });
    expect(await service.isActiveFor('p1')).toBe(false);
  });

  // --- Finding 2 (blocking) ------------------------------------------
  it('does not resurrect a consent revoked while the sweep was running', async () => {
    // THE REGRESSION. `row` is loaded once at the top of the sweep and
    // may be minutes stale. Saving the whole entity wrote its stale
    // `status`, revoke code and null `revoked_at` back over a concurrent
    // revoke — turning a child's sharing back on after the parent had
    // been told it was off. Verified against real Postgres before the fix.
    const { service, repo, revokeCodeOf, mailService } = await activated();
    // A genuine separate copy, the way `findDueReminders()` hands the
    // sweep its own hydrated entity — not the same object the fake
    // repository stores, or mutating it would move the database too and
    // the test could not express the race at all.
    const staleRow = { ...repo.rows[0] };

    // The parent revokes after the sweep took that copy.
    await service.revokeByRevokeCode(revokeCodeOf());
    expect(repo.rows[0].status).toBe(PublicSharingConsentStatus.REVOKED);
    mailService.sendMail.mockClear();

    const result = await service.sendReminder(staleRow);

    expect(result).toEqual({ sent: false, disabled: false });
    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(repo.rows[0].status).toBe(PublicSharingConsentStatus.REVOKED);
    expect(repo.rows[0].revokeCode).toBeNull();
  });

  // --- Third pass, A2: the backstop path ------------------------------
  it('the threshold backstop revokes a stale row that is already at the limit', async () => {
    // Unreachable through the normal flow — the failure intake disables
    // the moment the second report lands — so nothing exercised it. Two
    // consecutive fix rounds each shipped a defect in exactly the half
    // nobody ran, which is reason enough to run this one.
    const { service, repo, mailService } = await activated();
    const row = repo.rows[0];
    // The count only survives into the backstop if the PREVIOUS reminder
    // is recorded as failed — a bare count with no failure token means
    // the streak was broken and is correctly reset. Setting it that way
    // was the first version of this test, and it silently exercised the
    // reset instead.
    row.lastReminderToken = 'carried-token';
    row.lastReminderFailureToken = 'carried-token';
    row.lastReminderFailureAt = new Date();
    row.reminderFailureCount = MAX_REMINDER_FAILURES;
    mailService.sendMail.mockClear();

    const result = await service.sendReminder(row);

    expect(result).toEqual({ sent: false, disabled: true });
    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(repo.rows[0].status).toBe(PublicSharingConsentStatus.REVOKED);
    expect(repo.rows[0].revokedReason).toBe(
      PublicSharingRevokedReason.REMINDER_UNDELIVERABLE,
    );
    expect(repo.rows[0].revokeCode).toBeNull();
  });

  it('the backstop does not overwrite a revoke the parent already made', async () => {
    // The reason this path is a conditional UPDATE rather than a
    // whole-entity save: against a concurrent parent revoke it would
    // otherwise rewrite revoked_at/revoked_reason as
    // `reminder_undeliverable`, destroying the record that a parent used
    // their disable link — the record Article 7(1) demonstrability rests
    // on and Decision 9's monthly review reads.
    const { service, repo, revokeCodeOf, mailService } = await activated();
    const staleRow = { ...repo.rows[0] };
    staleRow.lastReminderToken = 'carried-token';
    staleRow.lastReminderFailureToken = 'carried-token';
    staleRow.lastReminderFailureAt = new Date();
    staleRow.reminderFailureCount = MAX_REMINDER_FAILURES;

    await service.revokeByRevokeCode(revokeCodeOf());
    mailService.sendMail.mockClear();

    const result = await service.sendReminder(staleRow);

    expect(result).toEqual({ sent: false, disabled: false });
    expect(repo.rows[0].revokedReason).toBe(
      PublicSharingRevokedReason.PARENT_REVOKED,
    );
  });

  // --- Finding 4 (advisory) ------------------------------------------
  it('clears the correlation token when a consent is re-requested', async () => {
    // Otherwise a straggling DSN about the PREVIOUS grant — possibly to
    // a different parent address entirely — is charged against the new
    // one, putting a freshly approved consent one report from revocation.
    const { service, repo, revokeCodeOf, reviewCodeOf } = await activated();
    const row = repo.rows[0];
    await service.sendReminder(row);
    const staleToken = row.lastReminderToken!;

    await service.revokeByRevokeCode(revokeCodeOf());
    await service.request('p1');
    await service.approveByReviewCode(reviewCodeOf());

    expect(row.lastReminderToken).not.toBe(staleToken);
    expect(await service.recordReminderUndeliverable(staleToken)).toEqual({
      matched: false,
    });
    expect(row.reminderFailureCount).toBe(0);
    expect(await service.isActiveFor('p1')).toBe(true);
  });
});

describe('PublicSharingConsentService: reminder constants', () => {
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

    await expect(service.request('p1')).rejects.toMatchObject({
      code: 'public_sharing_blocked_pending_contact_change',
    });
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

    await expect(service.request('p1')).rejects.toMatchObject({
      code: 'public_sharing_already_active',
    });
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

    await expect(service.request('p1')).rejects.toMatchObject({
      code: 'public_sharing_request_cooldown',
    });
    // Nothing written and nothing mailed — a refused request must leave
    // the existing consent state, and the parent's link, untouched.
    expect(repo.rows).toHaveLength(0);
  });

  it('refuses a request over the daily cap', async () => {
    const { service, redisService } = build();
    redisService.tryClaimPublicSharingRequestDailyCap.mockResolvedValue(false);

    await expect(service.request('p1')).rejects.toMatchObject({
      code: 'public_sharing_request_daily_cap',
    });
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

    await expect(service.request('p1')).rejects.toMatchObject({
      code: 'public_sharing_needs_parent_contact',
    });
    expect(
      redisService.tryClaimPublicSharingRequestCooldown,
    ).not.toHaveBeenCalled();
  });
});

/**
 * The half of the 2026-09-01 bug that splitting the refusal codes did not
 * reach.
 *
 * `request()` mailed best-effort and discarded the result, so every one
 * of these cases returned `{requested: true}` and the app said *"Vi har
 * skickat ett mejl"*. A child then waited for a mail that no server had
 * ever accepted, with nothing to retry and nothing to report — which is
 * exactly what "asking my parent for permission doesn't work" looks like
 * from the outside.
 *
 * Written so that going back to a discarded result fails them: they
 * assert the throw, its code, and that the price of the mail is given
 * back. A test that only checked "it resolves" passed all along.
 */
describe('PublicSharingConsentService: a consent mail that never left', () => {
  const MAIL_FAILURES: Array<[string, unknown, string]> = [
    [
      'SMTP is not configured at all',
      { handedOff: false, rejected: [], reason: 'not_configured' },
      'public_sharing_request_mail_failed',
    ],
    [
      'the server refused every recipient',
      {
        handedOff: false,
        rejected: ['parent@example.com'],
        reason: 'all_rejected',
      },
      'public_sharing_request_mail_rejected',
    ],
  ];

  it.each(MAIL_FAILURES)(
    'refuses the request when %s',
    async (_case, result, code) => {
      const { service, mailService } = build();
      mailService.sendMail.mockResolvedValue(result as never);

      await expect(service.request('p1')).rejects.toMatchObject({ code });
    },
  );

  it('refuses when the transport throws before any SMTP conversation', async () => {
    const { service, mailService } = build();
    mailService.sendMail.mockRejectedValue(new Error('ECONNREFUSED'));

    // A thrown transport error is a retry, not a dead end, so it must not
    // borrow the refused-address code — the two tell a child to do
    // different things.
    await expect(service.request('p1')).rejects.toMatchObject({
      code: 'public_sharing_request_mail_failed',
    });
  });

  it('gives back both limits, since no mail was sent to be limited', async () => {
    const { service, mailService, redisService } = build();
    mailService.sendMail.mockResolvedValue({
      handedOff: false,
      rejected: [],
      reason: 'not_configured',
    } as never);

    await expect(service.request('p1')).rejects.toThrow();
    // Both are claimed before the send, to price the mail. No mail
    // exists, so holding a child off for fifteen minutes — or locking
    // them out for the rest of the day — would be charging them for our
    // own outage.
    expect(
      redisService.releasePublicSharingRequestCooldown,
    ).toHaveBeenCalledWith('p1');
    expect(
      redisService.refundPublicSharingRequestDailyCap,
    ).toHaveBeenCalledWith('p1');
  });

  it('keeps neither limit charged nor the row rolled back', async () => {
    const { service, mailService, repo } = build();
    mailService.sendMail.mockResolvedValue({
      handedOff: false,
      rejected: [],
      reason: 'not_configured',
    } as never);

    await expect(service.request('p1')).rejects.toThrow();
    // The pending row stays. It holds a code nobody received, which is
    // inert and is overwritten by the next successful request — while
    // unwinding it would have to guess what state to restore and would
    // erase the record that a request was ever made, from the one flow
    // whose history Article 7(1) requires be demonstrable.
    expect(repo.rows).toHaveLength(1);
  });

  it('still resolves when the mail is handed off', async () => {
    const { service, redisService } = build();

    await expect(service.request('p1')).resolves.toMatchObject({
      requested: true,
    });
    // The refund is strictly the failure path's. If it ran here too, the
    // rate limits this endpoint depends on would not exist at all.
    expect(
      redisService.releasePublicSharingRequestCooldown,
    ).not.toHaveBeenCalled();
    expect(
      redisService.refundPublicSharingRequestDailyCap,
    ).not.toHaveBeenCalled();
  });
});
