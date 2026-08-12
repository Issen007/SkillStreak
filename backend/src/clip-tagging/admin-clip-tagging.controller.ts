import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../staff-auth/guards/admin-auth.guard';
import {
  ClipTaggingStats,
  ClipTaggingStatsService,
} from './clip-tagging-stats.service';

/**
 * The console's tagging panel. Admin-only, app-wide only.
 *
 * Separate controller from ClipTaggingController on purpose, even though
 * both concern tagging: that one answers to a machine on another cluster
 * holding a shared bearer token, this one answers to a signed-in admin.
 * Merging them would put two entirely different trust models behind one
 * file, and the guard is the only thing distinguishing them.
 *
 * No route here takes a team, a player, a clip or a date range, and none
 * may be added — same floor as ADR-0020 Decision 5's analytics surface.
 */
@Controller('api/v1/admin/clip-tagging')
@UseGuards(AdminAuthGuard)
export class AdminClipTaggingController {
  constructor(
    private readonly clipTaggingStatsService: ClipTaggingStatsService,
  ) {}

  @Get('stats')
  stats(): Promise<ClipTaggingStats> {
    return this.clipTaggingStatsService.collect();
  }
}
