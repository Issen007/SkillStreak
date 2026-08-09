import {
  EvidenceTier,
  evidenceMultiplier,
  pointsForTrainingLog,
} from './points.util';

// docs/adr/0025-evidence-tiered-training-points.md.
describe('pointsForTrainingLog', () => {
  // THE regression this whole re-basing exists to prevent. Applying the
  // spec's literal 0.1 would have turned a 60-minute tap into 6 points
  // overnight, for a child doing exactly what the app has rewarded since
  // launch. Every existing log must still be worth what it was.
  it('leaves a click-only log worth exactly what it was before the tiers existed', () => {
    expect(pointsForTrainingLog(60)).toBe(60);
    expect(pointsForTrainingLog(60, EvidenceTier.CLICK_ONLY)).toBe(60);
  });

  it('defaults to click-only when no tier is given, so an un-migrated caller cannot accidentally pay more', () => {
    expect(pointsForTrainingLog(15)).toBe(
      pointsForTrainingLog(15, EvidenceTier.CLICK_ONLY),
    );
  });

  it.each([
    [EvidenceTier.CLICK_ONLY, 15],
    [EvidenceTier.SELFIE, 150],
    [EvidenceTier.VIDEO, 180],
    [EvidenceTier.VIDEO_SHARED_WITH_TEAM, 210],
  ])(
    'pays %s at the agreed multiplier for a 15-minute session',
    (tier, expected) => {
      expect(pointsForTrainingLog(15, tier)).toBe(expected);
    },
  );

  // The re-basing is only defensible if it preserved the owner's own
  // ratios exactly — the absolute scale moved, the incentive did not.
  it('preserves the specified ratios: a team-shared video is worth 14x a tap, a video 12x, a selfie 10x', () => {
    const tap = pointsForTrainingLog(30, EvidenceTier.CLICK_ONLY);
    expect(pointsForTrainingLog(30, EvidenceTier.SELFIE) / tap).toBe(10);
    expect(pointsForTrainingLog(30, EvidenceTier.VIDEO) / tap).toBe(12);
    expect(
      pointsForTrainingLog(30, EvidenceTier.VIDEO_SHARED_WITH_TEAM) / tap,
    ).toBe(14);
  });

  // Points land in TeamSeasonPot and are compared against ADR-0005's goal
  // thresholds; a fractional team point would be surprising in the UI and
  // an argument nobody needs.
  it('always yields whole points, for every tier and any duration', () => {
    for (const tier of Object.values(EvidenceTier)) {
      for (const minutes of [1, 7, 13, 59, 60, 137]) {
        expect(Number.isInteger(pointsForTrainingLog(minutes, tier))).toBe(
          true,
        );
      }
    }
  });

  // The client shows what each option is worth BEFORE the child chooses
  // (ADR-0025 Decision 1), so this has to agree with what is actually paid.
  it('exposes multipliers that match what the formula pays', () => {
    for (const tier of Object.values(EvidenceTier)) {
      expect(pointsForTrainingLog(10, tier)).toBe(
        evidenceMultiplier(tier) * 10,
      );
    }
  });

  // Reserved but not reachable — see the enum's own comment. If it ever
  // becomes reachable, that should be a deliberate change with a photo
  // pipeline behind it, not an accident.
  it('defines the selfie tier without the app being able to produce one yet', () => {
    expect(evidenceMultiplier(EvidenceTier.SELFIE)).toBe(10);
  });
});
