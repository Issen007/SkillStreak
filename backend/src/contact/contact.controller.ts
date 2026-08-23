import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ContactService } from './contact.service';
import { SubmitContactEnquiryDto } from './dto/submit-contact-enquiry.dto';

/**
 * The sponsorship contact form on the marketing site.
 *
 * Unauthenticated by necessity — the whole point is that a company nobody
 * has met can get in touch. What bounds it:
 *
 * - A tight throttle. Three a minute is far above what a real person
 *   sends and far below what makes a relay useful to a spammer. Genuinely
 *   per-IP: `main.ts` sets `trust proxy` from TRUSTED_PROXY_HOPS.
 * - A honeypot field, not a CAPTCHA — this project ships no CAPTCHA
 *   anywhere and should not start on a site children can reach.
 * - A fixed recipient from config. The sender cannot choose who this goes
 *   to, which is what stops the endpoint being an open relay: the only
 *   attacker-controlled content is a body delivered to one address the
 *   operator chose.
 *
 * Answers 200 with whether the message was actually handed to SMTP, not
 * 204. The page needs the difference: telling someone "thanks, we'll be
 * in touch" about a message that was never sent is worse than telling
 * them to email directly.
 */
@Controller('api/v1/contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.OK)
  async submit(
    @Body() dto: SubmitContactEnquiryDto,
  ): Promise<{ delivered: boolean }> {
    return this.contactService.submit(dto);
  }
}
