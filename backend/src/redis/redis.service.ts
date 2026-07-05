import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

// Everything here is a cache/accelerator over Postgres, per
// docs/adr/0002-data-model.md — safe to lose, rebuildable (see
// src/scripts/rebuild-redis-cache.ts), never the only copy of anything.
// Written *after* the Postgres transaction commits (see
// TrainingLogsService), never instead of it.
const DAY_KEY_TTL_SECONDS = 60 * 60 * 36; // a little over a day, covers the boundary

function loggedTodayKey(playerId: string, dateString: string): string {
  return `player:${playerId}:logged:${dateString}`;
}

function teamPoolGaugeKey(teamSeasonPotId: string): string {
  return `team-pool:${teamSeasonPotId}:points_total`;
}

function teamStreakLeaderboardKey(teamId: string): string {
  return `leaderboard:team:${teamId}:streak`;
}

function consentReminderCooldownKey(playerId: string): string {
  return `consent-reminder:${playerId}:cooldown`;
}

// docs/api/phase2-contract.md endpoint 3: "rate-limited per player" — a
// per-IP @Throttle() (as used elsewhere in this codebase) doesn't express
// that on its own, since a captain's IP isn't the thing being limited, the
// *target player* is. A per-second-chance-of-collision cooldown lock is
// exactly the kind of fast-moving, safe-to-lose state Redis already owns
// in this app (ADR-0002) — it's a UX rate limit, not the security boundary
// (that's the captain check + the mailed token itself).
const CONSENT_REMINDER_COOLDOWN_SECONDS = 5 * 60;

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** Fast "did they already log today" marker for the hot path. */
  async markLoggedToday(playerId: string, dateString: string): Promise<void> {
    await this.client.set(
      loggedTodayKey(playerId, dateString),
      '1',
      'EX',
      DAY_KEY_TTL_SECONDS,
    );
  }

  async hasLoggedToday(playerId: string, dateString: string): Promise<boolean> {
    const value = await this.client.get(loggedTodayKey(playerId, dateString));
    return value === '1';
  }

  /** Live gauge cache of TeamSeasonPot.points_total for instant meter reads. */
  async setTeamPoolGauge(
    teamSeasonPotId: string,
    pointsTotal: number,
  ): Promise<void> {
    await this.client.set(
      teamPoolGaugeKey(teamSeasonPotId),
      String(pointsTotal),
    );
  }

  async getTeamPoolGauge(teamSeasonPotId: string): Promise<number | null> {
    const value = await this.client.get(teamPoolGaugeKey(teamSeasonPotId));
    return value === null ? null : Number(value);
  }

  /**
   * Per-team individual streak leaderboard (sorted set), keyed by team so a
   * query is always naturally team-scoped, per ADR-0002. Uses ZADD (an
   * absolute score set), not ZINCRBY, because currentStreakCount is already
   * the absolute value we want reflected, not a delta.
   */
  async updateLeaderboard(
    teamId: string,
    playerId: string,
    currentStreakCount: number,
  ): Promise<void> {
    await this.client.zadd(
      teamStreakLeaderboardKey(teamId),
      currentStreakCount,
      playerId,
    );
  }

  async getLeaderboard(
    teamId: string,
    limit = 10,
  ): Promise<Array<{ playerId: string; streakCount: number }>> {
    const raw = await this.client.zrevrange(
      teamStreakLeaderboardKey(teamId),
      0,
      limit - 1,
      'WITHSCORES',
    );
    const result: Array<{ playerId: string; streakCount: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ playerId: raw[i], streakCount: Number(raw[i + 1]) });
    }
    return result;
  }

  /**
   * Atomically claims the per-player consent-reminder cooldown lock (a
   * `SET ... NX EX` — set-if-not-exists with a TTL). Returns `true` if this
   * call claimed the lock (i.e. it's fine to send), `false` if another
   * reminder was already sent within the cooldown window. `ttlSeconds` is
   * a parameter (not baked into the key helper) purely so tests can use a
   * short window without waiting out the real 5-minute default.
   */
  async tryClaimConsentReminderCooldown(
    playerId: string,
    ttlSeconds: number = CONSENT_REMINDER_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      consentReminderCooldownKey(playerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }
}
