// docs/adr/0012-profile-page-and-contact-email-change.md decision 1, step
// 2 — sent to the CANDIDATE new address, never the old one. Confirming
// this code is what actually applies the change; the old address's email
// (contact-change-notify-old-email.template.ts) is purely informational
// and has no code at all.
//
// docs/adr/0014-multi-language-support.md Decision 3 — same `COPY`/
// `resolveCopy` fallback pattern as every other template in this
// directory; see consent-request-email.template.ts's comment for the full
// reasoning. Caller (ProfileService) already has the player's own Player
// row in hand, so `locale` comes from `player.locale` — no new query
// needed.

import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface ContactChangeConfirmEmailInput {
  screenName: string;
  code: string;
  expiresInMinutes: number;
  locale: PlayerLocale;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LocaleCopy {
  subject: string;
  text: (screenName: string, code: string, expiresInMinutes: number) => string;
  html: (
    safeScreenName: string,
    safeCode: string,
    expiresInMinutes: number,
    subject: string,
  ) => string;
}

const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: {
    subject: 'Bekräfta ny kontaktadress på SkillStreak',
    text: (screenName, code, expiresInMinutes) =>
      [
        'Hej!',
        '',
        `Den här adressen håller på att bli den nya kontaktadressen för ${screenName}s konto på SkillStreak.`,
        '',
        `Kod: ${code}`,
        '',
        `Ange koden i appen (eller sajten) för att bekräfta ändringen. Koden är giltig i ${expiresInMinutes} minuter och går bara att använda en gång.`,
        '',
        'Var det inte du som bad om detta? Ignorera det här mejlet — koden slutar gälla automatiskt och ingenting ändras.',
      ].join('\n'),
    html: (
      safeScreenName,
      safeCode,
      expiresInMinutes,
      subject,
    ) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bekräfta ny kontaktadress</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Den här adressen håller på att bli den nya kontaktadressen för
                <strong>${safeScreenName}</strong>s konto på SkillStreak.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Ange koden i appen (eller sajten) för att bekräfta ändringen. Giltig i
                ${expiresInMinutes} minuter, går bara att använda en gång.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det inte du som bad om detta? Ignorera det här mejlet — koden slutar
                gälla automatiskt och ingenting ändras.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },
  // en/fi/da/nb/de/cs/fr: added incrementally, per part (b).
};

function resolveCopy(locale: PlayerLocale): LocaleCopy {
  return COPY[locale] ?? COPY.sv!; // never renders blank/broken
}

export function buildContactChangeConfirmEmail(
  input: ContactChangeConfirmEmailInput,
): RenderedEmail {
  const { screenName, code, expiresInMinutes, locale } = input;
  const copy = resolveCopy(locale);

  const subject = copy.subject;
  const text = copy.text(screenName, code, expiresInMinutes);

  const safeScreenName = escapeHtml(screenName);
  const safeCode = escapeHtml(code);

  const html = copy.html(safeScreenName, safeCode, expiresInMinutes, subject);

  return { subject, html, text };
}
