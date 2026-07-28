// docs/adr/0012-profile-page-and-contact-email-change.md decision 1, step
// 3 — sent to the CURRENT (old) address on file, at request time, before
// the change takes effect. Purely informational: no code, nothing
// actionable from this email itself. Deliberately sent *before* the
// change completes (not after) — gives the real account owner a window
// to react (contact the coach) while the change is still pending, rather
// than a too-late "this already happened" notice.

import { escapeHtml } from './html-escape.util';

export interface ContactChangeNotifyOldEmailInput {
  screenName: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildContactChangeNotifyOldEmail(
  input: ContactChangeNotifyOldEmailInput,
): RenderedEmail {
  const { screenName } = input;

  const subject = `Kontaktadressen för ${screenName}s konto håller på att ändras`;

  const text = [
    'Hej!',
    '',
    `Någon har bett om att byta kontaktadress för ${screenName}s konto på SkillStreak till en ny adress.`,
    '',
    'Var det du (eller din förälder) som gjorde detta? Då behöver du inte göra något — ändringen slutförs bara om den nya adressen bekräftas.',
    '',
    'Var det inte du? Hör av dig till lagets tränare så snart som möjligt.',
  ].join('\n');

  const safeScreenName = escapeHtml(screenName);

  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1B1B3A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFAF7;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:16px;padding:32px;max-width:480px;">
          <tr>
            <td>
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktadressen håller på att ändras</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                Någon har bett om att byta kontaktadress för <strong>${safeScreenName}</strong>s
                konto på SkillStreak till en ny adress.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
                Var det du (eller din förälder) som gjorde detta? Då behöver du inte göra
                något — ändringen slutförs bara om den nya adressen bekräftas.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.5;font-weight:700;">
                Var det inte du? Hör av dig till lagets tränare så snart som möjligt.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
