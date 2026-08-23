import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { renderContactEnquiryEmail } from '../mail/templates/contact-enquiry-email.template';
import { SubmitContactEnquiryDto } from './dto/submit-contact-enquiry.dto';

/**
 * Forwards a sponsorship enquiry, and stores nothing.
 *
 * **The absence of a table is the design.** Every other way of building
 * this would have created a new table of adults' names and addresses,
 * which then needs a lawful basis, a retention period, an erasure path
 * and somewhere in the admin console to read it — a real amount of
 * machinery around a form that is expected to receive a handful of
 * messages. Mail is already the delivery mechanism and an inbox is
 * already a durable store with a human curating it.
 *
 * The cost is honest and worth naming: if the mail fails, the enquiry is
 * gone. That is why `submit` reports the handoff result rather than
 * swallowing it, so the page can tell the sender to write directly
 * instead of thanking them for a message nobody received.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * `@IsOptional()` alone in env.validation.ts, so this arrives as `''`
   * rather than undefined when the ConfigMap key exists but is blank —
   * the trap this project has now met seven times. `trim()` and the
   * emptiness check are what make both spellings of "unset" behave the
   * same.
   */
  recipient(): string | null {
    const configured = this.configService
      .get<string>('CONTACT_RECIPIENT_EMAIL')
      ?.trim();
    return configured ? configured : null;
  }

  isConfigured(): boolean {
    return this.recipient() !== null;
  }

  async submit(dto: SubmitContactEnquiryDto): Promise<{ delivered: boolean }> {
    const to = this.recipient();
    if (!to) {
      // Deliberately loud. An unconfigured contact form that answers 200
      // is the exact failure this project keeps paying for: it looks
      // fine from the page and the message is simply gone.
      this.logger.warn(
        'Contact enquiry received but CONTACT_RECIPIENT_EMAIL is unset — not delivered.',
      );
      return { delivered: false };
    }

    // The honeypot. Answering as though it worked is the point: a bot
    // that gets a 400 learns the field is a trap, and a bot that gets a
    // cheerful 200 does not. Logged at debug rather than warn — this is
    // expected background noise on any public form, not an incident.
    if (dto.website && dto.website.length > 0) {
      this.logger.debug('Contact enquiry dropped: honeypot field was filled.');
      return { delivered: true };
    }

    const rendered = renderContactEnquiryEmail({
      name: dto.name,
      email: dto.email,
      organisation: dto.organisation,
      message: dto.message,
    });

    const result = await this.mailService.sendMail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    return { delivered: result.handedOff };
  }
}
