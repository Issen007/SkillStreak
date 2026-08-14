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
import { CreateTrainerPostDto } from './dto/create-trainer-post.dto';
import {
  TrainerPostAuthorView,
  TrainerPostsService,
} from './trainer-posts.service';

/**
 * The authoring side. Trainers only, and gated exactly like the drill
 * library — a trainer holding an active team link, or an admin.
 *
 * That gate is doing real work here: this is the route by which an adult
 * puts words in front of children, so "signed in with Google" is not
 * enough. A team invited them, which is the same bar ADR-0029 Decision 4
 * sets for reading the library.
 */
@Controller('api/v1/trainer-posts')
@UseGuards(PtAuthGuard)
export class TrainerPostsController {
  constructor(
    private readonly trainerPostsService: TrainerPostsService,
    private readonly drillAccessService: DrillAccessService,
  ) {}

  /** Submits for review. There is no route that publishes. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async create(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Body() dto: CreateTrainerPostDto,
  ): Promise<TrainerPostAuthorView> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    return this.trainerPostsService.create(staffAccountId, dto);
  }

  @Get('mine')
  async listOwn(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
  ): Promise<TrainerPostAuthorView[]> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    return this.trainerPostsService.listOwn(staffAccountId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    await this.trainerPostsService.deleteOwn(staffAccountId, id);
  }
}
