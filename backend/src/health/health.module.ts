import { Module } from '@nestjs/common';
import { DrillsModule } from '../drills/drills.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DrillsModule],
  controllers: [HealthController],
})
export class HealthModule {}
