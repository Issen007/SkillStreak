import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Optional file attachments. Added 2026-08-10 for the demo invitation's
   * calendar (.ics) file — every other mail this app sends is text and
   * links only, and should stay that way.
   */
  attachments?: MailAttachment[];
  /**
   * Overrides the `Message-ID` nodemailer would otherwise generate.
   *
   * Set by the public-sharing reminder so a DSN arriving days later can
   * be traced back to the consent it was for (ADR-0030 finding 4). Most
   * MTAs return the original `Message-ID` with a bounce even when they
   * strip `X-` headers, which is why the correlation token is minted into
   * it as well as into the header below.
   */
  messageId?: string;
  /**
   * Extra headers to stamp on the outgoing message.
   *
   * Deliberately not a general-purpose escape hatch: the only current
   * caller sets `X-SkillStreak-Consent`. Values reach nodemailer
   * verbatim, so a caller must never put user-supplied text here — a
   * newline in a header value is header injection.
   */
  headers?: Record<string, string>;
}

// Wraps SMTP sending (Google Workspace relay by default — see
// ../../.env.example) for the parental-consent request email
// (docs/adr/0002-data-model.md addendum §2). Deliberately degrades to a
// clearly-logged no-op when SMTP_HOST isn't set, rather than failing app
// boot — see env.validation.ts's comment — since this is being configured
// incrementally.
/**
 * The subset of nodemailer's send result this service reads. Declared
 * rather than imported because nodemailer types these as `any`, which
 * defeats the point of reading them at all.
 */
interface SmtpHandoffInfo {
  accepted?: unknown[];
  rejected?: unknown[];
}

/**
 * The outcome of one SMTP handoff — NOT proof of delivery. See sendMail.
 */
export interface MailSendResult {
  /** The server accepted at least one recipient. */
  handedOff: boolean;
  /** Recipients the server refused outright, at handoff. */
  rejected: string[];
  /** Why nothing was handed off. Absent when `handedOff` is true. */
  reason?: 'not_configured' | 'all_rejected';
}

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

  /**
   * Sends one message and reports what the SMTP server did with it.
   *
   * **Read the limits before treating `handedOff: true` as delivery.**
   * This reports the SMTP *handoff*, which is the only thing an
   * in-process send can observe. It catches:
   *
   * - a transport failure (still thrown, as before)
   * - recipients the server refuses at handoff, in `rejected`
   * - SMTP not being configured at all, which used to return silently and
   *   indistinguishably from success
   *
   * It still does **not** catch an asynchronous bounce, and it never
   * can: a relay accepts a message for a dead mailbox on a live domain
   * and bounces it later to the envelope sender, out of band and long
   * after this method has returned.
   *
   * **That case is covered elsewhere now, not here** — see
   * `bounce-mailbox.service.ts`, which polls a dedicated mailbox and
   * parses the returned DSNs (ADR-0030 finding 4, closed 2026-08-19).
   * A caller needing delivery evidence must use that signal:
   * `handedOff: true` from this method remains a statement about one
   * SMTP conversation and nothing more.
   */
  async sendMail(options: SendMailOptions): Promise<MailSendResult> {
    if (!this.transporter) {
      this.logger.warn(
        `Mail not sent (SMTP not configured): to=${options.to} subject="${options.subject}"`,
      );
      // Reported as not handed off, deliberately. It used to return void
      // here, so a caller had no way to tell "sent" from "silently
      // discarded because nobody set SMTP_HOST" — and a consent flow
      // whose mail is the entire control cannot afford that ambiguity.
      return { handedOff: false, rejected: [], reason: 'not_configured' };
    }

    // nodemailer types `sendMail`'s result loosely, so the two fields we
    // need arrive as `any` and trip the unsafe-member-access rules.
    // Narrowed once, here, rather than sprinkling casts at each read —
    // and narrowed to exactly the two fields this method uses, so the
    // assertion cannot quietly cover more than it was written for.
    const info = (await this.transporter.sendMail({
      from: this.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      ...(options.attachments?.length
        ? { attachments: options.attachments }
        : {}),
      ...(options.messageId ? { messageId: options.messageId } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    })) as SmtpHandoffInfo;

    // Previously discarded entirely. Coerced through String because
    // nodemailer may return either a bare address or an object form.
    const rejected = (info?.rejected ?? []).map((r) => String(r));
    const accepted = (info?.accepted ?? []).map((a) => String(a));

    if (rejected.length > 0) {
      this.logger.warn(
        `SMTP rejected ${rejected.length} recipient(s) for "${options.subject}".`,
      );
    }

    return {
      handedOff: accepted.length > 0,
      rejected,
      ...(accepted.length === 0 ? { reason: 'all_rejected' as const } : {}),
    };
  }
}
