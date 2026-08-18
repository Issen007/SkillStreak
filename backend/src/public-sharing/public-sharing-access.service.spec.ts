import { PublicSharingAccessService } from './public-sharing-access.service';

function build(value: string | undefined) {
  return new PublicSharingAccessService({
    get: () => value,
  } as never);
}

describe('PublicSharingAccessService', () => {
  it('allows a team on the list', () => {
    expect(build('team-a,team-b').isEnabledForTeam('team-b')).toBe(true);
  });

  it('refuses a team that is not on the list', () => {
    expect(build('team-a').isEnabledForTeam('team-z')).toBe(false);
  });

  // The whole point of the setting. A deployment that forgets the env var
  // must not open child media to every team — the failure has to land on
  // the side of nobody sharing, never everybody.
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['only separators and spaces', ' , ,  '],
  ])('allows nobody when the list is %s', (_label, value) => {
    expect(build(value).isEnabledForTeam('team-a')).toBe(false);
  });

  it('refuses a missing team id rather than treating it as a wildcard', () => {
    const service = build('team-a');
    expect(service.isEnabledForTeam(undefined)).toBe(false);
    expect(service.isEnabledForTeam(null)).toBe(false);
    expect(service.isEnabledForTeam('')).toBe(false);
  });

  // ConfigMap values get edited by hand under time pressure; a stray space
  // after a comma should not silently drop a team out of the rollout.
  it('tolerates whitespace around entries', () => {
    const service = build(' team-a , team-b ');
    expect(service.isEnabledForTeam('team-a')).toBe(true);
    expect(service.isEnabledForTeam('team-b')).toBe(true);
  });

  // Exact match only. A prefix or substring match would mean adding one
  // team could enable others whose ids merely start the same way.
  it('matches ids exactly', () => {
    const service = build('team-a');
    expect(service.isEnabledForTeam('team-ab')).toBe(false);
    expect(service.isEnabledForTeam('eam-a')).toBe(false);
  });
});
