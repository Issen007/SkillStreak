import { toPlanningResponse } from './admin-planning.view';

function section(source: string, syncedAt: string | null) {
  return {
    source: source as never,
    content: syncedAt ? '# content' : '',
    syncedAt,
    available: syncedAt !== null,
  };
}

describe('toPlanningResponse', () => {
  // §7.6's staleness banner must reflect the stalest thing on screen. If
  // this took the newest instead, refreshing one half of /roadmap would
  // hide that the other half is months old.
  it('reports the OLDEST syncedAt across sections, not the newest', () => {
    const result = toPlanningResponse([
      section('roadmapPlan', '2026-08-08T00:00:00.000Z'),
      section('roadmapProject', '2026-06-01T00:00:00.000Z'),
    ]);

    expect(result.syncedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(result.sections).toHaveLength(2);
  });

  // "Configured but old" and "not configured at all" are different states
  // the console renders differently — an absent half must not be treated
  // as infinitely stale and drag the banner down.
  it('ignores unavailable sections when computing syncedAt', () => {
    const result = toPlanningResponse([
      section('roadmapPlan', '2026-08-08T00:00:00.000Z'),
      section('roadmapProject', null),
    ]);

    expect(result.syncedAt).toBe('2026-08-08T00:00:00.000Z');
  });

  it('reports a null syncedAt when nothing is mounted at all', () => {
    const result = toPlanningResponse([section('securityIssues', null)]);

    expect(result.syncedAt).toBeNull();
    expect(result.sections[0].available).toBe(false);
  });

  // §13: /roadmap returns its two halves already grouped and labelled, so
  // the console never re-splits or re-parses them client-side.
  it('preserves section order and source labels', () => {
    const result = toPlanningResponse([
      section('roadmapPlan', '2026-08-08T00:00:00.000Z'),
      section('roadmapProject', '2026-08-07T00:00:00.000Z'),
    ]);

    expect(result.sections.map((s) => s.source)).toEqual([
      'roadmapPlan',
      'roadmapProject',
    ]);
  });
});
