import { EventRegistrationLocale } from '../../event-registrations/entities/event-registration.entity';
import { escapeHtml } from './html-escape.util';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * The two emails the demo list ever receives: a confirmation when someone
 * signs up, and the invitation itself.
 *
 * Two locales only (`sv`/`en`), matching the public site rather than the
 * app's eight — see EventRegistrationLocale for why those vocabularies are
 * deliberately separate.
 *
 * **Every message carries the unsubscribe link.** Not a courtesy: this is
 * a consent-based list, and spam complaints damage the sending domain's
 * reputation — which takes the parental-consent email down with it. The
 * link protects that pipeline at least as much as it protects the reader.
 */

interface ConfirmationCopy {
  subject: string;
  heading: string;
  body: string;
  whatNext: string;
  unsubscribe: string;
}

const CONFIRMATION: Record<EventRegistrationLocale, ConfirmationCopy> = {
  [EventRegistrationLocale.SV]: {
    subject: 'Tack — du är anmäld till SkillStreak-visningen',
    heading: 'Vi ses på visningen',
    body: 'Tack för din anmälan! Vi visar SkillStreak live i början av september — hur en träning loggas, hur laget jagar VM-guldet ihop, och hur trygghetsreglerna fungerar.',
    whatNext:
      'Du får en inbjudan med Meet-länken och exakt tid så snart den är spikad. Du behöver inte göra något innan dess.',
    unsubscribe: 'Vill du inte vara med på listan? Ta bort dig här:',
  },
  [EventRegistrationLocale.EN]: {
    subject: 'Thanks — you are signed up for the SkillStreak demo',
    heading: 'See you at the demo',
    body: 'Thanks for signing up. We are showing SkillStreak live in early September — how a session gets logged, how a team chases its gold together, and how the safety rules work.',
    whatNext:
      'You will get an invitation with the Meet link and the exact time as soon as it is set. Nothing to do until then.',
    unsubscribe: 'Would you rather not be on the list? Remove yourself here:',
  },
};

interface InviteCopy {
  subject: string;
  heading: string;
  greeting: (name: string) => string;
  when: string;
  join: string;
  joinButton: string;
  calendar: string;
  unsubscribe: string;
}

const INVITE: Record<EventRegistrationLocale, InviteCopy> = {
  [EventRegistrationLocale.SV]: {
    subject: 'Din inbjudan till SkillStreak-visningen',
    heading: 'Välkommen till visningen',
    greeting: (name) => `Hej ${name}!`,
    when: 'Tid',
    join: 'Vi ses över Google Meet. Klicka på länken när det är dags — du behöver inget konto.',
    joinButton: 'Anslut till mötet',
    calendar: 'Kalenderfilen i det här mejlet lägger in mötet i din kalender.',
    unsubscribe: 'Vill du inte vara med på listan? Ta bort dig här:',
  },
  [EventRegistrationLocale.EN]: {
    subject: 'Your invitation to the SkillStreak demo',
    heading: 'Welcome to the demo',
    greeting: (name) => `Hi ${name},`,
    when: 'When',
    join: 'We meet over Google Meet. Click the link when it is time — you do not need an account.',
    joinButton: 'Join the meeting',
    calendar: 'The calendar file attached will add it to your calendar.',
    unsubscribe: 'Would you rather not be on the list? Remove yourself here:',
  },
};

const WRAP_START = `<div style="font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1d21;max-width:520px">`;
const WRAP_END = '</div>';

function unsubscribeBlock(label: string, url: string): string {
  return `<p style="color:#6a7078;font-size:13px;margin-top:28px;border-top:1px solid #d9dde2;padding-top:14px">
${escapeHtml(label)} <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`;
}

function localeCopy<T>(
  table: Record<EventRegistrationLocale, T>,
  locale: EventRegistrationLocale | null,
): T {
  return table[locale ?? EventRegistrationLocale.SV] ?? table.sv;
}

export function renderSignupConfirmationEmail(input: {
  locale: EventRegistrationLocale | null;
  unsubscribeUrl: string;
}): RenderedEmail {
  const copy = localeCopy(CONFIRMATION, input.locale);
  const text = [
    copy.heading,
    '',
    copy.body,
    '',
    copy.whatNext,
    '',
    `${copy.unsubscribe} ${input.unsubscribeUrl}`,
  ].join('\n');

  const html = `${WRAP_START}
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(copy.heading)}</h1>
<p>${escapeHtml(copy.body)}</p>
<p>${escapeHtml(copy.whatNext)}</p>
${unsubscribeBlock(copy.unsubscribe, input.unsubscribeUrl)}
${WRAP_END}`;

  return { subject: copy.subject, html, text };
}

export function renderDemoInviteEmail(input: {
  locale: EventRegistrationLocale | null;
  name: string;
  /** Already formatted for the reader's locale by the caller — this
   * template does no date maths and knows no timezone. */
  whenText: string;
  meetUrl: string;
  /** The admin's own words, optional, shown above the join link. */
  message: string | null;
  unsubscribeUrl: string;
}): RenderedEmail {
  const copy = localeCopy(INVITE, input.locale);
  const text = [
    copy.greeting(input.name),
    '',
    ...(input.message ? [input.message, ''] : []),
    `${copy.when}: ${input.whenText}`,
    '',
    copy.join,
    input.meetUrl,
    '',
    copy.calendar,
    '',
    `${copy.unsubscribe} ${input.unsubscribeUrl}`,
  ].join('\n');

  const html = `${WRAP_START}
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(copy.heading)}</h1>
<p>${escapeHtml(copy.greeting(input.name))}</p>
${input.message ? `<p>${escapeHtml(input.message)}</p>` : ''}
<p><strong>${escapeHtml(copy.when)}:</strong> ${escapeHtml(input.whenText)}</p>
<p>${escapeHtml(copy.join)}</p>
<p><a href="${escapeHtml(input.meetUrl)}"
   style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px">${escapeHtml(copy.joinButton)}</a></p>
<p style="color:#6a7078;font-size:13.5px">${escapeHtml(copy.calendar)}</p>
${unsubscribeBlock(copy.unsubscribe, input.unsubscribeUrl)}
${WRAP_END}`;

  return { subject: copy.subject, html, text };
}
