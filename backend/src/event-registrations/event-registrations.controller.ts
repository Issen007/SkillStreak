import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CreateEventRegistrationDto } from './dto/create-event-registration.dto';
import { EventRegistrationsService } from './event-registrations.service';

/**
 * The public demo-registration form's endpoint. Unauthenticated by
 * necessity — the whole point is that strangers can sign up.
 *
 * Abuse control is a per-IP throttle plus the DTO's honeypot, and
 * deliberately **not** a CAPTCHA. This project has none anywhere, and
 * adding the first one to a site children reach — where the CAPTCHA would
 * be the only thing standing between a nine-year-old and the page — is a
 * bad precedent to set for a form that collects a name and an email.
 */
@Controller('api/v1/event-registrations')
export class EventRegistrationsController {
  constructor(
    private readonly eventRegistrationsService: EventRegistrationsService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  register(
    @Body() dto: CreateEventRegistrationDto,
  ): Promise<{ registered: true }> {
    return this.eventRegistrationsService.register(dto);
  }
}
