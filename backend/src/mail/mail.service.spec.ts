import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * ADR-0030 Decision 5 depends on knowing whether a reminder reached the
 * parent. These pin what `sendMail` can and cannot tell a caller — the
 * second half matters as much as the first, because the reminder sweep
 * must not be written as though an SMTP handoff were a delivery.
 */
function buildService(transporter: unknown) {
  const configService = {
    get: jest.fn((key: string) =>
      key === 'SMTP_HOST' ? 'smtp.example.test' : 'noreply@example.test',
    ),
  };
  const service = new MailService(configService as never);
  // The transporter is created in the constructor from config; replace it
  // rather than standing up a real SMTP server.
  (service as unknown as { transporter: unknown }).transporter = transporter;
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return service;
}

describe('MailService.sendMail: reporting the handoff', () => {
  it('reports a clean handoff when the server accepts the recipient', async () => {
    const service = buildService({
      sendMail: jest
        .fn()
        .mockResolvedValue({ accepted: ['parent@example.se'], rejected: [] }),
    });

    const result = await service.sendMail({
      to: 'parent@example.se',
      subject: 's',
      text: 't',
    });

    expect(result).toEqual({ handedOff: true, rejected: [] });
  });

  it('surfaces recipients the server refused at handoff', async () => {
    // Previously discarded entirely — nodemailer returns them and nothing
    // read them, so a refused recipient looked exactly like a sent one.
    const service = buildService({
      sendMail: jest
        .fn()
        .mockResolvedValue({ accepted: [], rejected: ['dead@example.se'] }),
    });

    const result = await service.sendMail({
      to: 'dead@example.se',
      subject: 's',
      text: 't',
    });

    expect(result.handedOff).toBe(false);
    expect(result.rejected).toEqual(['dead@example.se']);
    expect(result.reason).toBe('all_rejected');
  });

  it('does not report unconfigured SMTP as a send', async () => {
    // The behaviour this replaces: it returned void, so "nobody set
    // SMTP_HOST" was indistinguishable from "delivered". For a consent
    // flow whose mail IS the control, that ambiguity is the bug.
    const service = buildService(null);

    const result = await service.sendMail({
      to: 'parent@example.se',
      subject: 's',
      text: 't',
    });

    expect(result).toEqual({
      handedOff: false,
      rejected: [],
      reason: 'not_configured',
    });
  });

  it('still throws on a transport failure rather than swallowing it', async () => {
    // Unchanged on purpose: 18 call sites rely on try/catch around this,
    // and turning a throw into a return value would silently disarm them.
    const service = buildService({
      sendMail: jest.fn().mockRejectedValue(new Error('connection refused')),
    });

    await expect(
      service.sendMail({ to: 'p@example.se', subject: 's', text: 't' }),
    ).rejects.toThrow('connection refused');
  });
});
