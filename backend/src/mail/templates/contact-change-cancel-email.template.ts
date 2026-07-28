// docs/adr/0012-profile-page-and-contact-email-change.md's addendum
// (security-reviewer finding, 2026-07-28) — sent to the OLD address once
// the new-address code is confirmed, not at request time. Unlike
// contact-change-notify-old-email.template.ts (purely informational,
// sent at request time, before anything concrete exists to act on), this
// one carries a real, actionable cancel link: the change is now in a
// 24h grace period, and this is the only way to stop it.
//
// A clickable link, not a code to type into the app — unlike the confirm
// email (session-reissue-style, expects the same device/person who's
// already using the app), the OLD address might belong to someone who
// isn't the one holding the phone with the app on it at all (a parent
// checking email on a laptop, say). Same reasoning as the parental-
// consent link's own GET-preview/POST-confirm web page, not an app
// screen — see ProfileController/contact-change-cancel-page.templates.ts.

import { escapeHtml } from './html-escape.util';

export interface ContactChangeCancelEmailInput {
  screenName: string;
  cancelUrl: string;
  graceHours: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildContactChangeCancelEmail(
  input: ContactChangeCancelEmailInput,
): RenderedEmail {
  const { screenName, cancelUrl, graceHours } = input;

  const subject = `Bekräftat: kontaktadressen för ${screenName}s konto byts snart`;

  const text = [
    'Hej!',
    '',
    `Bytet av kontaktadress för ${screenName}s konto på SkillStreak har bekräftats och träder i kraft om ${graceHours} timmar.`,
    '',
    'Var det inte du (eller din förälder) som gjorde detta?',
    '',
    `Avbryt här: ${cancelUrl}`,
    '',
    'Det loggar också ut alla aktiva sessioner på kontot, så den som gjorde ändringen loggas ut.',
    '',
    'Var det du själv? Då behöver du inte göra något — bytet slutförs automatiskt.',
  ].join('\n');

  const safeScreenName = escapeHtml(screenName);
  const safeUrl = escapeHtml(cancelUrl);

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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktadressen byts snart</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Bytet av kontaktadress för <strong>${safeScreenName}</strong>s konto på SkillStreak
                har bekräftats och träder i kraft om ${graceHours} timmar.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Var det inte du (eller din förälder) som gjorde detta?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Avbryt bytet
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Det loggar också ut alla aktiva sessioner på kontot. Fungerar knappen inte,
                kopiera denna adress till webbläsaren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det du själv? Då behöver du inte göra något — bytet slutförs automatiskt.
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
