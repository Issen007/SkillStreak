import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { AdminEventRegistrationsController } from './admin-event-registrations.controller';
import { EventRegistration } from './entities/event-registration.entity';
import { EventRegistrationsController } from './event-registrations.controller';
import { EventRegistrationsService } from './event-registrations.service';

/**
 * Demo-event registrations — a marketing list of adults, kept structurally
 * apart from everything the app knows about children (see the entity).
 *
 * Not yet built, and tracked in docs/internal/BACKLOG.md rather than
 * pretended away here: a retention sweep that deletes rows older than
 * EVENT_REGISTRATION_RETENTION_DAYS. The pattern to copy is
 * BugReportRetentionService. Until it exists, retention is a stated policy
 * enforced by hand through the admin delete endpoint, which is honest but
 * not durable.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EventRegistration]), StaffAuthModule],
  controllers: [
    EventRegistrationsController,
    AdminEventRegistrationsController,
  ],
  providers: [EventRegistrationsService],
})
export class EventRegistrationsModule {}
