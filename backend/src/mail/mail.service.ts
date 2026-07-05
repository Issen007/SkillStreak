import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Wraps SMTP sending (Google Workspace relay by default — see
// ../../.env.example) for the parental-consent request email
// (docs/adr/0002-data-model.md addendum §2). Deliberately degrades to a
// clearly-logged no-op when SMTP_HOST isn't set, rather than failing app
// boot — see env.validation.ts's comment — since this is being configured
// incrementally.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    this.from =
      this.configService.get<string>('SMTP_FROM') ??
      'SkillStreak <noreply@example.com>';

    if (!host) {
      this.logger.warn(
        'SMTP_HOST not set — mail sending is a no-op. Set SMTP_HOST/PORT/USER/PASSWORD in .env to enable it.',
      );
      this.transporter = null;
      return;
    }

    this.transporter = createTransport({
      host,
      port: Number(this.configService.get<string>('SMTP_PORT') ?? '587'),
      // Port 587 is STARTTLS (secure: false, then upgraded), not implicit
      // TLS (that would be port 465 with secure: true) — matches Google
      // Workspace's relay documentation for this port.
      secure: false,
      auth: this.configService.get<string>('SMTP_USER')
        ? {
            user: this.configService.get<string>('SMTP_USER'),
            pass: this.configService.get<string>('SMTP_PASSWORD'),
          }
        : undefined,
    });
  }

  /** Connects and authenticates without sending anything — the "Authorize
   * test" step: confirms host/port/credentials are correct before anyone
   * trusts this to deliver a real consent email. */
  async verifyConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.transporter) {
      return {
        ok: false,
        message: 'SMTP_HOST not set — nothing to verify.',
      };
    }
    try {
      await this.transporter.verify();
      return { ok: true, message: 'SMTP connection and auth succeeded.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SMTP verify failed: ${message}`);
      return { ok: false, message };
    }
  }

  async sendMail(options: SendMailOptions): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(
        `Mail not sent (SMTP not configured): to=${options.to} subject="${options.subject}"`,
      );
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }
}
