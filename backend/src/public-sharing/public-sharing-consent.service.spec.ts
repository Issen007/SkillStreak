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
    update: jest.fn((id: string, patch: Partial<PublicSharingConsent>) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return Promise.resolve({ affected: row ? 1 : 0 });
    }),
  };
}

function build(parentContact: string | null = 'parent@example.se') {
  const repo = fakeRepo();
  const privateInfo = {
    getParentContact: jest.fn(() => Promise.resolve(parentContact)),
  } as unknown as PlayerPrivateInfoService;
  const service = new PublicSharingConsentService(
    repo as unknown as Repository<PublicSharingConsent>,
    privateInfo,
  );
  return { service, repo, privateInfo };
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
    const { service } = build();
    const { reviewCode } = await service.request('p1');

    const result = await service.approveByReviewCode(reviewCode);

    expect(result?.playerId).toBe('p1');
    expect(result?.revokeCode).toBeTruthy();
    expect(await service.isActiveFor('p1')).toBe(true);
  });

  it('starts the reminder clock at the grant, not at a calendar boundary', async () => {
    // Decision 6: a family that opts in on the 20th hears on the 20th.
    const { service, repo } = build();
    const { reviewCode } = await service.request('p1');
    await service.approveByReviewCode(reviewCode);

    expect(repo.rows[0].lastReminderAt).toBeInstanceOf(Date);
  });

  it('does not approve on an expired review code', async () => {
    const { service, repo } = build();
    const { reviewCode } = await service.request('p1');
    repo.rows[0].reviewCodeExpiresAt = new Date(Date.now() - 1000);

    expect(await service.approveByReviewCode(reviewCode)).toBeNull();
    expect(await service.isActiveFor('p1')).toBe(false);
  });

  it('declining leaves it inactive and burns the code', async () => {
    const { service } = build();
    const { reviewCode } = await service.request('p1');

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
    const { reviewCode } = await built.service.request('p1');
    const approved = await built.service.approveByReviewCode(reviewCode);
    return { ...built, revokeCode: approved!.revokeCode };
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
    const { reviewCode } = await built.service.request('p1');
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
