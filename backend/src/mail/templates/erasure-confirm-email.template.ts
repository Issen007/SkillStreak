// docs/adr/0013-account-erasure.md Decision 2/3 — sent to the request-time
// snapshot of parent_contact, carrying the link that actually starts the
// 30-day grace-period clock. A bare in-app tap only creates this request;
// nothing durable happens until this link is followed and confirmed (see
// the ADR's "email-gates-the-clock" resolution) — a link, not an in-app
// "enter this code" flow, deliberately: the whole point of Decision 2's
// fix is that a merely-borrowed/compromised session can't complete this on
// its own, so there is no authenticated confirm endpoint to type the code
// back into (see GET/POST /players/erasure-confirm/:code, unauthenticated,
// mirroring ConsentController's link-only shape, not
// contact-change-confirm's in-app code entry).
//
// docs/adr/0014-multi-language-support.md Decision 3 — same `COPY`/
// `resolveCopy` fallback pattern as every other template in this
// directory; see consent-request-email.template.ts's comment for the full
// reasoning. Caller (AccountErasureService) already has the player's own
// Player row in hand, so `locale` comes from `player.locale` — no new
// query needed.

import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface ErasureConfirmEmailInput {
  screenName: string;
  confirmUrl: string;
  expiresInHours: number;
  locale: PlayerLocale;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LocaleCopy {
  subject: (screenName: string) => string;
  text: (
    screenName: string,
    confirmUrl: string,
    expiresInHours: number,
  ) => string;
  html: (
    safeScreenName: string,
    safeUrl: string,
    expiresInHours: number,
    subject: string,
  ) => string;
}

const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: {
    subject: (screenName) =>
      `Bekräfta radering av ${screenName}s konto på SkillStreak`,
    text: (screenName, confirmUrl, expiresInHours) =>
      [
        'Hej!',
        '',
        `Någon har bett om att radera ${screenName}s konto på SkillStreak, inklusive allt innehåll kontot äger.`,
        '',
        `Bekräfta här: ${confirmUrl}`,
        '',
        `Länken är giltig i ${expiresInHours} timmar och går bara att använda en gång. Att bekräfta startar en 30 dagars ångerperiod — kontot raderas inte förrän den perioden gått ut.`,
        '',
        'Var det inte du (eller ditt barn) som bad om detta? Ignorera det här mejlet — länken slutar gälla automatiskt och ingenting raderas.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, expiresInHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bekräfta radering av kontot</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Någon har bett om att radera <strong>${safeScreenName}</strong>s konto på SkillStreak,
                inklusive allt innehåll kontot äger.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Bekräfta radering
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Länken är giltig i ${expiresInHours} timmar, går bara att använda en gång. Att
                bekräfta startar en 30 dagars ångerperiod — kontot raderas inte förrän den perioden
                gått ut, och det går att avbryta när som helst innan dess.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Fungerar knappen inte, kopiera denna adress till webbläsaren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det inte du (eller ditt barn) som bad om detta? Ignorera det här mejlet — länken
                slutar gälla automatiskt och ingenting raderas.
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

export function buildErasureConfirmEmail(
  input: ErasureConfirmEmailInput,
): RenderedEmail {
  const { screenName, confirmUrl, expiresInHours, locale } = input;
  const copy = resolveCopy(locale);

  const subject = copy.subject(screenName);
  const text = copy.text(screenName, confirmUrl, expiresInHours);

  const safeScreenName = escapeHtml(screenName);
  const safeUrl = escapeHtml(confirmUrl);

  const html = copy.html(safeScreenName, safeUrl, expiresInHours, subject);

  return { subject, html, text };
}
