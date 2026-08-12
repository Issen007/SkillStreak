import { ClipTaggingStatsService } from './clip-tagging-stats.service';

describe('ClipTaggingStatsService', () => {
  function build(rows: {
    status?: Array<{ tagging_status: string; count: string }>;
    tags?: Array<{ tag: string; count: string; avg: string }>;
    sources?: Array<{ source: string; count: string }>;
  }) {
    const query: jest.Mock = jest.fn((sql: string): Promise<unknown[]> => {
      if (sql.includes('FROM video_clip_tag') && sql.includes('source')) {
        return Promise.resolve<unknown[]>(rows.sources ?? []);
      }
      if (sql.includes('FROM video_clip_tag')) {
        return Promise.resolve<unknown[]>(rows.tags ?? []);
      }
      return Promise.resolve<unknown[]>(rows.status ?? []);
    });
    return { query, service: new ClipTaggingStatsService({ query } as never) };
  }

  it('reports silentRate as null before anything is processed', async () => {
    // Not 0: "nothing has run yet" and "it tags everything confidently"
    // are opposite findings and must not render identically.
    const { service } = build({
      status: [{ tagging_status: 'not_processed', count: '9' }],
    });
    const stats = await service.collect();

    expect(stats.silentRate).toBeNull();
    expect(stats.pending).toBe(9);
    expect(stats.publishedClips).toBe(9);
  });

  it('computes silentRate over processed clips, not all clips', async () => {
    // Pending clips are not evidence about the model. Including them would
    // make the rate drift purely because the worker was slow.
    const { service } = build({
      status: [
        { tagging_status: 'tagged', count: '3' },
        { tagging_status: 'no_confident_tags', count: '1' },
        { tagging_status: 'not_processed', count: '96' },
      ],
    });
    expect((await service.collect()).silentRate).toBeCloseTo(0.25);
  });

  it('surfaces failures separately from silence', async () => {
    // "the model declined" and "we could not process it" are different
    // problems: one is about the model, one is about the pipeline.
    const { service } = build({
      status: [
        { tagging_status: 'no_confident_tags', count: '2' },
        { tagging_status: 'failed', count: '5' },
      ],
    });
    const stats = await service.collect();
    expect(stats.failed).toBe(5);
    expect(stats.silentRate).toBe(1);
  });

  it('returns tag counts with rounded average confidence', async () => {
    const { service } = build({
      status: [{ tagging_status: 'tagged', count: '2' }],
      tags: [{ tag: 'passing', count: '2', avg: '0.4266666' }],
    });
    expect((await service.collect()).tagCounts).toEqual([
      { tag: 'passing', count: 2, averageConfidence: 0.427 },
    ]);
  });

  it('never issues a query mentioning a team, player or clip id', async () => {
    // The structural guarantee. This surface must not become a way to ask
    // what a particular child has been training, and the cheapest way to
    // keep that true is that no query here can express the question.
    const { service, query } = build({ status: [] });
    await service.collect();

    for (const call of query.mock.calls as Array<[string]>) {
      const sql = call[0].toLowerCase();
      expect(sql).not.toContain('team_id');
      expect(sql).not.toContain('player_id');
      expect(sql).not.toContain('clip_id');
      expect(sql).not.toContain('uploader');
    }
  });
});
