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

/**
 * The one-off "may we also mail you about releases?" message.
 *
 * Sent under the *existing* consent — it is about the demo list these
 * people are already on — and asks for a new, narrower one. It exists
 * because the form changed on 2026-08-21 to offer release news, and
 * everyone who signed up before that agreed to a demo invitation and
 * nothing else. Adding them silently would have been the easy thing and
 * the wrong one.
 *
 * Two links, and the difference matters: one to opt in, one to leave
 * entirely. Doing nothing is a third answer, and it is respected — this
 * message is sent once, and no is the default.
 */
interface ReleaseConsentCopy {
  subject: string;
  heading: string;
  body: string;
  ask: string;
  button: string;
  nothing: string;
  unsubscribe: string;
}

const RELEASE_CONSENT: Record<EventRegistrationLocale, ReleaseConsentCopy> = {
  [EventRegistrationLocale.SV]: {
    subject: 'Vill du höra när SkillStreak släpps?',
    heading: 'En kort fråga',
    body: 'Du står på listan för SkillStreak-visningen. Det står du kvar på — det här ändrar inget om den.',
    ask: 'Vi har nu också ett utskick om nya släpp: när appen finns att hämta, och vad som är nytt. Vill du ha det behöver vi ditt ja, för det är inte det du sa ja till när du anmälde dig.',
    button: 'Ja, hör av er om nya släpp',
    nothing:
      'Vill du inte, gör du ingenting alls. Vi frågar bara den här gången.',
    unsubscribe: 'Vill du bort från listan helt? Ta bort dig här:',
  },
  [EventRegistrationLocale.EN]: {
    subject: 'Want to hear when SkillStreak ships?',
    heading: 'One short question',
    body: 'You are on the list for the SkillStreak demo. You still are — this changes nothing about that.',
    ask: 'We now also send a note about new releases: when the app is available, and what is new. If you want it we need your yes, because it is not what you agreed to when you signed up.',
    button: 'Yes, tell me about new releases',
    nothing:
      'If you would rather not, do nothing at all. We are only asking this once.',
    unsubscribe: 'Want off the list entirely? Remove yourself here:',
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

export function renderReleaseConsentEmail(input: {
  locale: EventRegistrationLocale | null;
  optInUrl: string;
  unsubscribeUrl: string;
}): RenderedEmail {
  const copy = localeCopy(RELEASE_CONSENT, input.locale);
  const text = [
    copy.heading,
    '',
    copy.body,
    '',
    copy.ask,
    '',
    `${copy.button}: ${input.optInUrl}`,
    '',
    copy.nothing,
    '',
    `${copy.unsubscribe} ${input.unsubscribeUrl}`,
  ].join('\n');

  const html = `${WRAP_START}
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(copy.heading)}</h1>
<p>${escapeHtml(copy.body)}</p>
<p>${escapeHtml(copy.ask)}</p>
<p style="margin:22px 0"><a href="${escapeHtml(input.optInUrl)}" style="background:#c1432f;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(copy.button)}</a></p>
<p style="color:#6a7078;font-size:14px">${escapeHtml(copy.nothing)}</p>
${unsubscribeBlock(copy.unsubscribe, input.unsubscribeUrl)}
${WRAP_END}`;

  return { subject: copy.subject, html, text };
}
