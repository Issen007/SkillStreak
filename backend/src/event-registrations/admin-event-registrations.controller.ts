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
import { AdminAuthGuard } from '../staff-auth/guards/admin-auth.guard';
import { MarkInvitedDto } from './dto/mark-invited.dto';
import { SendDemoInvitesDto } from './dto/send-demo-invites.dto';
import {
  EventRegistrationRow,
  EventRegistrationsService,
} from './event-registrations.service';

/**
 * The admin console's view of who signed up for a demo.
 *
 * Admin-only, not PT-visible: a trainer has no business reading a
 * marketing list, and the separation this table exists to maintain (see
 * the entity docstring) is enforced by there being no other route to it.
 */
@Controller('api/v1/admin/event-registrations')
@UseGuards(AdminAuthGuard)
export class AdminEventRegistrationsController {
  constructor(
    private readonly eventRegistrationsService: EventRegistrationsService,
  ) {}

  @Get()
  list(): Promise<EventRegistrationRow[]> {
    return this.eventRegistrationsService.list();
  }

  /**
   * Records that these people have been invited, so the send list shrinks.
   *
   * Exists because the first round of invitations is mailed by hand from
   * the exported CSV. Without it the list would show everyone again on the
   * next round and the whole list would be mailed twice — the fastest way
   * to teach recipients to mark us as spam, which damages the sending
   * domain the parental-consent email depends on.
   */
  @Post('mark-invited')
  @HttpCode(HttpStatus.OK)
  markInvited(@Body() dto: MarkInvitedDto): Promise<{ marked: number }> {
    return this.eventRegistrationsService.markInvited(dto.ids);
  }

  /**
   * Mails the invitation to everyone who has not had one.
   *
   * Slow by nature — one SMTP send per recipient, sequentially — so this
   * answers when the batch is done rather than streaming progress. A demo
   * list is tens of addresses, so that is a wait of seconds, not a job
   * queue's worth of complexity.
   */
  @Post('send-invites')
  @HttpCode(HttpStatus.OK)
  sendInvites(
    @Body() dto: SendDemoInvitesDto,
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    return this.eventRegistrationsService.sendInvites(dto);
  }

  /**
   * No step-up guard here, unlike the planning-docs routes. Those hold the
   * project's own unpublished roadmap; this holds names and email addresses
   * that their owners typed into a public form, and the delete is how an
   * erasure request gets honoured. Making removal the most friction-heavy
   * action on the list would be the wrong incentive.
   */
  @Delete(':id')
  remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.eventRegistrationsService.remove(id);
  }
}
