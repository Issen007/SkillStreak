import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { ContactService } from './contact.service';
import type { SendMailOptions } from '../mail/mail.service';
import { SubmitContactEnquiryDto } from './dto/submit-contact-enquiry.dto';

function enquiry(
  overrides: Partial<SubmitContactEnquiryDto> = {},
): SubmitContactEnquiryDto {
  const dto = new SubmitContactEnquiryDto();
  Object.assign(dto, {
    name: 'Anna Lind',
    email: 'anna@example.com',
    message: 'We would like to sponsor a team this season.',
    ...overrides,
  });
  return dto;
}

function build(recipient: string | undefined, handedOff = true) {
  const sendMail = jest
    .fn<Promise<unknown>, [SendMailOptions]>()
    .mockResolvedValue({ handedOff, rejected: [], reason: undefined });
  const service = new ContactService(
    { sendMail } as unknown as MailService,
    { get: () => recipient } as unknown as ConfigService,
  );
  return { service, sendMail };
}

describe('ContactService', () => {
  it('delivers an enquiry to the configured recipient', async () => {
    const { service, sendMail } = build('owner@example.com');

    await expect(service.submit(enquiry())).resolves.toEqual({
      delivered: true,
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: 'owner@example.com',
    });
  });

  // The sender cannot pick the recipient, which is what keeps this from
  // being an open relay: an unauthenticated stranger controls the body
  // and nothing else.
  it('sends only to the configured address, never one from the submission', async () => {
    const { service, sendMail } = build('owner@example.com');

    await service.submit(enquiry({ email: 'attacker@example.net' }));

    expect(sendMail.mock.calls[0][0].to).toBe('owner@example.com');
  });

  // Both spellings of "unset". The blank one is the one that actually
  // happens: a ConfigMap key that exists with no value arrives as ''.
  it.each([undefined, '', '   '])(
    'reports undelivered rather than pretending, when the recipient is %p',
    async (recipient) => {
      const { service, sendMail } = build(recipient);

      await expect(service.submit(enquiry())).resolves.toEqual({
        delivered: false,
      });
      expect(sendMail).not.toHaveBeenCalled();
    },
  );

  it('reports undelivered when SMTP refused the handoff', async () => {
    const { service } = build('owner@example.com', false);

    await expect(service.submit(enquiry())).resolves.toEqual({
      delivered: false,
    });
  });

  // Answering as though it worked is the point — a 400 would teach a bot
  // that the field is a trap.
  it('drops a honeypot submission silently and still answers delivered', async () => {
    const { service, sendMail } = build('owner@example.com');

    await expect(
      service.submit(enquiry({ website: 'http://spam.example' })),
    ).resolves.toEqual({ delivered: true });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
