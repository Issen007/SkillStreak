import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  renderDemoInviteEmail,
  renderSignupConfirmationEmail,
} from '../mail/templates/event-demo-emails.template';
import { MailService } from '../mail/mail.service';
import { CreateEventRegistrationDto } from './dto/create-event-registration.dto';
import { SendDemoInvitesDto } from './dto/send-demo-invites.dto';
import { buildDemoInviteIcs } from './ics.util';
import {
  EventRegistration,
  EventRegistrationLocale,
} from './entities/event-registration.entity';

export interface EventRegistrationRow {
  id: string;
  name: string;
  email: string;
  interest: string;
  note: string | null;
  locale: string;
  campaign: string | null;
  createdAt: string;
  /** null = still to invite. Drives the admin console's send list. */
  inviteSentAt: string | null;
  /** When they consented to release mail, or null if they never did. The
   * console shows it as a column so "who may I mail about the launch" is
   * answerable by looking rather than by remembering. */
  releaseUpdatesOptedInAt: string | null;
  /** When they asked for a demo invite, or null. Backfilled for everyone
   * who registered before the box existed. */
  demoInviteRequestedAt: string | null;
  /**
   * The per-person opt-out link, exported with the send list so an invite
   * mailed from outside this app can still carry one. Every message to
   * this list needs it — an external mail merge is not an excuse.
   */
  unsubscribeUrl: string;
}

/**
 * Formats the start time for a reader.
 *
 * `Europe/Stockholm` is fixed rather than taken from the recipient: the
 * demo happens in Sweden at a Swedish time, and the honest way to say that
 * to someone abroad is to name the timezone, not to silently convert into
 * theirs and leave them guessing whether it was converted.
 */
function formatWhen(startsAt: Date, locale: EventRegistrationLocale): string {
  const formatted = new Intl.DateTimeFormat(
    locale === EventRegistrationLocale.EN ? 'en-GB' : 'sv-SE',
    {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Europe/Stockholm',
    },
  ).format(startsAt);
  return `${formatted} (Stockholm)`;
}

@Injectable()
export class EventRegistrationsService {
  private readonly logger = new Logger(EventRegistrationsService.name);

  constructor(
    @InjectRepository(EventRegistration)
    private readonly registrations: Repository<EventRegistration>,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Public, unauthenticated. Answers `{ registered: true }` for every
   * submission that passes validation — including the two cases where
   * nothing is written:
   *
   * - the honeypot was filled in (a bot), and
   * - this address is already on the list.
   *
   * Both are deliberate. Telling a bot it was detected teaches it to
   * evade; telling an anonymous caller "already registered" turns the form
   * into an address-existence oracle. Neither is worth the small honesty
   * of a more specific response on a form whose only job is to remember a
   * name.
   */
  async register(
    dto: CreateEventRegistrationDto,
  ): Promise<{ registered: true }> {
    if (dto.website && dto.website.trim().length > 0) {
      this.logger.warn('Event registration rejected by honeypot.');
      return { registered: true };
    }

    const email = dto.email.trim().toLowerCase();
    const now = new Date();

    // `orIgnore` rather than a read-then-write: two people submitting the
    // same address at once would both see "not there yet" and one would
    // hit the unique index. Let Postgres settle it.
    await this.registrations
      .createQueryBuilder()
      .insert()
      .into(EventRegistration)
      .values({
        name: dto.name.trim(),
        email,
        interest: dto.interest,
        note: dto.note?.trim() ? dto.note.trim() : null,
        locale: dto.locale,
        campaign: dto.campaign?.trim() ? dto.campaign.trim() : null,
        privacyAcceptedAt: new Date(),
        releaseUpdatesOptedInAt: dto.wantsReleaseUpdates ? now : null,
        demoInviteRequestedAt: dto.wantsDemoInvite ? now : null,
      })
      .orIgnore()
      .execute();

    // Someone already on the list who comes back to tick a box they did
    // not tick the first time. `orIgnore` above drops their whole
    // submission, so without this their new opt-in would be silently lost
    // — and the form would answer "registered" while having ignored the
    // only thing they came back to say.
    //
    // Only ever null → now, never the reverse: a resubmission with a box
    // left blank is far more likely to be someone re-registering than a
    // deliberate opt-out, and there is a real unsubscribe link for that.
    // Both statements are no-ops when the box was not ticked.
    await this.applyOptIn(
      email,
      'release_updates_opted_in_at',
      dto.wantsReleaseUpdates,
      now,
    );
    await this.applyOptIn(
      email,
      'demo_invite_requested_at',
      dto.wantsDemoInvite,
      now,
    );

    // Fire-and-forget on purpose. A confirmation email is a nicety; the
    // registration is the thing that matters, and an SMTP outage must not
    // turn a working form into a broken one. Failures are logged, not
    // surfaced — the person has been registered either way.
    void this.sendConfirmation(email);

    return { registered: true };
  }

  /**
   * Raises one opt-in flag on an existing row, and never lowers it.
   *
   * The `IS NULL` guard is what keeps the original consent moment
   * intact: someone who signs up three times should keep the date they
   * first agreed, not the date they last filled in a form.
   */
  private async applyOptIn(
    email: string,
    column: 'release_updates_opted_in_at' | 'demo_invite_requested_at',
    wanted: boolean | undefined,
    at: Date,
  ): Promise<void> {
    if (!wanted) return;
    await this.registrations
      .createQueryBuilder()
      .update(EventRegistration)
      .set({
        [column === 'release_updates_opted_in_at'
          ? 'releaseUpdatesOptedInAt'
          : 'demoInviteRequestedAt']: at,
      })
      .where('email = :email', { email })
      .andWhere(`${column} IS NULL`)
      .execute();
  }

  private async sendConfirmation(email: string): Promise<void> {
    try {
      const row = await this.registrations.findOne({ where: { email } });
      // Absent means the insert was ignored as a duplicate: this address
      // was already on the list and has already had a confirmation. Not an
      // error, and not a reason to send a second one.
      if (!row) return;

      const rendered = renderSignupConfirmationEmail({
        locale: row.locale,
        unsubscribeUrl: this.unsubscribeUrl(row.unsubscribeCode),
      });
      await this.mailService.sendMail({
        to: row.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (error) {
      this.logger.warn(
        `Could not send demo-signup confirmation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Mails the invitation to everyone who has not had one.
   *
   * **One message per recipient, never a BCC blast.** Each carries that
   * person's own unsubscribe link, which a shared BCC cannot do — and a
   * BCC header that leaks the whole list is one mistake away.
   *
   * Sequential rather than concurrent: SMTP relays rate-limit, and a demo
   * list is tens of addresses, so there is nothing to gain and a
   * throttling ban to lose.
   *
   * `invite_sent_at` is stamped **per recipient, immediately after that
   * send succeeds**. Stamping the whole batch at the end would mean a
   * crash halfway through re-mails everyone already contacted on the next
   * run; stamping before the send would silently skip anyone the relay
   * rejected.
   */
  async sendInvites(
    dto: SendDemoInvitesDto,
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    // Only people who actually asked for a demo invitation. Before
    // 2026-08-21 that was everyone — the form *was* the demo signup, and
    // the migration backfills them accordingly — but it is now a box you
    // tick, and someone who signed up only for release news must not be
    // mailed a Google Meet link they never asked for.
    const all = (
      await this.registrations.find({ order: { createdAt: 'ASC' } })
    ).filter((row) => Boolean(row.demoInviteRequestedAt));
    const targets = dto.resend
      ? all
      : all.filter((row) => row.inviteSentAt === null);

    const startsAt = new Date(dto.startsAt);
    const stamp = new Date();
    let sent = 0;
    let failed = 0;

    for (const row of targets) {
      try {
        const rendered = renderDemoInviteEmail({
          locale: row.locale,
          name: row.name,
          whenText: formatWhen(startsAt, row.locale),
          meetUrl: dto.meetUrl,
          message: dto.message?.trim() ? dto.message.trim() : null,
          unsubscribeUrl: this.unsubscribeUrl(row.unsubscribeCode),
        });

        await this.mailService.sendMail({
          to: row.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          attachments: [
            {
              filename: 'skillstreak-demo.ics',
              contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
              content: buildDemoInviteIcs({
                uid: `demo-${row.id}@skillstreak.xyz`,
                startsAt,
                durationMinutes: dto.durationMinutes,
                summary: 'SkillStreak',
                description: dto.meetUrl,
                url: dto.meetUrl,
                stamp,
              }),
            },
          ],
        });

        await this.registrations.update(
          { id: row.id },
          { inviteSentAt: new Date() },
        );
        sent += 1;
      } catch (error) {
        // One bad address must not abandon the rest of the list. The row
        // keeps inviteSentAt null, so the next run retries exactly the
        // ones that failed and nobody else.
        failed += 1;
        this.logger.error(
          `Demo invite failed for one recipient — left unsent for the next run: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { sent, failed, skipped: all.length - targets.length };
  }

  /** Admin-only. Newest first — the list is read as "who signed up today". */
  async list(): Promise<EventRegistrationRow[]> {
    const rows = await this.registrations.find({
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.toRow(row));
  }

  private toRow(row: EventRegistration): EventRegistrationRow {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      interest: row.interest,
      note: row.note,
      locale: row.locale,
      campaign: row.campaign,
      createdAt: row.createdAt.toISOString(),
      inviteSentAt: row.inviteSentAt ? row.inviteSentAt.toISOString() : null,
      releaseUpdatesOptedInAt: row.releaseUpdatesOptedInAt
        ? row.releaseUpdatesOptedInAt.toISOString()
        : null,
      demoInviteRequestedAt: row.demoInviteRequestedAt
        ? row.demoInviteRequestedAt.toISOString()
        : null,
      unsubscribeUrl: this.unsubscribeUrl(row.unsubscribeCode),
    };
  }

  private unsubscribeUrl(code: string): string {
    const base = (
      this.configService.get<string>('APP_PUBLIC_URL') ?? ''
    ).replace(/\/+$/, '');
    return `${base}/api/v1/event-registrations/unsubscribe/${code}`;
  }

  /**
   * Records that invitations went out, so the send list shrinks.
   *
   * Needed precisely because the first round is mailed by hand from an
   * exported CSV: without a way to say "these are done", the send list
   * would still show everyone on the second round and the whole list would
   * be mailed twice.
   *
   * Only ever moves null → now. Re-marking someone would rewrite the date
   * of an invitation that was actually sent earlier, and that date is the
   * only record of when a person was contacted.
   */
  async markInvited(ids: string[]): Promise<{ marked: number }> {
    if (ids.length === 0) return { marked: 0 };
    const result = await this.registrations.update(
      { id: In(ids), inviteSentAt: IsNull() },
      { inviteSentAt: new Date() },
    );
    return { marked: result.affected ?? 0 };
  }

  /**
   * The GET half of the unsubscribe link — returns who it belongs to
   * without changing anything, so a mail client prefetching the URL
   * cannot remove somebody.
   */
  async findByUnsubscribeCode(
    code: string,
  ): Promise<{ locale: EventRegistrationLocale } | null> {
    const row = await this.registrations.findOne({
      where: { unsubscribeCode: code },
      select: { id: true, locale: true },
    });
    return row ? { locale: row.locale } : null;
  }

  /**
   * The POST half. Deletes rather than flagging: keeping a tombstone would
   * mean holding someone's email address specifically after they asked us
   * to stop, which is the opposite of what they asked for.
   */
  async unsubscribe(code: string): Promise<{ removed: boolean }> {
    const result = await this.registrations.delete({ unsubscribeCode: code });
    return { removed: (result.affected ?? 0) > 0 };
  }

  /**
   * Admin-only hard delete — this is the erasure primitive. A marketing
   * list held on consent has to be able to honour "take me off it", and
   * the honest implementation of that is DELETE, not a soft-delete flag
   * that keeps the address forever.
   */
  async remove(id: string): Promise<{ deleted: boolean }> {
    const result = await this.registrations.delete({ id });
    return { deleted: (result.affected ?? 0) > 0 };
  }
}
