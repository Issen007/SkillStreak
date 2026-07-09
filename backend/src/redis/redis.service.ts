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

function chatSendRateLimitKey(playerId: string): string {
  return `chat-send:${playerId}:window`;
}

function chatReportCooldownKey(playerId: string): string {
  return `chat-report:${playerId}:cooldown`;
}

function chatReportNotifyCooldownKey(reportedPlayerId: string): string {
  return `chat-report-notify:${reportedPlayerId}:cooldown`;
}

// docs/api/phase2-contract.md endpoint 3: "rate-limited per player" — a
// per-IP @Throttle() (as used elsewhere in this codebase) doesn't express
// that on its own, since a captain's IP isn't the thing being limited, the
// *target player* is. A per-second-chance-of-collision cooldown lock is
// exactly the kind of fast-moving, safe-to-lose state Redis already owns
// in this app (ADR-0002) — it's a UX rate limit, not the security boundary
// (that's the captain check + the mailed token itself).
const CONSENT_REMINDER_COOLDOWN_SECONDS = 5 * 60;

// docs/api/phase2.6b-contract.md endpoint 1: "a burst allowance rather than
// a strict per-message gate... exact window backend-developer's call."
// Judgment call made here: a fixed-window counter (not a single lock) so
// normal back-and-forth conversation isn't gated to one message at a time —
// 20 messages/minute is generous for real chat while still bounding a
// flood/spam script to a small multiple of normal use.
const CHAT_SEND_RATE_LIMIT_WINDOW_SECONDS = 60;
const CHAT_SEND_RATE_LIMIT_MAX_PER_WINDOW = 20;

// docs/adr/0007-team-chat.md Decision 3: "a per-reporter cooldown... so
// mass-reporting can't be used as a harassment tool against the target in
// its own right" — same single-lock shape as the consent-reminder
// cooldown, not a burst counter (there's no legitimate reason to file many
// reports in quick succession, unlike chat messages).
const CHAT_REPORT_COOLDOWN_SECONDS = 30;

// docs/adr/0007-team-chat.md Decision 3: "at most one email per reported
// player per rolling 24 hours, aggregating multiple reports in that window
// into a single email" — deliberately the daily-cap shape the Phase 2.5
// security review asked for, not the old 5-minute-burst-only cooldown.
const CHAT_REPORT_NOTIFY_COOLDOWN_SECONDS = 60 * 60 * 24;

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

  /**
   * Fixed-window burst allowance for chat sends (docs/api/phase2.6b-
   * contract.md endpoint 1) — an atomic INCR, with EXPIRE set only on the
   * first increment of a fresh window (count === 1), so the TTL always
   * covers exactly one window from its first use rather than being reset
   * (and thus never expiring) by every subsequent message. Returns `true`
   * if this send is within the allowance (i.e. fine to proceed), `false`
   * once the window's cap is exceeded. `maxPerWindow`/`windowSeconds` are
   * parameters (not baked in) purely so tests can use a small window
   * without waiting out the real one, same reasoning as the consent-
   * reminder cooldown's `ttlSeconds` parameter.
   */
  async tryClaimChatSendAllowance(
    playerId: string,
    maxPerWindow: number = CHAT_SEND_RATE_LIMIT_MAX_PER_WINDOW,
    windowSeconds: number = CHAT_SEND_RATE_LIMIT_WINDOW_SECONDS,
  ): Promise<boolean> {
    const key = chatSendRateLimitKey(playerId);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= maxPerWindow;
  }

  /** Per-reporter send-side cooldown (docs/adr/0007-team-chat.md Decision
   * 3) — bounds mass-reporting as a harassment tool in its own right. */
  async tryClaimChatReportCooldown(
    playerId: string,
    ttlSeconds: number = CHAT_REPORT_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      chatReportCooldownKey(playerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Per-reported-player, 24h notification cooldown (docs/adr/0007-team-
   * chat.md Decision 3) — gates whether the best-effort parent/coach email
   * actually sends, never whether the report itself is persisted. */
  async tryClaimChatReportNotifyCooldown(
    reportedPlayerId: string,
    ttlSeconds: number = CHAT_REPORT_NOTIFY_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      chatReportNotifyCooldownKey(reportedPlayerId),
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
