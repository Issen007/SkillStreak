import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { generateHumanCode } from '../common/crypto/human-code.util';
import { decryptPii, encryptPii } from '../common/crypto/pii-encryption.util';
import { buildConsentMessageId, CORRELATION_HEADER } from '../mail/dsn.parser';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { Player } from '../players/entities/player.entity';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import {
  PublicSharingConsent,
  PublicSharingConsentStatus,
  PublicSharingRevokedReason,
} from './entities/public-sharing-consent.entity';

/** Decision 1: the approval link expires; 14 days matches the PT flow. */
export const REVIEW_CODE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Decision 6: a month after the grant, then monthly from there. */
export const REMINDER_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/** Decision 5: two consecutive undeliverable reminders disable the consent. */
export const MAX_REMINDER_FAILURES = 2;

/** What a preview may reveal: enough to render a page, never a decision. */
export interface ConsentPreview {
  playerId: string;
  status: PublicSharingConsentStatus;
  /**
   * The child's **screen name**, never their real name.
   *
   * A parent with two children on the app cannot give informed consent to
   * a page that says only "your child" — Article 7(1) needs consent to be
   * specific, and a parent who cannot tell which child they are approving
   * for has not given it. Carried through to the request email for the
   * same reason.
   *
   * Screen name rather than real name because ADR-0002 isolates
   * `real_name` behind PlayerPrivateInfo and CLAUDE.md's anonymisation
   * rule means the screen name is the identifier the child themselves
   * chose to be known by. The parent set that name up with them; it
   * identifies the child to the one person who needs it without widening
   * what this table can leak.
   */
  screenName: string;
}

/**
 * ADR-0030's consent mechanism.
 *
 * **It gates nothing yet, on purpose.** ADR-0019's cross-team feed is
 * unbuilt, so no caller reads `isActiveFor` to publish anything. Building
 * this half first means the whole approve / remind / revoke lifecycle can
 * be exercised without a single clip leaving a team bubble.
 *
 * **Amended after the blocking security review, 2026-08-17.** The review
 * found that this had claimed to mirror `pt-consent.service.ts` while
 * dropping most of the protections that make that file safe. Four of its
 * findings are answered here, and each is marked at the code:
 *
 * - The codes never leave this service except by email (finding 1).
 * - Preview is separate from acting, and does not mutate (finding 2).
 * - The parent contact is checked against a pending contact change and
 *   then frozen, so it cannot be re-pointed later (finding 3).
 * - An active consent cannot be silently replaced by a new request
 *   (finding 7).
 *
 * **Finding 4 is closed as of 2026-08-19**, and closing it is what let
 * the reminder sweep be written at all. Two evidence paths now feed the
 * same failure counter: the SMTP handoff result (a refused recipient, or
 * an unconfigured mailer), and — the one Decision 5 was actually written
 * for — an asynchronous bounce, recovered by `BounceMailboxService`
 * polling a dedicated mailbox and parsing the returned DSNs.
 *
 * The consequence for this file is `sendReminder`: the failure streak is
 * settled by asking whether the PREVIOUS reminder bounced, because a
 * bounce for the current one cannot have arrived yet. Read its docstring
 * before changing anything about the counter — the obvious shape (reset
 * on send) makes Decision 5's disable unreachable.
 *
 * Findings 5, 6 and 8 closed 2026-08-18 (migration with ON DELETE
 * CASCADE, row locking, rate limiting).
 */
@Injectable()
export class PublicSharingConsentService {
  private readonly logger = new Logger(PublicSharingConsentService.name);

  constructor(
    @InjectRepository(PublicSharingConsent)
    private readonly consents: Repository<PublicSharingConsent>,
    // Read-only, and only ever for `screen_name` — see ConsentPreview.
    // Registered via forFeature in this module rather than by importing
    // PlayersModule, the same narrow-entity precedent video-clips.module
    // already sets for TeamChatBlock.
    @InjectRepository(Player)
    private readonly players: Repository<Player>,
    private readonly dataSource: DataSource,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly mailService: MailService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  private get encryptionKey(): string {
    return this.configService.getOrThrow<string>('PII_ENCRYPTION_KEY');
  }

  /**
   * The read ADR-0019 will eventually gate on. Nothing calls it yet.
   *
   * A boolean rather than the row: a caller deciding whether a clip may
   * be published has no business branching on *why* a consent is
   * inactive, and returning the row would invite exactly that.
   *
   * **It cannot enforce Decision 3's "only the child's own clips"** —
   * this is account-scoped and says nothing about whose clip is in hand.
   * That obligation belongs to the ADR-0019 caller and is recorded in the
   * ADR rather than left to be discovered during integration (finding 13).
   */
  /**
   * The three states the app renders, and nothing more.
   *
   * Deliberately collapses `declined`, `revoked`, `expired` and "no row at
   * all" into a single `none`: from the child's screen these are the same
   * situation — sharing is off and asking again is the way forward — and
   * distinguishing them would tell a child that a parent actively said no,
   * which is a conversation for the family rather than a status chip.
   */
  async statusFor(playerId: string): Promise<'none' | 'pending' | 'active'> {
    const row = await this.consents.findOne({ where: { playerId } });
    if (row?.status === PublicSharingConsentStatus.ACTIVE) return 'active';
    if (
      row?.status === PublicSharingConsentStatus.PENDING_REVIEW &&
      this.isReviewCodeLive(row)
    ) {
      return 'pending';
    }
    return 'none';
  }

  async isActiveFor(playerId: string): Promise<boolean> {
    const row = await this.consents.findOne({ where: { playerId } });
    return row?.status === PublicSharingConsentStatus.ACTIVE;
  }

  /**
   * Ask the parent.
   *
   * **Finding 1.** Returns no code. The approval link's only exit from
   * this process is the parent's inbox — that is the single property that
   * makes a mailed consent mean anything, and returning the code to the
   * caller removed it, leaving "child taps Enable" and "child's video may
   * leave the team" two in-process calls apart.
   */
  async request(
    playerId: string,
  ): Promise<{ requested: true; expiresAt: Date }> {
    const existing = await this.consents.findOne({ where: { playerId } });

    // Finding 7. An active consent is ended deliberately, never replaced
    // by a new request. Overwriting it in place skipped `deactivate()` —
    // and with it ADR-0019 Decision 5's un-publish hook — which would
    // leave clips published with no active consent behind them, the exact
    // state this ADR exists to make impossible. It also erased the record
    // that a parent ever approved, which Article 7(1) requires be
    // demonstrable and Decision 9's monthly review needs in order to ask
    // "has any parent actually disabled this?".
    if (existing?.status === PublicSharingConsentStatus.ACTIVE) {
      throw new Error(
        'public-sharing consent is already active for this player — it ' +
          'must be revoked before a new request (ADR-0030 Decision 2)',
      );
    }

    // Finding 3. A pending contact change means the address on file is
    // in the middle of being repointed, and the confirmation for that
    // goes to the NEW address. Requesting through that window is how a
    // player redirects their own parental approval to themselves. PT
    // refuses for the same reason.
    if (await this.playerPrivateInfoService.hasPendingContactChange(playerId)) {
      throw new Error(
        'a parent contact change is pending — public-sharing consent ' +
          'cannot be requested until it settles or is cancelled',
      );
    }

    // Decisions 1 and 10. A self-verified 13+ account has no parent
    // contact, and since the amended Decision 3 makes the monthly
    // reminder the only recurring control, admitting such an account
    // would mean not a weaker control but none at all.
    const parentContact =
      await this.playerPrivateInfoService.getParentContact(playerId);
    if (!parentContact) {
      throw new Error(
        'public-sharing consent needs a parent contact — a self-verified ' +
          'account must add one before sharing can be enabled (ADR-0030 ' +
          'Decision 10)',
      );
    }

    // Finding 8. Claimed after the validity checks and before anything is
    // written or mailed, so a refused request changes nothing — and, as
    // in the PT flow, so that probing the checks still costs the caller
    // their quota rather than being free.
    //
    // Two limits rather than one: a burst cooldown stops a loop, and a
    // daily cap stops a slow drip doing what the loop could not. Both
    // matter more here than for an ordinary mailer, because re-requesting
    // also invalidates the disable link a parent already holds.
    const cooled =
      await this.redisService.tryClaimPublicSharingRequestCooldown(playerId);
    if (!cooled) {
      throw new Error(
        'a public-sharing consent request was already sent recently — ' +
          'wait before asking again',
      );
    }
    const underCap =
      await this.redisService.tryClaimPublicSharingRequestDailyCap(playerId);
    if (!underCap) {
      throw new Error(
        'too many public-sharing consent requests for this player today',
      );
    }

    const { code, expiresAt } = generateHumanCode(REVIEW_CODE_TTL_MS);
    const row = existing ?? this.consents.create({ playerId });

    row.status = PublicSharingConsentStatus.PENDING_REVIEW;
    row.reviewCode = code;
    row.reviewCodeExpiresAt = expiresAt;
    // Finding 3, second half: frozen here for the row's lifetime. Every
    // later mail — including years of monthly reminders — goes to the
    // address that granted the consent, not to whatever the profile says
    // by then. A consent that follows a changed address is a consent that
    // can be handed to someone else without the grantor knowing.
    row.recipientContactSnapshot = encryptPii(
      parentContact,
      this.encryptionKey,
    );
    row.revokeCode = null;
    row.approvedAt = null;
    row.declinedAt = null;
    row.revokedAt = null;
    row.revokedReason = null;
    row.lastReminderAt = null;
    row.reminderFailureCount = 0;
    // Security review 2026-08-19, finding 4. Without this the previous
    // cycle's correlation token survived a revoke → re-request → approve,
    // so a straggling DSN about the OLD grant — possibly to a different
    // parent address entirely — was charged against the new one, putting
    // a freshly approved consent one report away from auto-revocation.
    // The ADR claimed a superseded reminder's DSN was ignored; across a
    // consent cycle it was not.
    row.lastReminderToken = null;
    row.lastReminderFailureAt = null;
    row.lastReminderFailureToken = null;
    await this.consents.save(row);

    await this.sendBestEffort(
      parentContact,
      'SkillStreak: godkänn delning utanför laget',
      `${await this.screenNameOf(playerId)} vill kunna dela sina egna ` +
        `klipp utanför laget.\n\n` +
        `Godkänn: ${this.approvalUrl(code)}\n\n` +
        `Om du inte gör något händer ingenting. Länken slutar gälla om ` +
        `14 dagar.`,
    );

    return { requested: true, expiresAt };
  }

  /**
   * Finding 2. Read-only, for a GET.
   *
   * Mail clients and corporate link scanners prefetch URLs. Without a
   * verb that only looks, the obvious wiring — GET the code straight into
   * `approve` — means Outlook Safe Links can grant a child's publication
   * consent with no human forming an intent. Mirrors the GET/POST split
   * ADR-0013 already made a repo convention.
   */
  /**
   * Falls back to a placeholder rather than throwing. A missing player row
   * here means the account was erased between the request and the click;
   * the page should still render and tell the parent the link is spent,
   * not 500 at them.
   */
  private async screenNameOf(playerId: string): Promise<string> {
    const player = await this.players.findOne({
      where: { id: playerId },
      select: { screenName: true },
    });
    return player?.screenName ?? 'ditt barn';
  }

  async previewByReviewCode(code: string): Promise<ConsentPreview | null> {
    if (!code) return null;
    const row = await this.consents.findOne({ where: { reviewCode: code } });
    if (!row || row.status !== PublicSharingConsentStatus.PENDING_REVIEW) {
      return null;
    }
    if (!this.isReviewCodeLive(row)) return null;
    return {
      playerId: row.playerId,
      status: row.status,
      screenName: await this.screenNameOf(row.playerId),
    };
  }

  async previewByRevokeCode(code: string): Promise<ConsentPreview | null> {
    if (!code) return null;
    const row = await this.consents.findOne({ where: { revokeCode: code } });
    if (!row || row.status !== PublicSharingConsentStatus.ACTIVE) return null;
    return {
      playerId: row.playerId,
      status: row.status,
      screenName: await this.screenNameOf(row.playerId),
    };
  }

  /**
   * Grants it. Finding 1: the revoke code is mailed, never returned.
   */
  async approveByReviewCode(code: string): Promise<{ approved: true } | null> {
    // Security review finding 6: locked, matching PT's own approve /
    // decline / revoke transitions. Two approvals racing — a parent
    // double-clicking, or a client retry — both read PENDING_REVIEW and
    // both mint a *different* revoke code. One wins the row; the other
    // code was already mailed. The parent then holds a disable link that
    // silently does nothing, which is the single failure Decision 2 says
    // cannot be tolerated.
    const locked = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PublicSharingConsent);
      const row = await repo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.review_code = :code', { code })
        .getOne();
      if (!row || row.status !== PublicSharingConsentStatus.PENDING_REVIEW) {
        return null;
      }
      if (!this.isReviewCodeLive(row)) {
        row.status = PublicSharingConsentStatus.EXPIRED;
        row.reviewCode = null;
        row.reviewCodeExpiresAt = null;
        await repo.save(row);
        return null;
      }

      const { code: revokeCode } = generateHumanCode(0);
      row.status = PublicSharingConsentStatus.ACTIVE;
      row.approvedAt = new Date();
      row.reviewCode = null;
      row.reviewCodeExpiresAt = null;
      row.revokeCode = revokeCode;
      // Decision 6: the clock starts at the grant, so a family that opts
      // in on the 20th hears on the 20th rather than on the 1st with
      // everyone.
      row.lastReminderAt = new Date();
      row.reminderFailureCount = 0;
      await repo.save(row);
      return { row, revokeCode };
    });
    if (!locked) return null;
    const { row, revokeCode } = locked;

    // Mailed outside the transaction: an SMTP round trip should not hold
    // a row lock, and the consent is already durable by this point.
    await this.sendBestEffort(
      this.recipientOf(row),
      'SkillStreak: delning är påslagen',
      `Delning utanför laget är nu påslagen för ditt barn.\n\n` +
        `Du kan stänga av den när som helst: ${this.revokeUrl(revokeCode)}\n\n` +
        `Spara det här mejlet — vi påminner dig en gång i månaden så länge ` +
        `delningen är påslagen.`,
    );

    return { approved: true };
  }

  async declineByReviewCode(code: string): Promise<{ declined: true } | null> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PublicSharingConsent);
      const row = await repo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.review_code = :code', { code })
        .getOne();
      if (!row || row.status !== PublicSharingConsentStatus.PENDING_REVIEW) {
        return null;
      }
      if (!this.isReviewCodeLive(row)) return null;

      row.status = PublicSharingConsentStatus.DECLINED;
      row.declinedAt = new Date();
      row.reviewCode = null;
      row.reviewCodeExpiresAt = null;
      await repo.save(row);

      return { declined: true as const };
    });
  }

  /**
   * Decision 2: off is immediate, unconditional and needs no login.
   *
   * Deletes nothing. Withdrawing consent to *publication* is not a
   * request to destroy the child's own material, and conflating the two
   * would punish the safer choice.
   */
  async revokeByRevokeCode(code: string): Promise<{ revoked: true } | null> {
    if (!code) return null;
    // Locked like the other two. A revoke racing an approve could
    // otherwise clobber it and leave the row ACTIVE with the revoke code
    // cleared — sharing on, and no way for the parent to turn it off.
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PublicSharingConsent);
      const row = await repo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.revoke_code = :code', { code })
        .getOne();
      if (!row || row.status !== PublicSharingConsentStatus.ACTIVE) return null;

      row.status = PublicSharingConsentStatus.REVOKED;
      row.revokedAt = new Date();
      row.revokedReason = PublicSharingRevokedReason.PARENT_REVOKED;
      row.reviewCode = null;
      row.reviewCodeExpiresAt = null;
      row.revokeCode = null;
      await repo.save(row);

      return { revoked: true as const };
    });
  }

  /**
   * How many consents are currently live.
   *
   * Read by the reminder sweep to say how many families are unsupervised
   * while bounce detection is unconfigured — a standing condition, so it
   * must not be reported only on the days a reminder happens to be due.
   */
  async countActive(): Promise<number> {
    return this.consents.count({
      where: { status: PublicSharingConsentStatus.ACTIVE },
    });
  }

  /** Every consent whose monthly reminder is due. */
  async findDueReminders(
    now: Date = new Date(),
  ): Promise<PublicSharingConsent[]> {
    return this.consents.find({
      where: {
        status: PublicSharingConsentStatus.ACTIVE,
        lastReminderAt: LessThanOrEqual(
          new Date(now.getTime() - REMINDER_INTERVAL_MS),
        ),
      },
      order: { lastReminderAt: 'ASC' },
      take: 500,
    });
  }

  /**
   * Sends one monthly reminder, and settles the PREVIOUS one's outcome
   * on the way.
   *
   * **The ordering here is the whole of finding 4.** A bounce is
   * asynchronous — it arrives days after the send that caused it — so
   * "did this send succeed?" is unanswerable at send time and always
   * was. What IS answerable is "did the previous reminder bounce?",
   * because by now its DSN has either come back or it hasn't. That is
   * the question this asks, and it is why the failure counter is
   * evaluated here rather than reset here.
   *
   * The old `recordReminderSent` reset the counter to 0 on every send.
   * Combined with an asynchronous bounce that arrives afterwards, the
   * sequence would have run send → 0 → bounce → 1 → send → 0 → bounce →
   * 1 forever: Decision 5's disable could never fire, no matter how
   * permanently dead the address was. The method is gone rather than
   * kept, so nothing can call it by habit.
   */
  async sendReminder(
    row: PublicSharingConsent,
    now: Date = new Date(),
  ): Promise<{ sent: boolean; disabled: boolean }> {
    if (row.status !== PublicSharingConsentStatus.ACTIVE) {
      return { sent: false, disabled: false };
    }

    // Did the previous reminder bounce? A bounce timestamped at or after
    // the last send is a bounce for that send.
    if (!this.previousReminderFailed(row)) {
      // The streak is broken. Note this resets on "no bounce came back",
      // which is genuinely the only positive delivery signal SMTP offers
      // — there is no delivery receipt to wait for. Silence is evidence
      // here in a way it is not for the handoff result.
      row.reminderFailureCount = 0;
    }

    // Backstop only: the failure intake already disables at the threshold
    // the moment the second report lands, so reaching this means one was
    // recorded while that path could not complete. Checked anyway,
    // because the cost of being wrong is a child's clips staying
    // publishable behind an address nobody reads.
    //
    // **Conditional, like the claim below, and for the same reason**
    // (security review 2026-08-19, second pass). This used to call
    // `deactivate(row)`, which saves the whole stale entity through the
    // default repository outside any transaction. That cannot resurrect
    // an active consent — it only ever writes REVOKED — but against a
    // concurrent parent revoke it would overwrite `revoked_at` and
    // `revoked_reason` with `reminder_undeliverable`, destroying the
    // record that a parent used their disable link. That record is what
    // Article 7(1) demonstrability rests on and what Decision 9's monthly
    // review exists to read.
    if (row.reminderFailureCount >= MAX_REMINDER_FAILURES) {
      const disabled = await this.consents.update(
        { id: row.id, status: PublicSharingConsentStatus.ACTIVE },
        {
          status: PublicSharingConsentStatus.REVOKED,
          revokedAt: now,
          revokedReason: PublicSharingRevokedReason.REMINDER_UNDELIVERABLE,
          reviewCode: null,
          reviewCodeExpiresAt: null,
          revokeCode: null,
        },
      );
      if (disabled.affected) {
        this.logger.warn(
          `Public-sharing consent ${row.id} disabled at reminder time: ` +
            `${row.reminderFailureCount} consecutive undeliverable reminders.`,
        );
      }
      return { sent: false, disabled: Boolean(disabled.affected) };
    }

    // Minted per send, from a CSPRNG, and carrying nothing derived from
    // the player or the address — a bounce mailbox is the least protected
    // place any of this appears, and a token that encoded who it was
    // about would leak that to anyone who saw one.
    const token = randomBytes(24).toString('base64url');

    // Persisted BEFORE the send, for two reasons.
    //
    // A bounce can arrive while the SMTP call is still returning; if the
    // token were saved afterwards the DSN would find no row to attribute
    // itself to and the failure would go uncounted.
    //
    // **And it is a conditional UPDATE, not `save(row)`** (security
    // review 2026-08-19, finding 2). `row` came from `findDueReminders()`
    // at the top of the sweep and may be minutes stale by the time this
    // runs. TypeORM's `save()` diffs the in-memory entity against the
    // current database row and writes back every column that differs —
    // so if a parent revoked in that window, saving this entity restored
    // `status = 'active'`, the old revoke code and a null `revoked_at`,
    // silently turning a child's sharing back on after the parent had
    // been told it was off. Verified against Postgres before the fix.
    // The `status: ACTIVE` predicate makes the write lose that race
    // instead of winning it.
    const claimed = await this.consents.update(
      { id: row.id, status: PublicSharingConsentStatus.ACTIVE },
      {
        lastReminderToken: token,
        lastReminderAt: now,
        reminderFailureCount: row.reminderFailureCount,
      },
    );
    if (!claimed.affected) {
      // Revoked, expired or erased underneath us. Nothing to send, and
      // nothing to record.
      return { sent: false, disabled: false };
    }
    row.lastReminderToken = token;
    row.lastReminderAt = now;

    const sent = await this.sendBestEffort(
      this.recipientOf(row),
      'SkillStreak: delning utanför laget är fortfarande påslagen',
      `Delning utanför laget är fortfarande påslagen för ` +
        `${await this.screenNameOf(row.playerId)}.\n\n` +
        `Du kan stänga av den när som helst: ` +
        `${this.revokeUrl(row.revokeCode ?? '')}\n\n` +
        `Du får det här mejlet en gång i månaden så länge delningen är ` +
        `påslagen.`,
      {
        messageId: buildConsentMessageId(token, this.mailDomain()),
        headers: { [CORRELATION_HEADER]: token },
      },
    );

    // **Recorded against the token, exactly like a bounce** (security
    // review 2026-08-19, finding 1). A refusal at handoff — a 550 at
    // RCPT TO, or no mailer configured at all — is as undeliverable as a
    // bounce, and on domains that reject synchronously it is the *most
    // common* dead-mailbox case.
    //
    // It used to increment a counter that carried no token, so the next
    // send saw no failure recorded against the previous reminder and
    // reset the streak to zero. Six months of a permanently refused
    // address produced the count sequence [1,1,1,1,1,1] and left the
    // consent ACTIVE forever — the very loop this method was written to
    // eliminate, surviving on the other evidence path.
    if (!sent) {
      const failure = await this.recordReminderUndeliverable(token, now);
      return {
        sent: false,
        disabled: failure.matched ? failure.disabled : false,
      };
    }

    return { sent, disabled: false };
  }

  /**
   * One reminder was undeliverable. Counts it toward Decision 5.
   *
   * **Both evidence paths land here**, keyed on that reminder's own
   * correlation token: an asynchronous bounce (via `BounceMailboxService`,
   * which recovers the token from the returned original headers, never
   * from an address alone) and a synchronous refusal at SMTP handoff.
   * Decision 5 says *undeliverable*, not *bounced*, and a 550 at RCPT TO
   * is exactly as undeliverable as a DSN three days later — on domains
   * that reject synchronously it is the more common of the two.
   *
   * Runs in a transaction on a `pessimistic_write`-locked row, matching
   * `approve`/`decline`/`revoke` (the earlier review's finding 6). The
   * unlocked read-modify-write this used to do could write a stale
   * `status` back over a concurrent revoke — see `sendReminder`'s note on
   * finding 2 for what that costs.
   */
  async recordReminderUndeliverable(
    token: string,
    now: Date = new Date(),
  ): Promise<
    { matched: false } | { matched: true; counted: boolean; disabled: boolean }
  > {
    if (!token) return { matched: false };

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PublicSharingConsent);
      const row = await repo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.last_reminder_token = :token', { token })
        .getOne();
      if (!row) return { matched: false as const };

      // A consent that is no longer active has nothing left to disable —
      // the parent may have revoked it in the days the evidence spent in
      // transit.
      if (row.status !== PublicSharingConsentStatus.ACTIVE) {
        return { matched: true as const, counted: false, disabled: false };
      }
      if (row.lastReminderAt === null) {
        return { matched: true as const, counted: false, disabled: false };
      }

      // Idempotent per reminder. A duplicate DSN, or one MTA reporting
      // the same failure twice, must not advance the streak — two
      // reports for ONE reminder is one missed month, not two. Without
      // this, Decision 5's "two consecutive undeliverable reminders"
      // would quietly become "two delivery reports", and a single dead
      // address could disable a consent within minutes of the first send.
      if (this.previousReminderFailed(row)) {
        return { matched: true as const, counted: false, disabled: false };
      }

      row.lastReminderFailureAt = now;
      row.lastReminderFailureToken = row.lastReminderToken;
      row.reminderFailureCount += 1;

      if (row.reminderFailureCount >= MAX_REMINDER_FAILURES) {
        this.applyDeactivation(
          row,
          PublicSharingRevokedReason.REMINDER_UNDELIVERABLE,
        );
        await repo.save(row);
        this.logger.warn(
          `Public-sharing consent ${row.id} disabled: ` +
            `${row.reminderFailureCount} consecutive undeliverable reminders.`,
        );
        return { matched: true as const, counted: true, disabled: true };
      }

      await repo.save(row);
      return { matched: true as const, counted: true, disabled: false };
    });
  }

  /**
   * Whether a bounce has already been recorded for the most recent
   * reminder — the single comparison both the sweep and the bounce
   * intake turn on, so they cannot drift apart.
   *
   * **Compares tokens, not timestamps, and that is load-bearing.** The
   * first version of this asked whether `lastReminderFailureAt >=
   * lastReminderAt`. That is wrong whenever a send and a bounce land on
   * the same instant — a duplicate DSN arriving in the same tick, two
   * pods with skewed clocks — because the second genuine bounce then
   * looks like a duplicate of the first and is dropped. The consent it
   * should have disabled stays live, which is precisely the failure this
   * whole mechanism exists to prevent. A token identifies exactly one
   * send, so the comparison is total.
   *
   * Truthiness rather than `!== null` because a hand-built row (a
   * fixture, a partial from a migration window) can carry `undefined`
   * where the database holds `null`.
   */
  private previousReminderFailed(row: PublicSharingConsent): boolean {
    return Boolean(
      row.lastReminderFailureToken &&
      row.lastReminderToken &&
      row.lastReminderFailureToken === row.lastReminderToken,
    );
  }

  /**
   * The domain the correlation Message-ID is minted under.
   *
   * Derived from SMTP_FROM rather than hardcoded, so the internal test
   * cluster and production each stamp their own — per CLAUDE.md's
   * environment-parity rule, a value like this must never be one
   * environment's baked into both.
   */
  private mailDomain(): string {
    const from = this.configService.get<string>('SMTP_FROM') ?? '';
    const match = /@([A-Za-z0-9.-]+)/.exec(from);
    return match ? match[1] : 'skillstreak.xyz';
  }

  /*
   * `recordReminderFailure(id)` used to live here and is deliberately
   * GONE (security review 2026-08-19, finding 1).
   *
   * It incremented the failure counter without recording WHICH reminder
   * had failed. Since `sendReminder` settles the streak by asking whether
   * the previous reminder failed — and that question is answered by a
   * token — a tokenless increment was invisible to the next send, which
   * then reset the count to zero. Six months against a permanently
   * refused address produced [1,1,1,1,1,1] and left the consent ACTIVE
   * forever: the exact loop this design exists to prevent, surviving on
   * the synchronous evidence path after it had been fixed on the
   * asynchronous one.
   *
   * Use `recordReminderUndeliverable(token)` instead. It is removed
   * rather than deprecated so nothing can call it out of habit.
   */

  /** The address that granted the consent, not whatever the profile says now. */
  recipientOf(row: PublicSharingConsent): string | null {
    return row.recipientContactSnapshot
      ? decryptPii(row.recipientContactSnapshot, this.encryptionKey)
      : null;
  }

  /**
   * The state transition alone, with no write.
   *
   * Split out so a caller already holding a locked row inside a
   * transaction can apply it and save through its own repository —
   * `deactivate` below saves through the default one, which would escape
   * that transaction and defeat the lock.
   */
  private applyDeactivation(
    row: PublicSharingConsent,
    reason: PublicSharingRevokedReason,
  ): void {
    row.status = PublicSharingConsentStatus.REVOKED;
    row.revokedAt = new Date();
    row.revokedReason = reason;
    // Both cleared: a revoked consent must not be re-approvable from an
    // old link, and its disable link has nothing left to do.
    row.reviewCode = null;
    row.reviewCodeExpiresAt = null;
    row.revokeCode = null;
  }

  /**
   * Finding 9. Null means NOT live, matching PT's `isReviewCodeLive`.
   * Reading a missing expiry as "never expires" is the wrong direction to
   * fail in for a code that grants publication of a child's video.
   */
  private isReviewCodeLive(row: PublicSharingConsent): boolean {
    return (
      row.reviewCodeExpiresAt !== null &&
      row.reviewCodeExpiresAt.getTime() > Date.now()
    );
  }

  /*
   * `deactivate(row)` used to live here and is removed (security review
   * 2026-08-19, second pass). Every caller now either holds a locked row
   * inside a transaction — and so uses `applyDeactivation` plus its own
   * repository — or issues a conditional UPDATE. Saving a whole,
   * possibly-stale entity through the default repository is the shape
   * that produced the revoke-resurrection bug, and leaving a helper
   * around that still does it is an invitation to reintroduce it.
   */

  /*
   * `findPendingByReviewCode` used to live here and is removed (security
   * review 2026-08-19, second pass). It had no callers — `previewByReviewCode`
   * and `approveByReviewCode` each do their own lookup — and it carried a
   * third unlocked read-modify-write on this entity (expire → save), which
   * is the shape that produced the revoke-resurrection bug. Dead code that
   * models a pattern the rest of the file has moved away from is worse
   * than no code.
   */

  private appPublicUrl(): string {
    return this.configService.get<string>('APP_PUBLIC_URL') ?? '';
  }

  private approvalUrl(code: string): string {
    return `${this.appPublicUrl()}/api/v1/public-sharing-consent/${code}`;
  }

  private revokeUrl(code: string): string {
    return `${this.appPublicUrl()}/api/v1/public-sharing-consent/revoke/${code}`;
  }

  /**
   * Mail failures must not roll back a consent decision that has already
   * been persisted — the same best-effort posture as PT's.
   *
   * The boolean it returns is still only an SMTP *handoff* result, not
   * delivery. For a reminder it is one of two evidence paths; the other,
   * and the one Decision 5 was written for, arrives asynchronously via
   * `BounceMailboxService`.
   */
  private async sendBestEffort(
    to: string | null,
    subject: string,
    text: string,
    correlation?: { messageId: string; headers: Record<string, string> },
  ): Promise<boolean> {
    if (!to) return false;
    try {
      // Plain text only for now: these are short, and an HTML body would
      // need the same escaping and template review the consent-page
      // templates already carry. Worth doing before this is exposed.
      const result = await this.mailService.sendMail({
        to,
        subject,
        text,
        html: text,
        ...(correlation ?? {}),
      });
      if (!result.handedOff) {
        this.logger.warn(
          `Public-sharing consent mail not handed off (${result.reason}).`,
        );
      }
      return result.handedOff;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Public-sharing consent mail failed: ${message}`);
      return false;
    }
  }
}
