import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { SubmitContactEnquiryDto } from './dto/submit-contact-enquiry.dto';

/**
 * Mail header injection, from the 2026-08-26 security review.
 *
 * `name` and `organisation` are interpolated into the message subject,
 * and `trim()` removes only leading and trailing whitespace — an interior
 * CRLF survives it, which is the textbook injection shape.
 *
 * **It was never exploitable**, checked rather than assumed: nodemailer
 * RFC-2047-encodes the subject, so the CRLF becomes a space inside an
 * encoded word and no second header is emitted. Verified by sending
 * through a stream transport and reading the raw headers, where no `Bcc:`
 * appeared. This pins our own half anyway, because that defence lives in
 * a dependency and a transport swap would reopen it silently.
 *
 * **Exercised through the ValidationPipe on purpose.** `@Transform` runs
 * in the pipe, not in the service — a first version of this test built
 * the DTO with `Object.assign`, bypassed class-transformer entirely, and
 * failed identically with and against the fix. A test that cannot tell
 * the two apart is worse than none.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const meta = { type: 'body' as const, metatype: SubmitContactEnquiryDto };

function body(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Anna Lind',
    email: 'anna@example.com',
    message: 'We would like to sponsor a team this season.',
    ...overrides,
  };
}

describe('SubmitContactEnquiryDto: fields that reach a mail header', () => {
  it.each(['name', 'organisation'])('strips CR/LF from %s', async (field) => {
    const result = (await pipe.transform(
      body({ [field]: 'Anna\r\nBcc: victim@example.net' }),
      meta,
    )) as Record<string, string>;

    expect(result[field]).not.toMatch(/[\r\n]/);
    expect(result[field]).toBe('Anna Bcc: victim@example.net');
  });

  // The message is a body, not a header. Newlines there are meaningful
  // and must survive — stripping them would mangle every paragraph
  // anybody writes.
  it('keeps newlines in the message body', async () => {
    const result = (await pipe.transform(
      body({ message: 'First paragraph.\n\nSecond paragraph, still valid.' }),
      meta,
    )) as Record<string, string>;

    expect(result.message).toContain('\n\n');
  });
});
