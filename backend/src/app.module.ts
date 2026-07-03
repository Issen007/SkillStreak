import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

// Phase 0 scaffold: only the health module exists so far. Domain modules
// (players, teams, streaks, team pool, etc.) land in Phase 1 per
// docs/adr/0002-data-model.md.
@Module({
  imports: [HealthModule],
})
export class AppModule {}
