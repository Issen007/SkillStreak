import {
  EvidenceTier,
  evidenceMultiplier,
  pointsForTrainingLog,
} from './points.util';

// docs/adr/0025-evidence-tiered-training-points.md.
describe('pointsForTrainingLog', () => {
  // The owner's own worked example, 2026-08-10, asserted directly: a
  // 3x20-minute week logged as one public share, one photo and one bare
  // report. Public is tier 5 and not built yet, so its 40 is computed from
  // the same multiplier table rather than through the enum.
  it("matches the owner's worked example: 40 + 20 + 2 = 62 for a 3x20 week", () => {
    const publicShare = Math.max(1, Math.round(20 * 2));
    const photo = pointsForTrainingLog(20, EvidenceTier.SELFIE);
    const bareReport = pointsForTrainingLog(20, EvidenceTier.CLICK_ONLY);

    expect(publicShare).toBe(40);
    expect(photo).toBe(20);
    expect(bareReport).toBe(2);
    expect(publicShare + photo + bareReport).toBe(62);
  });

  // The accepted cost of the literal multipliers: an unproven session is
  // now worth a tenth of what it was. Pinned so the devaluation is a
  // deliberate, visible property rather than something rediscovered later.
  it('pays an unproven 60-minute session 6 points, a tenth of its former value', () => {
    expect(pointsForTrainingLog(60)).toBe(6);
    expect(pointsForTrainingLog(60, EvidenceTier.CLICK_ONLY)).toBe(6);
  });

  it('defaults to click-only when no tier is given, so an un-migrated caller cannot accidentally pay more', () => {
    expect(pointsForTrainingLog(15)).toBe(
      pointsForTrainingLog(15, EvidenceTier.CLICK_ONLY),
    );
  });

  it.each([
    // 15 x 0.1 = 1.5, which rounds to 2 — the case that made a rounding
    // rule necessary at all.
    [EvidenceTier.CLICK_ONLY, 2],
    [EvidenceTier.SELFIE, 15],
    [EvidenceTier.VIDEO, 18],
    [EvidenceTier.VIDEO_SHARED_WITH_TEAM, 21],
  ])(
    'pays %s at the agreed multiplier for a 15-minute session',
    (tier, expected) => {
      expect(pointsForTrainingLog(15, tier)).toBe(expected);
    },
  );

  it('keeps every tier strictly better than the one below it', () => {
    const minutes = 30;
    const ladder = [
      EvidenceTier.CLICK_ONLY,
      EvidenceTier.SELFIE,
      EvidenceTier.VIDEO,
      EvidenceTier.VIDEO_SHARED_WITH_TEAM,
    ].map((tier) => pointsForTrainingLog(minutes, tier));

    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    }
  });

  // The floor is the point of the rounding rule: a child who trained must
  // never be told they earned nothing.
  it('never pays zero for a session that happened, however short and unproven', () => {
    for (const minutes of [1, 2, 5, 9]) {
      expect(pointsForTrainingLog(minutes)).toBeGreaterThanOrEqual(1);
    }
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
  it('exposes multipliers the client can reproduce exactly, rounding included', () => {
    for (const tier of Object.values(EvidenceTier)) {
      for (const minutes of [10, 15, 20, 30]) {
        expect(pointsForTrainingLog(minutes, tier)).toBe(
          Math.max(1, Math.round(minutes * evidenceMultiplier(tier))),
        );
      }
    }
  });

  // Reserved but not reachable — see the enum's own comment. If it ever
  // becomes reachable, that should be a deliberate change with a photo
  // pipeline behind it, not an accident.
  it('defines the selfie tier without the app being able to produce one yet', () => {
    expect(evidenceMultiplier(EvidenceTier.SELFIE)).toBe(1);
  });
});
