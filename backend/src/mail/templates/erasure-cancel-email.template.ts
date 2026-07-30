// docs/adr/0013-account-erasure.md Decision 2/3 — sent at CONFIRM time (not
// request time), to the same recipient_contact_snapshot the confirm-code
// email went to (never re-resolved from PlayerPrivateInfo — see the ADR's
// contact-change-race fix). This is what actually implements "30 days to
// regret it": a real, actionable link, valid the whole grace period, not
// just an informational notice.

import { escapeHtml } from './html-escape.util';

export interface ErasureCancelEmailInput {
  screenName: string;
  cancelUrl: string;
  scheduledForDateLabel: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildErasureCancelEmail(
  input: ErasureCancelEmailInput,
): RenderedEmail {
  const { screenName, cancelUrl, scheduledForDateLabel } = input;

  const subject = `Bekräftat: ${screenName}s konto raderas den ${scheduledForDateLabel}`;

  const text = [
    'Hej!',
    '',
    `Raderingen av ${screenName}s konto på SkillStreak har bekräftats. Kontot och allt innehåll det äger raderas den ${scheduledForDateLabel}, om inte begäran avbryts innan dess.`,
    '',
    'Ångrar du dig?',
    '',
    `Avbryt här: ${cancelUrl}`,
    '',
    'Du kan också avbryta direkt i appen, under Profil, när som helst innan raderingsdatumet.',
    '',
    'Var det du själv som bad om detta? Då behöver du inte göra något — raderingen sker automatiskt på det angivna datumet.',
  ].join('\n');

  const safeScreenName = escapeHtml(screenName);
  const safeUrl = escapeHtml(cancelUrl);
  const safeDateLabel = escapeHtml(scheduledForDateLabel);

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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontot raderas den ${safeDateLabel}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Raderingen av <strong>${safeScreenName}</strong>s konto på SkillStreak har bekräftats.
                Kontot och allt innehåll det äger raderas den <strong>${safeDateLabel}</strong>, om inte
                begäran avbryts innan dess.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Ångrar du dig?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Avbryt raderingen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Du kan också avbryta direkt i appen, under Profil, när som helst innan raderingsdatumet.
                Fungerar knappen inte, kopiera denna adress till webbläsaren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det du själv som bad om detta? Då behöver du inte göra något — raderingen sker
                automatiskt på det angivna datumet.
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
