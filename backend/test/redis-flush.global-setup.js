// Jest globalSetup, runs once before any e2e test file. Needed since
// backend/src/common/throttler/redis-throttler-storage.service.ts (Fas 4
// production hardening, 2026-07-27) made @nestjs/throttler's counters
// Redis-backed instead of per-process in-memory — every e2e spec file
// used to get a fresh in-memory throttle bucket for free just by creating
// its own Nest app instance, but now every file's supertest requests share
// one real Redis instance, keyed by the same client IP (127.0.0.1), so
// without a flush the POST /players 10/min/IP throttle (and any other
// Redis-backed rate limit) accumulates across the *entire* e2e run instead
// of resetting per file. Plain .js (not .ts) since Jest's globalSetup runs
// outside the ts-jest transform pipeline.
require('dotenv').config();
const Redis = require('ioredis');

module.exports = async () => {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = new Redis(url, { lazyConnect: false });
  await client.flushdb();
  await client.quit();
};
