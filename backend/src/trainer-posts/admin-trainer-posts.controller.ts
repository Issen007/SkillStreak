import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../staff-auth/guards/admin-auth.guard';
import { CurrentStaffAccountId } from '../pt/current-staff-account-id.decorator';
import { RejectTrainerPostDto } from './dto/create-trainer-post.dto';
import {
  TrainerPostAuthorView,
  TrainerPostsService,
} from './trainer-posts.service';

/**
 * The review queue — the control this whole feature rests on.
 *
 * Nothing a trainer writes reaches a child until someone here reads it
 * and says yes. There is no automated appropriateness check and this
 * deliberately does not pretend to be one; the honest description is
 * that an operator is the filter, and the row records which operator.
 *
 * `unpublish` exists because "we approved it and should not have" needs
 * a faster path than "delete it from the database".
 */
@Controller('api/v1/admin/trainer-posts')
@UseGuards(AdminAuthGuard)
export class AdminTrainerPostsController {
  constructor(private readonly trainerPostsService: TrainerPostsService) {}

  @Get('pending')
  listPending(): Promise<TrainerPostAuthorView[]> {
    return this.trainerPostsService.listPendingReview();
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentStaffAccountId() reviewerStaffAccountId: string,
    @Param('id') id: string,
  ): Promise<TrainerPostAuthorView> {
    return this.trainerPostsService.publish(reviewerStaffAccountId, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentStaffAccountId() reviewerStaffAccountId: string,
    @Param('id') id: string,
    @Body() dto: RejectTrainerPostDto,
  ): Promise<TrainerPostAuthorView> {
    return this.trainerPostsService.reject(
      reviewerStaffAccountId,
      id,
      dto.reason,
    );
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @CurrentStaffAccountId() reviewerStaffAccountId: string,
    @Param('id') id: string,
    @Body() dto: RejectTrainerPostDto,
  ): Promise<TrainerPostAuthorView> {
    return this.trainerPostsService.unpublish(
      reviewerStaffAccountId,
      id,
      dto.reason,
    );
  }
}
