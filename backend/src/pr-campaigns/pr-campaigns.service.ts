import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UpsertPrCampaignDto } from './dto/upsert-pr-campaign.dto';
import { PrCampaign, PrCampaignStatus } from './entities/pr-campaign.entity';

export interface PrCampaignRow {
  id: string;
  name: string;
  tag: string;
  channel: string;
  audience: string;
  locale: string;
  status: string;
  body: string | null;
  plannedFor: string | null;
  postedAt: string | null;
  postedUrl: string | null;
  /** How many demo signups arrived carrying this campaign's tag. */
  signups: number;
}

@Injectable()
export class PrCampaignsService {
  constructor(
    @InjectRepository(PrCampaign)
    private readonly campaigns: Repository<PrCampaign>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Every campaign, each with the number of signups its tag brought in.
   *
   * The count is a LEFT JOIN on a string, not a foreign key — see the
   * entity for why. A campaign with no signups shows 0 rather than
   * vanishing, which matters: the campaigns that produced nothing are the
   * ones worth looking at.
   */
  async list(): Promise<PrCampaignRow[]> {
    const rows = await this.dataSource.query<
      Array<Record<string, string | null>>
    >(`
      SELECT c.id, c.name, c.tag, c.channel, c.audience, c.locale, c.status,
             c.body, to_char(c.planned_for, 'YYYY-MM-DD') AS planned_for,
             c.posted_at, c.posted_url,
             COUNT(r.id)::text AS signups
        FROM pr_campaign c
        LEFT JOIN event_registration r ON r.campaign = c.tag
       GROUP BY c.id
       ORDER BY c.planned_for DESC NULLS LAST, c.created_at DESC
    `);

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      tag: String(row.tag),
      channel: String(row.channel),
      audience: String(row.audience),
      locale: String(row.locale),
      status: String(row.status),
      body: row.body ?? null,
      plannedFor: row.planned_for ?? null,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      postedUrl: row.posted_url ?? null,
      signups: Number(row.signups ?? 0),
    }));
  }

  async create(dto: UpsertPrCampaignDto): Promise<{ id: string }> {
    const saved = await this.campaigns.save(
      this.campaigns.create(this.toColumns(dto)),
    );
    return { id: saved.id };
  }

  async update(id: string, dto: UpsertPrCampaignDto): Promise<{ id: string }> {
    const result = await this.campaigns.update({ id }, this.toColumns(dto));
    if (!result.affected) throw new NotFoundException('No such campaign.');
    return { id };
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const result = await this.campaigns.delete({ id });
    return { deleted: (result.affected ?? 0) > 0 };
  }

  /**
   * `posted_at` is stamped by moving to `posted`, not typed in.
   *
   * A date field the operator fills in by hand drifts from reality the
   * first time they update the row for another reason. The status change
   * is the event; the timestamp should be its consequence. It is only set
   * on the transition, so re-saving a posted campaign does not rewrite
   * when it went out.
   */
  private toColumns(dto: UpsertPrCampaignDto): Partial<PrCampaign> {
    const columns: Partial<PrCampaign> = {
      name: dto.name.trim(),
      tag: dto.tag.trim(),
      channel: dto.channel,
      audience: dto.audience,
      locale: dto.locale,
      status: dto.status ?? PrCampaignStatus.DRAFT,
      body: dto.body?.trim() ? dto.body.trim() : null,
      plannedFor: dto.plannedFor ?? null,
      postedUrl: dto.postedUrl?.trim() ? dto.postedUrl.trim() : null,
    };
    if (dto.status === PrCampaignStatus.POSTED) {
      columns.postedAt = new Date();
    }
    return columns;
  }
}
