import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  BugReportsService,
  CreateBugReportResult,
} from './bug-reports.service';
import { CreateBugReportDto } from './dto/create-bug-report.dto';

/**
 * docs/adr/0022-admin-control-center.md Decision 7 — "an ordinary
 * authenticated player action, reusing `CurrentPlayerId` exactly like every
 * other player-scoped write in this app. No new auth mechanism."
 *
 * **`JwtAuthGuard` only, and deliberately no consent gate** — see
 * BugReportsService's class docstring and
 * docs/design/phase7-admin-console-flows.md §9.1 for the full argument. A
 * pending-consent child is the person most likely to need this.
 *
 * The admin side of this feature lives in `admin/` behind `AdminAuthGuard`
 * and shares no route prefix, no guard, and no DTO with this controller.
 */
@Controller('api/v1/bug-reports')
export class BugReportsController {
  constructor(private readonly bugReportsService: BugReportsService) {}

  // 201, not 200 — this creates a new BugReport row, same resource-creation
  // posture as POST /players/me/erasure/request.
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  submit(
    @CurrentPlayerId() playerId: string,
    @Body() dto: CreateBugReportDto,
  ): Promise<CreateBugReportResult> {
    // `playerId` comes from the session, never from the body — the DTO has
    // no field for it at all (see CreateBugReportDto).
    return this.bugReportsService.submit(playerId, dto);
  }
}
