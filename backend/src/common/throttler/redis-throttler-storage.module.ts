import { Module } from '@nestjs/common';
import { RedisModule } from '../../redis/redis.module';
import { RedisThrottlerStorage } from './redis-throttler-storage.service';

// Separate module (not just exporting RedisThrottlerStorage from
// RedisModule directly) purely so AppModule's ThrottlerModule.forRootAsync
// can `inject: [RedisThrottlerStorage]` from its own `imports` array —
// Nest resolves forRootAsync's inject targets from the DynamicModule's own
// imports, not from whatever else AppModule happens to import elsewhere.
@Module({
  imports: [RedisModule],
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class RedisThrottlerStorageModule {}
