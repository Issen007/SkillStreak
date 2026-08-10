import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateEventRegistrationDto } from './dto/create-event-registration.dto';
import { EventRegistration } from './entities/event-registration.entity';

export interface EventRegistrationRow {
  id: string;
  name: string;
  email: string;
  interest: string;
  note: string | null;
  locale: string;
  campaign: string | null;
  createdAt: string;
}

@Injectable()
export class EventRegistrationsService {
  private readonly logger = new Logger(EventRegistrationsService.name);

  constructor(
    @InjectRepository(EventRegistration)
    private readonly registrations: Repository<EventRegistration>,
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
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      interest: row.interest,
      note: row.note,
      locale: row.locale,
      campaign: row.campaign,
      createdAt: row.createdAt.toISOString(),
    }));
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
