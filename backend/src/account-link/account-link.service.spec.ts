import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  AccountLinkNotAllowedException,
  AccountLinkService,
} from './account-link.service';

/**
 * ADR-0031's five invariants.
 *
 * Each one would be silent if it broke — nothing else in the codebase
 * enforces any of them, and the feature would appear to keep working
 * while having lost the property that makes it safe.
 */

const PLAYER = 'player-1';
const STAFF = 'staff-1';
const thisYear = new Date().getUTCFullYear();

function build(
  opts: {
    birthYear?: number;
    existingLink?: object | null;
    claimAffected?: number;
    challengePlayerId?: string | null;
    saveThrows?: boolean;
  } = {},
) {
  const links = {
    findOne: jest.fn().mockResolvedValue(opts.existingLink ?? null),
    create: jest.fn((v: object) => v),
    save: jest.fn(
      opts.saveThrows
        ? () => Promise.reject(new Error('duplicate key'))
        : (v: object) => Promise.resolve(v),
    ),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const challenges = {
    create: jest.fn((v: object) => v),
    save: jest.fn((v: object) => Promise.resolve(v)),
    update: jest.fn().mockResolvedValue({ affected: opts.claimAffected ?? 1 }),
    findOne: jest
      .fn()
      .mockResolvedValue(
        opts.challengePlayerId === null
          ? null
          : { playerId: opts.challengePlayerId ?? PLAYER },
      ),
    delete: jest.fn().mockResolvedValue({ affected: 3 }),
  };
  const players = {
    findOne: jest.fn().mockResolvedValue({
      id: PLAYER,
      birthYear: opts.birthYear ?? thisYear - 20,
    }),
  };
  const service = new AccountLinkService(
    links as never,
    challenges as never,
    players as never,
  );
  return { service, links, challenges, players };
}

describe('Invariant 5 — under 13 cannot obtain a challenge, server-side', () => {
  it('refuses a 12-year-old even though the UI already hides the entry', async () => {
    // The profile screen hides the control below 13. A hidden control is
    // not a gate; this is.
    const { service, challenges } = build({ birthYear: thisYear - 12 });

    await expect(service.createChallenge(PLAYER)).rejects.toBeInstanceOf(
      AccountLinkNotAllowedException,
    );
    expect(challenges.save).not.toHaveBeenCalled();
  });

  it('allows exactly 13', async () => {
    const { service } = build({ birthYear: thisYear - 13 });

    await expect(service.createChallenge(PLAYER)).resolves.toHaveProperty(
      'token',
    );
  });
});

describe('Invariant 1 — a link needs both halves proven', () => {
  it('never accepts a player id from the caller', () => {
    // Structural, not behavioural: `completeLink` takes the staff id (from
    // the guard) and a token, and there is no third parameter. If one is
    // ever added, this fails and the reviewer has to justify it.
    // The arity is the assertion. The method is never invoked here, so
    // `this` binding is irrelevant.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(AccountLinkService.prototype.completeLink).toHaveLength(2);
  });

  it('takes the player identity from the challenge, not the request', async () => {
    const { service, links } = build({
      challengePlayerId: 'player-from-token',
    });

    await service.completeLink(STAFF, 'tok');

    expect(links.create).toHaveBeenCalledWith({
      playerId: 'player-from-token',
      staffAccountId: STAFF,
    });
  });

  it('refuses a token that is missing or not a string', async () => {
    const { service, challenges } = build();

    await expect(service.completeLink(STAFF, undefined)).rejects.toBeInstanceOf(
      AccountLinkNotAllowedException,
    );
    await expect(service.completeLink(STAFF, 42)).rejects.toBeInstanceOf(
      AccountLinkNotAllowedException,
    );
    expect(challenges.update).not.toHaveBeenCalled();
  });
});

describe('Invariant 2 — a challenge is single-use and expiring', () => {
  it('claims it with a conditional UPDATE, not read-then-write', async () => {
    // Two console tabs racing the same challenge must not both succeed.
    const { service, challenges } = build();

    await service.completeLink(STAFF, 'tok');

    const updateCalls = challenges.update.mock.calls as unknown as Array<
      [Record<string, unknown>, Record<string, unknown>]
    >;
    const where = updateCalls[0][0];
    expect(where).toHaveProperty('consumedAt');
    expect(where).toHaveProperty('expiresAt');
  });

  it('refuses when the claim matched nothing — already used or expired', async () => {
    const { service, links } = build({ claimAffected: 0 });

    await expect(service.completeLink(STAFF, 'tok')).rejects.toBeInstanceOf(
      AccountLinkNotAllowedException,
    );
    expect(links.save).not.toHaveBeenCalled();
  });

  it('stores only a hash, never the token itself', async () => {
    const { service, challenges } = build();

    const { token } = await service.createChallenge(PLAYER);
    const createCalls = challenges.create.mock.calls as unknown as Array<
      [Record<string, string>]
    >;
    const saved = createCalls[0][0];

    expect(saved.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved)).not.toContain(token);
  });
});

describe('Invariant 4 — either side unlinks alone', () => {
  it('lets the player unlink without the trainer', async () => {
    const { service, links } = build();

    await expect(service.unlinkAsPlayer(PLAYER)).resolves.toEqual({
      linked: false,
    });
    expect(links.delete).toHaveBeenCalledWith({ playerId: PLAYER });
  });

  it('lets the trainer unlink without the player', async () => {
    const { service, links } = build();

    await expect(service.unlinkAsStaff(STAFF)).resolves.toEqual({
      linked: false,
    });
    expect(links.delete).toHaveBeenCalledWith({ staffAccountId: STAFF });
  });
});

describe('one-to-one is the database, not a service check', () => {
  it('refuses rather than overwrites when the unique index rejects', async () => {
    const { service } = build({ saveThrows: true });

    await expect(service.completeLink(STAFF, 'tok')).rejects.toBeInstanceOf(
      AccountLinkNotAllowedException,
    );
  });

  it('refuses a second challenge while a link already exists', async () => {
    const { service, challenges } = build({ existingLink: { id: 'l1' } });

    await expect(service.createChallenge(PLAYER)).rejects.toBeInstanceOf(
      AccountLinkNotAllowedException,
    );
    expect(challenges.save).not.toHaveBeenCalled();
  });
});

describe('Invariant 3 — no authorisation path reads the link', () => {
  /**
   * The one test here that is not about behaviour, because the property
   * it defends cannot be observed from behaviour: a guard that started
   * consulting `account_link` would make every existing test pass and
   * quietly turn a convenience into a privilege path.
   *
   * ADR-0031 Decision 3 is the whole reason the challenge in Decision 1
   * is not worth stealing. So this greps.
   */
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(guard|strategy)\.ts$/.test(name)) out.push(full);
    }
    return out;
  }

  it('no guard or strategy mentions AccountLink', () => {
    const src = join(__dirname, '..');
    const offenders = walk(src)
      .filter((f) => !f.endsWith('.spec.ts'))
      .filter((f) =>
        /AccountLink|account_link|account-link/.test(readFileSync(f, 'utf8')),
      );

    expect(offenders).toEqual([]);
  });
});
