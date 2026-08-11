import { NotFoundException } from '@nestjs/common';
import {
  PrCampaignAudience,
  PrCampaignChannel,
  PrCampaignLocale,
  PrCampaignStatus,
} from './entities/pr-campaign.entity';
import { PrCampaignsService } from './pr-campaigns.service';

function buildService() {
  const save = jest.fn().mockResolvedValue({ id: 'c1' });
  const create = jest.fn().mockImplementation((columns: unknown) => columns);
  const update = jest.fn().mockResolvedValue({ affected: 1 });
  const del = jest.fn().mockResolvedValue({ affected: 1 });
  const query = jest.fn().mockResolvedValue([]);

  const service = new PrCampaignsService(
    { save, create, update, delete: del } as never,
    { query } as never,
  );
  return { service, save, create, update, del, query };
}

const base = {
  name: '  Summer post  ',
  tag: 'li-sv-sommar',
  channel: PrCampaignChannel.LINKEDIN,
  audience: PrCampaignAudience.GENERAL,
  locale: PrCampaignLocale.SV,
};

describe('PrCampaignsService', () => {
  it('stamps posted_at when a campaign moves to posted', async () => {
    const { service, create } = buildService();

    await service.create({ ...base, status: PrCampaignStatus.POSTED });

    // The status change is the event; the timestamp is its consequence. A
    // hand-typed date drifts from reality the first time the row is edited
    // for an unrelated reason.
    const [columns] = create.mock.calls[0] as [{ postedAt?: Date }];
    expect(columns.postedAt).toBeInstanceOf(Date);
  });

  it('leaves posted_at alone for any other status', async () => {
    const { service, create } = buildService();

    await service.create({ ...base, status: PrCampaignStatus.SCHEDULED });

    const [columns] = create.mock.calls[0] as [{ postedAt?: Date }];
    expect(columns.postedAt).toBeUndefined();
  });

  it('defaults a campaign with no status to draft', async () => {
    const { service, create } = buildService();

    await service.create({ ...base });

    const [columns] = create.mock.calls[0] as [{ status: string }];
    expect(columns.status).toBe(PrCampaignStatus.DRAFT);
  });

  it('trims the name and stores blank optional text as null', async () => {
    const { service, create } = buildService();

    await service.create({ ...base, body: '   ', postedUrl: '  ' });

    const [columns] = create.mock.calls[0] as [
      { name: string; body: string | null; postedUrl: string | null },
    ];
    expect(columns.name).toBe('Summer post');
    expect(columns.body).toBeNull();
    expect(columns.postedUrl).toBeNull();
  });

  it('rejects an update for a campaign that does not exist', async () => {
    const { service, update } = buildService();
    update.mockResolvedValue({ affected: 0 });

    await expect(service.update('gone', { ...base })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('counts signups by tag, keeping campaigns that brought none', async () => {
    const { service, query } = buildService();
    query.mockResolvedValue([
      {
        id: 'c1',
        name: 'A',
        tag: 'a',
        channel: 'linkedin',
        audience: 'general',
        locale: 'sv',
        status: 'posted',
        body: null,
        planned_for: null,
        posted_at: null,
        posted_url: null,
        signups: '0',
      },
    ]);

    const [row] = await service.list();

    // A LEFT JOIN, so a campaign that produced nothing still appears — the
    // ones that brought nobody are the ones worth looking at.
    expect(row.signups).toBe(0);
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain('LEFT JOIN');
  });
});
