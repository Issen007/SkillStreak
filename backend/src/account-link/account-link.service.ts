import { createHash, randomBytes } from 'crypto';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { isSelfVerificationAge } from '../common/age/self-verification-age.util';
import { Player } from '../players/entities/player.entity';
import { AccountLink } from './entities/account-link.entity';
import { AccountLinkChallenge } from './entities/account-link-challenge.entity';

/** ADR-0031 Decision 1. Long enough to walk to a browser and sign in with
 * a provider; short enough that a challenge left in a URL bar is not a
 * standing invitation. */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export class AccountLinkNotAllowedException extends ForbiddenException {
  readonly code = 'account_link_not_allowed';
  constructor() {
    // One message for every refusal reason — under age, already linked,
    // challenge missing, expired, consumed, or the staff account already
    // holding a link. Distinguishing them would tell a caller which of
    // those states another account is in.
    super('This account cannot be linked right now.');
  }
}

/**
 * ADR-0031 — joining a player account to a trainer account.
 *
 * **Everything here is built around one rule: neither side may name the
 * other.** The player identity always comes from a challenge that a
 * player's own authenticated session minted; the staff identity always
 * comes from `StaffAuthGuard` on a live SSO session. There is no method
 * on this service that accepts both ids from a caller, and adding one
 * would reintroduce exactly the attack the design exists to prevent —
 * an adult starting a link against a child they can identify.
 *
 * **The link grants nothing** (Decision 3). Nothing in this file is
 * consulted by a guard, and `account-link.guards.spec.ts` fails if that
 * changes.
 */
@Injectable()
export class AccountLinkService {
  private readonly logger = new Logger(AccountLinkService.name);

  constructor(
    @InjectRepository(AccountLink)
    private readonly links: Repository<AccountLink>,
    @InjectRepository(AccountLinkChallenge)
    private readonly challenges: Repository<AccountLinkChallenge>,
    @InjectRepository(Player)
    private readonly players: Repository<Player>,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Step 1 — the player asks to link. Returns the plaintext token exactly
   * once; only its hash is stored.
   *
   * **The age check is here and not only in the UI.** The profile screen
   * hides the entry below 13, but a hidden control is not a gate — this
   * is the one that counts, and ADR-0031's invariant 5 pins it.
   */
  async createChallenge(
    playerId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const player = await this.players.findOne({
      where: { id: playerId },
      select: { id: true, birthYear: true },
    });
    if (
      !player ||
      !isSelfVerificationAge(player.birthYear, player.jurisdiction)
    ) {
      throw new AccountLinkNotAllowedException();
    }
    if (await this.links.findOne({ where: { playerId } })) {
      // Already linked. Unlink first — re-linking silently would let a
      // challenge move a link to a different staff account.
      throw new AccountLinkNotAllowedException();
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    await this.challenges.save(
      this.challenges.create({
        tokenHash: this.hash(token),
        playerId,
        expiresAt,
        consumedAt: null,
      }),
    );
    return { token, expiresAt };
  }

  /**
   * Step 2 — completed from the console, with a live staff session.
   *
   * The staff id comes from the guard and the player id from the
   * challenge; the caller supplies only the token. Both halves are
   * therefore proven rather than asserted, which is the whole of
   * Decision 1.
   */
  async completeLink(
    staffAccountId: string,
    token: unknown,
  ): Promise<{ linked: true }> {
    if (typeof token !== 'string' || token.length === 0) {
      throw new AccountLinkNotAllowedException();
    }

    // Single-use enforced by a conditional UPDATE rather than
    // read-then-write: two console tabs racing the same challenge must
    // not both succeed, and a check first would let them.
    const claimed = await this.challenges.update(
      {
        tokenHash: this.hash(token),
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      { consumedAt: new Date() },
    );
    if (!claimed.affected) {
      throw new AccountLinkNotAllowedException();
    }

    const challenge = await this.challenges.findOne({
      where: { tokenHash: this.hash(token) },
      select: { playerId: true },
    });
    if (!challenge) throw new AccountLinkNotAllowedException();

    try {
      await this.links.save(
        this.links.create({ playerId: challenge.playerId, staffAccountId }),
      );
    } catch {
      // The unique indexes are the real one-to-one guarantee. A violation
      // here means either identity was linked between the checks above
      // and this write — refuse rather than overwrite, and the consumed
      // challenge is not reusable, which is correct: the player must
      // start again from a state they can see.
      throw new AccountLinkNotAllowedException();
    }
    this.logger.log('Account link created.');
    return { linked: true };
  }

  /** Decision 4 — either side alone, no confirmation, always safe. */
  async unlinkAsPlayer(playerId: string): Promise<{ linked: false }> {
    await this.links.delete({ playerId });
    return { linked: false };
  }

  async unlinkAsStaff(staffAccountId: string): Promise<{ linked: false }> {
    await this.links.delete({ staffAccountId });
    return { linked: false };
  }

  /**
   * What the app asks so it can show "open trainer mode" instead of
   * "are you a trainer?".
   *
   * Deliberately returns a boolean and nothing else — no staff email, no
   * role, no provider. Those are facts about an account the player's own
   * session does not authenticate, and the app has no use for them.
   */
  async statusForPlayer(playerId: string): Promise<{ linked: boolean }> {
    const link = await this.links.findOne({
      where: { playerId },
      select: { id: true },
    });
    return { linked: link !== null };
  }

  /** Housekeeping: expired, unconsumed challenges are dead weight. */
  async purgeExpiredChallenges(now = new Date()): Promise<number> {
    const result = await this.challenges.delete({
      consumedAt: IsNull(),
      expiresAt: LessThan(now),
    });
    return result.affected ?? 0;
  }
}
