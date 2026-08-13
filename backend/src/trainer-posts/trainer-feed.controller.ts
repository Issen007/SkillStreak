import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  TrainerPostPublicView,
  TrainerPostsService,
} from './trainer-posts.service';

/**
 * The feed a player reads.
 *
 * **Signed-in players only, and that is deliberate for a feed of
 * adult-authored content.** It is not public to the internet: the
 * audience is this app's users, which keeps the material inside the
 * product rather than turning it into a public page trainers optimise
 * for.
 *
 * What is NOT here, and each absence is the design:
 *
 * - **No author contact route.** A reader can see who wrote a tip and
 *   cannot reach them. A stranger publishing TO children is a different
 *   thing from a stranger corresponding WITH them.
 * - **No comments, no reactions, no reply.** Nothing a child writes goes
 *   anywhere near this feature.
 * - **No filter parameter that identifies the reader.** The same
 *   published posts go to everyone; the server learns nothing about who
 *   asked beyond the auth it already has.
 *
 * This is the only part of the owner's "scroll feed" request that ships
 * today. Children's clips crossing team boundaries is the other half,
 * and it waits on a consent decision — nothing in this controller
 * touches a clip.
 */
@Controller('api/v1/feed/trainer-posts')
@UseGuards(JwtAuthGuard)
export class TrainerFeedController {
  constructor(private readonly trainerPostsService: TrainerPostsService) {}

  @Get()
  list(@Query('limit') limit?: string): Promise<TrainerPostPublicView[]> {
    const parsed = Number(limit);
    return this.trainerPostsService.listPublished(
      Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
    );
  }
}
