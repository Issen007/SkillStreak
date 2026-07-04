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

  async quit(): Promise<void> {
    await this.client.quit();
  }
}
