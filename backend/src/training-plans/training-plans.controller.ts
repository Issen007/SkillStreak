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
import { Throttle } from '@nestjs/throttler';
import { CurrentStaffAccountId } from '../pt/current-staff-account-id.decorator';
import { CurrentStaffRole } from '../pt/current-staff-role.decorator';
import { StaffAccountRole } from '../staff-auth/entities/staff-account.entity';
import { PtAuthGuard } from '../staff-auth/guards/pt-auth.guard';
import { DrillAccessService } from '../drills/drill-access.service';
import { CreateTrainerPostDto } from '../trainer-posts/dto/create-trainer-post.dto';
import {
  TrainerPostsService,
  type TrainerPostAuthorView,
} from '../trainer-posts/trainer-posts.service';
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
    // ADR-0035 Decision 1: reuse `trainer_post`'s review pipeline rather
    // than growing a second one here. This module knows how to hand its
    // output off; it does not know how content reaches children, and
    // should not learn.
    private readonly trainerPostsService: TrainerPostsService,
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

  /**
   * ADR-0035 — hand a finished draft to the review queue as a trainer
   * post.
   *
   * **The body carries the text, and that is the decision, not an
   * oversight.** The trainer submits what they are willing to put their
   * name to, having read and edited it — the draft is not copied
   * server-side. A route that forwarded model output untouched would
   * make "the trainer is the author and is accountable" (Decision 2) a
   * formality, and accountability for words nobody read is not
   * accountability.
   *
   * The draft id is a path parameter and is used for exactly one thing:
   * establishing, server-side, that this text came from a model. The
   * client cannot set that flag and cannot clear it — a caller who could
   * would be able to present machine-drafted text to a reviewer as
   * hand-written, which is the one lie this column exists to prevent.
   *
   * 202, matching the plain create route: the post exists but nobody can
   * read it yet. Publication is an operator action and there is still no
   * route by which an author publishes their own post.
   */
  @Post(':id/submit-as-post')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async submitAsPost(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Param('id') id: string,
    @Body() dto: CreateTrainerPostDto,
  ): Promise<TrainerPostAuthorView> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    const draft = await this.trainingPlansService.findSubmittableOwned(
      staffAccountId,
      id,
    );
    return this.trainerPostsService.create(staffAccountId, dto, draft.id);
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
