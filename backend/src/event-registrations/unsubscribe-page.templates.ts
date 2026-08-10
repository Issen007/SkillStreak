import { escapeHtml } from '../mail/templates/html-escape.util';
import { EventRegistrationLocale } from './entities/event-registration.entity';

interface Copy {
  title: string;
  body: string;
  button: string;
  doneTitle: string;
  doneBody: string;
  goneTitle: string;
  goneBody: string;
}

const COPY: Record<EventRegistrationLocale, Copy> = {
  [EventRegistrationLocale.SV]: {
    title: 'Vill du tas bort från listan?',
    body: 'Då raderar vi ditt namn och din mejladress. Du får inga fler utskick om visningen.',
    button: 'Ta bort mig',
    doneTitle: 'Klart — du är borttagen',
    doneBody: 'Dina uppgifter är raderade. Vi hör inte av oss igen.',
    goneTitle: 'Du finns inte på listan',
    goneBody:
      'Länken är använd eller så är uppgifterna redan borttagna. Du behöver inte göra något.',
  },
  [EventRegistrationLocale.EN]: {
    title: 'Remove you from the list?',
    body: 'We will delete your name and email address. You will get no further messages about the demo.',
    button: 'Remove me',
    doneTitle: 'Done — you are removed',
    doneBody: 'Your details are deleted. We will not contact you again.',
    goneTitle: 'You are not on the list',
    goneBody:
      'This link has been used, or the details were already removed. Nothing more to do.',
  },
};

const STYLE = `
  body { margin:0; background:#f4f6f8; color:#1b1d21; padding:12vh 20px;
         font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .card { max-width:460px; margin:0 auto; background:#fff; border:1px solid #d9dde2;
          border-radius:12px; padding:28px 26px; text-align:center; }
  h1 { font-size:19px; margin:0 0 10px; }
  p { color:#6a7078; font-size:14.5px; margin:0 0 20px; }
  button { font:inherit; font-size:15px; padding:11px 20px; border-radius:8px; cursor:pointer;
           background:#c1432f; border:1px solid #c1432f; color:#fff; }
`;

function page(title: string, body: string, form: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SkillStreak</title><style>${STYLE}</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${form}</div></body></html>`;
}

function copyFor(locale: EventRegistrationLocale | null): Copy {
  return COPY[locale ?? EventRegistrationLocale.SV] ?? COPY.sv;
}

/**
 * The GET view. Shows a button; changes nothing.
 *
 * The reason this is not a one-click GET, which would be friendlier: mail
 * clients and security scanners prefetch links in messages. A GET that
 * deleted the row would unsubscribe people who never clicked anything —
 * silently, and with no way to tell it happened. Same GET-preview /
 * POST-action idiom the consent and erasure links already use.
 */
export function renderUnsubscribePreview(
  locale: EventRegistrationLocale | null,
  actionUrl: string,
): string {
  const copy = copyFor(locale);
  const form = `<form method="post" action="${escapeHtml(actionUrl)}">
    <button type="submit">${escapeHtml(copy.button)}</button></form>`;
  return page(copy.title, copy.body, form);
}

export function renderUnsubscribeDone(
  locale: EventRegistrationLocale | null,
): string {
  const copy = copyFor(locale);
  return page(copy.doneTitle, copy.doneBody, '');
}

/**
 * Shown for an unknown code — deliberately worded as "you are not on the
 * list" rather than "invalid code". Someone who unsubscribed twice, or
 * whose row was already swept by retention, should read a calm
 * confirmation of what they wanted, not an error implying it failed.
 */
export function renderUnsubscribeGone(
  locale: EventRegistrationLocale | null,
): string {
  const copy = copyFor(locale);
  return page(copy.goneTitle, copy.goneBody, '');
}
