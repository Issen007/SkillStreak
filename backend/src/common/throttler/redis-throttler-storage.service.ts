import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../../redis/redis.service';

// `@nestjs/throttler` doesn't re-export `ThrottlerStorageRecord` from its
// package root (only `ThrottlerStorage` itself) — this mirrors that
// interface's shape locally rather than deep-importing a `dist/` path that
// isn't part of the package's public API surface.
type ThrottlerStorageRecord = {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
};

// Fas 4 production-hardening pass, 2026-07-27 — replaces @nestjs/throttler's
// default in-memory ThrottlerStorage. That default keeps its counters in a
// plain Map on each pod's own process, so with k8s/api-deployment.yaml's
// `replicas: 2` every @Throttle()-decorated route (including POST /players,
// the unauthenticated onboarding endpoint the public website's signup
// wizard calls) actually allows roughly double its advertised per-IP
// ceiling — flagged as a required fix, not just noted, in the Fas 2.9
// security-reviewer sign-off (see docs/ACTION_PLAN.md). Backing the same
// counters with Redis (already this app's shared, cross-pod state store
// per docs/adr/0002-data-model.md) makes the limit real across the whole
// deployment, not per-pod.
//
// This app has no blockDuration configured on any @Throttle() usage, so it
// defaults to the throttler's own ttl (per @nestjs/throttler's docs) —
// meaning there's no separate "blocked" period extending past the window
// itself. That lets this implementation stay a plain fixed-window counter
// (isBlocked is just "did this increment exceed the limit"), the same
// INCR+EXPIRE-on-first-hit shape RedisService already uses for the chat-
// send/clip-upload allowances, rather than needing to model a distinct
// block-expiry window.
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const { totalHits, ttlMillisecondsRemaining } =
      await this.redisService.throttlerIncrement(
        `throttler:${throttlerName}:${key}`,
        ttl,
      );
    const isBlocked = totalHits > limit;
    const timeToExpire = Math.ceil(ttlMillisecondsRemaining / 1000);
    return {
      totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }
}
