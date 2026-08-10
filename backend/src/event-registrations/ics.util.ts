export interface CalendarInvite {
  uid: string;
  startsAt: Date;
  durationMinutes: number;
  summary: string;
  description: string;
  /** The Meet link. Goes in both URL: and LOCATION: — calendars differ on
   * which one they surface as the joinable thing. */
  url: string;
  stamp: Date;
}

/**
 * Escapes a value for an iCalendar text field, per RFC 5545 §3.3.11.
 *
 * Backslash first — escaping it after the others would double-escape the
 * backslashes they just introduced.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545's UTC form: 20260901T170000Z. */
function toIcsUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Folds a line to 75 octets, per RFC 5545 §3.1.
 *
 * Counted in **octets, not characters**: the description carries Swedish
 * copy, and å/ä/ö are two bytes each in UTF-8. Folding on character count
 * would produce lines that are legal-looking and over the limit, which
 * some parsers accept silently and others do not — the worst kind of bug
 * to chase from a calendar app's "could not import" dialog.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    // First continuation line loses one octet to the leading space.
    const limit = parts.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character: back off while the next octet is
    // a UTF-8 continuation byte (10xxxxxx).
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n ');
}

/**
 * Builds a minimal VEVENT for the demo.
 *
 * Hand-rolled rather than pulling a library: this produces one event with
 * six fields and no recurrence, timezone table, or attendee list, and the
 * fiddly parts (escaping, UTC formatting, octet-accurate folding) are all
 * above and tested. A dependency would be more code to audit than this is
 * to own.
 *
 * **No ATTENDEE and no ORGANIZER with a mailto.** Adding attendees turns
 * the .ics into a meeting *request*, which some clients answer by mailing
 * an RSVP back to the organiser and others by silently rewriting the
 * event. This is an invitation to an event someone already said yes to —
 * `METHOD:PUBLISH`, a link, and nothing that talks back.
 */
export function buildDemoInviteIcs(invite: CalendarInvite): string {
  const endsAt = new Date(
    invite.startsAt.getTime() + invite.durationMinutes * 60 * 1000,
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SkillStreak//Demo Invite//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(invite.uid)}`,
    `DTSTAMP:${toIcsUtc(invite.stamp)}`,
    `DTSTART:${toIcsUtc(invite.startsAt)}`,
    `DTEND:${toIcsUtc(endsAt)}`,
    `SUMMARY:${escapeText(invite.summary)}`,
    `DESCRIPTION:${escapeText(invite.description)}`,
    `LOCATION:${escapeText(invite.url)}`,
    `URL:${escapeText(invite.url)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF throughout — RFC 5545 requires it, and Outlook is the client that
  // actually enforces it.
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
