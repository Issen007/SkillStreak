import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../staff-auth/guards/admin-auth.guard';
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
