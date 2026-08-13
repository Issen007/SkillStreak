import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentStaffAccountId } from '../pt/current-staff-account-id.decorator';
import { CurrentStaffRole } from '../pt/current-staff-role.decorator';
import { StaffAccountRole } from '../staff-auth/entities/staff-account.entity';
import { PtAuthGuard } from '../staff-auth/guards/pt-auth.guard';
import { DrillAccessService } from '../drills/drill-access.service';
import { RequestTrainingPlanDto } from './dto/request-training-plan.dto';
import {
  TrainingPlansService,
  TrainingPlanView,
} from './training-plans.service';

/**
 * The coach-facing side (ADR-0028 Decision 5).
 *
 * **The consumer is a staff account, never a child**, and there is no
 * child-facing prompt box anywhere in this app. Gated exactly like the
 * drill library — a trainer holding an active team link, or an admin —
 * because it generates sessions FROM that library and the same "a
 * signed-in account proves nothing" reasoning applies.
 *
 * Every route is scoped to the caller's own account. There is no route
 * that names another staff account, and no listing across accounts.
 */
@Controller('api/v1/training-plans')
@UseGuards(PtAuthGuard)
export class TrainingPlansController {
  constructor(
    private readonly trainingPlansService: TrainingPlansService,
    private readonly drillAccessService: DrillAccessService,
  ) {}

  /**
   * 202, not 201: the plan does not exist yet. The GPU cluster has no
   * inbound route, so generation is a job the worker leases — the coach
   * gets an id to poll. Roughly 10-30s on an A2.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async request(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Body() dto: RequestTrainingPlanDto,
  ): Promise<TrainingPlanView> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    return this.trainingPlansService.request(staffAccountId, dto);
  }

  @Get()
  async list(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
  ): Promise<TrainingPlanView[]> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    return this.trainingPlansService.listForStaff(staffAccountId);
  }

  /**
   * Delete one of your own sessions.
   *
   * Exists because of ADR-0028 Decision 7(c): a coach who realises they
   * typed a player's name into a prompt had, until now, no way to remove
   * it — and erasure cannot find it either, since this table has no
   * `player_id` to search on. Without this the only remedy was waiting
   * out a 365-day sweep.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    await this.trainingPlansService.deleteOwned(staffAccountId, id);
  }

  @Get(':id')
  async findOne(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Param('id') id: string,
  ): Promise<TrainingPlanView> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    return this.trainingPlansService.findOwned(staffAccountId, id);
  }
}
