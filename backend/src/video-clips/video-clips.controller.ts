import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { ListClipsQueryDto } from './dto/list-clips-query.dto';
import { ReportClipDto } from './dto/report-clip.dto';
import {
  ClipFeedItem,
  CompleteUploadResponse,
  CreateUploadUrlResponse,
  DeleteClipResponse,
  ReportClipResponse,
  VideoClipsService,
} from './video-clips.service';

// docs/api/phase3-contract.md's five endpoints, verbatim. Every method
// delegates its own team-membership/consent/rate-limit checks to
// VideoClipsService, same pattern as every other team-scoped controller in
// this app.
@Controller('api/v1/teams/:teamId/clips')
export class VideoClipsController {
  constructor(private readonly videoClipsService: VideoClipsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload-url')
  @HttpCode(HttpStatus.CREATED)
  async createUploadUrl(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
    @Body() dto: CreateUploadUrlDto,
  ): Promise<CreateUploadUrlResponse> {
    return this.videoClipsService.createUploadUrl(teamId, playerId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':clipId/complete')
  @HttpCode(HttpStatus.OK)
  async completeUpload(
    @Param('teamId') teamId: string,
    @Param('clipId') clipId: string,
    @CurrentPlayerId() playerId: string,
  ): Promise<CompleteUploadResponse> {
    return this.videoClipsService.completeUpload(teamId, playerId, clipId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async listClips(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
    @Query() query: ListClipsQueryDto,
  ): Promise<{ clips: ClipFeedItem[] }> {
    const clips = await this.videoClipsService.listClips(
      teamId,
      playerId,
      query.before,
      query.limit,
    );
    return { clips };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':clipId')
  @HttpCode(HttpStatus.OK)
  async deleteClip(
    @Param('teamId') teamId: string,
    @Param('clipId') clipId: string,
    @CurrentPlayerId() playerId: string,
  ): Promise<DeleteClipResponse> {
    return this.videoClipsService.deleteClip(teamId, playerId, clipId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':clipId/report')
  @HttpCode(HttpStatus.CREATED)
  async reportClip(
    @Param('teamId') teamId: string,
    @Param('clipId') clipId: string,
    @CurrentPlayerId() playerId: string,
    @Body() dto: ReportClipDto,
  ): Promise<ReportClipResponse> {
    return this.videoClipsService.reportClip(teamId, playerId, clipId, dto);
  }
}
