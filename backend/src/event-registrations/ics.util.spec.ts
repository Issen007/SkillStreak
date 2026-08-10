import { buildDemoInviteIcs } from './ics.util';

function build(
  overrides: Partial<Parameters<typeof buildDemoInviteIcs>[0]> = {},
) {
  return buildDemoInviteIcs({
    uid: 'demo-1@skillstreak.xyz',
    startsAt: new Date('2026-09-03T17:00:00.000Z'),
    durationMinutes: 30,
    summary: 'SkillStreak — visning',
    description: 'Vi ses över Google Meet.',
    url: 'https://meet.google.com/abc-defg-hij',
    stamp: new Date('2026-08-10T09:00:00.000Z'),
    ...overrides,
  });
}

describe('buildDemoInviteIcs', () => {
  it('emits UTC timestamps in RFC 5545 basic form', () => {
    const ics = build();

    expect(ics).toContain('DTSTART:20260903T170000Z');
    expect(ics).toContain('DTSTAMP:20260810T090000Z');
  });

  it('derives DTEND from the duration', () => {
    expect(build({ durationMinutes: 45 })).toContain('DTEND:20260903T174500Z');
  });

  it('uses CRLF line endings — Outlook enforces it', () => {
    const ics = build();

    expect(ics).toContain('\r\n');
    expect(ics.split('\r\n').some((line) => line.includes('\n'))).toBe(false);
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('escapes commas, semicolons and newlines in text fields', () => {
    const ics = build({ description: 'Först; sedan, till sist\nklart' });

    expect(ics).toContain('Först\\; sedan\\, till sist\\nklart');
  });

  it('escapes backslashes without double-escaping the rest', () => {
    const ics = build({ description: 'a\\b,c' });

    // One backslash becomes two; the comma is escaped once, not twice.
    expect(ics).toContain('a\\\\b\\,c');
  });

  it('folds long lines at 75 octets', () => {
    const ics = build({ description: 'x'.repeat(200) });

    for (const line of ics.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
  });

  it('folds by octets, not characters, and never splits a character', () => {
    // 100 × 'ö' is 200 octets but only 100 characters — folding on
    // character count would emit over-long lines that some parsers reject.
    const ics = build({ description: 'ö'.repeat(100) });

    for (const line of ics.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
    // Nothing was corrupted on the way through.
    expect(ics).not.toContain('�');
    expect(ics.replace(/\r\n /g, '')).toContain('ö'.repeat(100));
  });

  it('carries the Meet link as both LOCATION and URL', () => {
    const ics = build();

    expect(ics).toContain('LOCATION:https://meet.google.com/abc-defg-hij');
    expect(ics).toContain('URL:https://meet.google.com/abc-defg-hij');
  });

  it('is a PUBLISH, with no ATTENDEE or ORGANIZER', () => {
    const ics = build();

    // Attendees would make this a meeting request: some clients mail an
    // RSVP back, others rewrite the event. Neither is wanted for an
    // invitation to something the recipient already signed up for.
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).not.toContain('ATTENDEE');
    expect(ics).not.toContain('ORGANIZER');
  });

  it('opens and closes the calendar and the event', () => {
    const ics = build();

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});
