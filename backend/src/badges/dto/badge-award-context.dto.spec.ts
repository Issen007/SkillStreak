import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { BadgeTriggerReason } from '../badge-trigger-reason.enum';
import {
  BADGE_AWARD_CONTEXT_CLASS_BY_REASON,
  ChallengeCompletedContext,
  CoachManualAwardContext,
  EffortNominationContext,
  StreakMilestoneContext,
  TeamPoolMilestoneContext,
} from './badge-award-context.dto';

// Mirrors the "intended usage" described in badge-award-context.dto.ts's
// class-level comment: pick the concrete class via triggerReason, then
// validate with whitelist/forbidNonWhitelisted so any key not in that
// variant's fixed shape is rejected — this is what actually enforces
// docs/adr/0002-data-model.md addendum §3's "no location/PII backdoor"
// guarantee, not just the enum check.
async function validateAsContext(
  triggerReason: string,
  plain: Record<string, unknown>,
): Promise<ValidationError[]> {
  const ContextClass =
    BADGE_AWARD_CONTEXT_CLASS_BY_REASON[triggerReason as BadgeTriggerReason];
  if (!ContextClass) {
    throw new Error(`No context class registered for "${triggerReason}"`);
  }
  const instance = plainToInstance(ContextClass, plain);
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

function omit<T extends Record<string, unknown>>(
  obj: T,
  key: keyof T,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  delete copy[key as string];
  return copy;
}

describe('BadgeAwardContext DTOs', () => {
  describe('BADGE_AWARD_CONTEXT_CLASS_BY_REASON', () => {
    it('has no entry for an unrecognized triggerReason (boundary rejects before validation)', () => {
      expect(
        BADGE_AWARD_CONTEXT_CLASS_BY_REASON[
          'not_a_real_reason' as BadgeTriggerReason
        ],
      ).toBeUndefined();
    });
  });

  describe('StreakMilestoneContext', () => {
    const valid = {
      triggerReason: BadgeTriggerReason.STREAK_MILESTONE,
      streakCount: 7,
    };

    it('validates with its required fields', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.STREAK_MILESTONE,
        valid,
      );
      expect(errors).toHaveLength(0);
    });

    it('rejects a mismatched triggerReason', async () => {
      const instance = plainToInstance(StreakMilestoneContext, {
        ...valid,
        triggerReason: BadgeTriggerReason.CHALLENGE_COMPLETED,
      });
      const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.some((e) => e.property === 'triggerReason')).toBe(true);
    });

    it('rejects a missing triggerReason', async () => {
      const rest = omit(valid, 'triggerReason');
      const instance = plainToInstance(StreakMilestoneContext, rest);
      const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.some((e) => e.property === 'triggerReason')).toBe(true);
    });

    it('rejects a missing streakCount', async () => {
      const rest = omit(valid, 'streakCount');
      const errors = await validateAsContext(
        BadgeTriggerReason.STREAK_MILESTONE,
        rest,
      );
      expect(errors.some((e) => e.property === 'streakCount')).toBe(true);
    });

    it('rejects an extra/unknown field (e.g. an attempted location backdoor)', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.STREAK_MILESTONE,
        {
          ...valid,
          location: 'Some Arena',
        },
      );
      expect(errors.some((e) => e.property === 'location')).toBe(true);
    });
  });

  describe('ChallengeCompletedContext', () => {
    const valid = {
      triggerReason: BadgeTriggerReason.CHALLENGE_COMPLETED,
      challengeId: '11111111-1111-4111-8111-111111111111',
    };

    it('validates with its required fields', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.CHALLENGE_COMPLETED,
        valid,
      );
      expect(errors).toHaveLength(0);
    });

    it('rejects a non-UUID challengeId', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.CHALLENGE_COMPLETED,
        {
          ...valid,
          challengeId: 'not-a-uuid',
        },
      );
      expect(errors.some((e) => e.property === 'challengeId')).toBe(true);
    });

    it('rejects a mismatched triggerReason', async () => {
      const instance = plainToInstance(ChallengeCompletedContext, {
        ...valid,
        triggerReason: BadgeTriggerReason.STREAK_MILESTONE,
      });
      const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.some((e) => e.property === 'triggerReason')).toBe(true);
    });

    it('rejects an extra/unknown field', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.CHALLENGE_COMPLETED,
        {
          ...valid,
          coordinates: { lat: 1, lng: 2 },
        },
      );
      expect(errors.some((e) => e.property === 'coordinates')).toBe(true);
    });
  });

  describe('TeamPoolMilestoneContext', () => {
    const valid = {
      triggerReason: BadgeTriggerReason.TEAM_POOL_MILESTONE,
      teamSeasonPotId: '22222222-2222-4222-8222-222222222222',
      percentComplete: 50,
    };

    it('validates with its required fields', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.TEAM_POOL_MILESTONE,
        valid,
      );
      expect(errors).toHaveLength(0);
    });

    it('rejects a missing percentComplete', async () => {
      const rest = omit(valid, 'percentComplete');
      const errors = await validateAsContext(
        BadgeTriggerReason.TEAM_POOL_MILESTONE,
        rest,
      );
      expect(errors.some((e) => e.property === 'percentComplete')).toBe(true);
    });

    it('rejects a negative percentComplete', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.TEAM_POOL_MILESTONE,
        {
          ...valid,
          percentComplete: -5,
        },
      );
      expect(errors.some((e) => e.property === 'percentComplete')).toBe(true);
    });

    it('rejects a mismatched triggerReason', async () => {
      const instance = plainToInstance(TeamPoolMilestoneContext, {
        ...valid,
        triggerReason: BadgeTriggerReason.EFFORT_NOMINATION,
      });
      const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.some((e) => e.property === 'triggerReason')).toBe(true);
    });

    it('rejects an extra/unknown field', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.TEAM_POOL_MILESTONE,
        {
          ...valid,
          venue: 'Home rink',
        },
      );
      expect(errors.some((e) => e.property === 'venue')).toBe(true);
    });
  });

  describe('CoachManualAwardContext', () => {
    const valid = {
      triggerReason: BadgeTriggerReason.COACH_MANUAL_AWARD,
    };

    it('validates with only the required triggerReason (note is optional)', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.COACH_MANUAL_AWARD,
        valid,
      );
      expect(errors).toHaveLength(0);
    });

    it('validates with an in-range note', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.COACH_MANUAL_AWARD,
        {
          ...valid,
          note: 'Great hustle at practice today!',
        },
      );
      expect(errors).toHaveLength(0);
    });

    it('rejects a note over 140 characters', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.COACH_MANUAL_AWARD,
        {
          ...valid,
          note: 'x'.repeat(141),
        },
      );
      expect(errors.some((e) => e.property === 'note')).toBe(true);
    });

    it('rejects a mismatched triggerReason', async () => {
      const instance = plainToInstance(CoachManualAwardContext, {
        ...valid,
        triggerReason: BadgeTriggerReason.STREAK_MILESTONE,
      });
      const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.some((e) => e.property === 'triggerReason')).toBe(true);
    });

    it('rejects an extra/unknown field (e.g. a smuggled location)', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.COACH_MANUAL_AWARD,
        {
          ...valid,
          location: 'IBK Falken home arena',
        },
      );
      expect(errors.some((e) => e.property === 'location')).toBe(true);
    });
  });

  describe('EffortNominationContext', () => {
    const valid = {
      triggerReason: BadgeTriggerReason.EFFORT_NOMINATION,
    };

    it('validates with only the required triggerReason (note is optional)', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.EFFORT_NOMINATION,
        valid,
      );
      expect(errors).toHaveLength(0);
    });

    it('rejects a note over 140 characters', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.EFFORT_NOMINATION,
        {
          ...valid,
          note: 'x'.repeat(141),
        },
      );
      expect(errors.some((e) => e.property === 'note')).toBe(true);
    });

    it('rejects a mismatched triggerReason', async () => {
      const instance = plainToInstance(EffortNominationContext, {
        ...valid,
        triggerReason: BadgeTriggerReason.COACH_MANUAL_AWARD,
      });
      const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.some((e) => e.property === 'triggerReason')).toBe(true);
    });

    it('rejects an extra/unknown field', async () => {
      const errors = await validateAsContext(
        BadgeTriggerReason.EFFORT_NOMINATION,
        {
          ...valid,
          address: '123 Main St',
        },
      );
      expect(errors.some((e) => e.property === 'address')).toBe(true);
    });
  });
});
