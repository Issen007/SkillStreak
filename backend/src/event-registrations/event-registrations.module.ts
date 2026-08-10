import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ErrorLogModule } from '../error-log/error-log.module';
import { RedisModule } from '../redis/redis.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { AdminEventRegistrationsController } from './admin-event-registrations.controller';
import { EventRegistrationRetentionService } from './event-registration-retention.service';
import { EventRegistration } from './entities/event-registration.entity';
import { EventRegistrationsController } from './event-registrations.controller';
import { EventRegistrationsService } from './event-registrations.service';

/**
 * Demo-event registrations — a marketing list of adults, kept structurally
 * apart from everything the app knows about children (see the entity).
 *
 * Retention is enforced, not merely stated: EventRegistrationRetentionService
 * deletes rows past DEFAULT_EVENT_REGISTRATION_RETENTION_DAYS on a daily
 * cron. The admin delete endpoint handles the other direction — a person
 * asking to be removed early.
 *
 * `RedisModule` for the sweep's cross-pod run-lock; `ErrorLogModule` so a
 * failed sweep records a row the admin console can show, rather than
 * disappearing into a rejected promise.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EventRegistration]),
    StaffAuthModule,
    RedisModule,
    ErrorLogModule,
  ],
  controllers: [
    EventRegistrationsController,
    AdminEventRegistrationsController,
  ],
  providers: [EventRegistrationsService, EventRegistrationRetentionService],
})
export class EventRegistrationsModule {}
