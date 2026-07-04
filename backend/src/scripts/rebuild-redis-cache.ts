// Small rebuild utility, called out explicitly by docs/adr/0002-data-model.md
// ("if Redis is ever cleared, it can be repopulated from Postgres with a
// rebuild job"). Everything Redis holds is derivable from Postgres — this
// script is that derivation, run manually after a Redis flush/restart.
//
// Usage: `pnpm run redis:rebuild` (reads DATABASE_URL and REDIS_URL from
// .env, same as the seed script).
import Redis from 'ioredis';
import dataSource from '../database/data-source';
import { Player } from '../players/entities/player.entity';
import { TeamSeasonPot } from '../team-pool/entities/team-season-pot.entity';

async function run(): Promise<void> {
  await dataSource.initialize();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is not set.');
  }
  const redis = new Redis(redisUrl);

  const players = await dataSource.getRepository(Player).find();
  const pipeline = redis.pipeline();

  for (const player of players) {
    if (player.lastTrainedDate) {
      pipeline.set(
        `player:${player.id}:logged:${player.lastTrainedDate}`,
        '1',
        'EX',
        60 * 60 * 36,
      );
    }
    pipeline.zadd(
      `leaderboard:team:${player.teamId}:streak`,
      player.currentStreakCount,
      player.id,
    );
  }

  const pots = await dataSource.getRepository(TeamSeasonPot).find();
  for (const pot of pots) {
    pipeline.set(`team-pool:${pot.id}:points_total`, String(pot.pointsTotal));
  }

  await pipeline.exec();
  console.log(
    `Rebuilt Redis cache from Postgres: ${players.length} players, ${pots.length} team pools.`,
  );

  await redis.quit();
  await dataSource.destroy();
}

run().catch((error: unknown) => {
  console.error('Redis rebuild failed:', error);
  process.exitCode = 1;
});
