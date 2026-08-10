import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { CreateEventRegistrationDto } from './dto/create-event-registration.dto';
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
  /**
   * The per-person opt-out link, exported with the send list so an invite
   * mailed from outside this app can still carry one. Every message to
   * this list needs it — an external mail merge is not an excuse.
   */
  unsubscribeUrl: string;
}

@Injectable()
export class EventRegistrationsService {
  private readonly logger = new Logger(EventRegistrationsService.name);

  constructor(
    @InjectRepository(EventRegistration)
    private readonly registrations: Repository<EventRegistration>,
    private readonly configService: ConfigService,
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
      })
      .orIgnore()
      .execute();

    return { registered: true };
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
