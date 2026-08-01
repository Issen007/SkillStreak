// ADR-0004 Part 3's 2026-07-27 addendum: the reissue code goes here, to
// the player's own parent_contact, and nowhere else — never back to
// whoever triggered the request (a captain, or the unauthenticated
// self-service lookup). That's the whole point of this redesign, see the
// addendum for the full account-takeover history this closes.
//
// Copy is written for the recipient, not the player — for an under-13
// player that's the actual parent; for a 13+ self-verified player
// parent_contact already *is* the player's own inbox (ADR-0002's
// 2026-07-27 addendum), so this copy needs to read sensibly either way,
// hence "share this code with {screenName}" rather than assuming a
// third-party parent audience like consent-request-email.template.ts does.
//
// docs/adr/0014-multi-language-support.md Decision 3 — same `COPY`/
// `resolveCopy` fallback pattern as every other template in this
// directory; see consent-request-email.template.ts's comment for the full
// reasoning. Caller (SessionService) already has the target Player row in
// hand, so `locale` comes from `player.locale` — no new query needed.

import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface SessionReissueEmailInput {
  screenName: string;
  teamName: string;
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
  text: (
    screenName: string,
    teamName: string,
    code: string,
    expiresInMinutes: number,
  ) => string;
  html: (
    safeScreenName: string,
    safeTeamName: string,
    safeCode: string,
    expiresInMinutes: number,
    subject: string,
  ) => string;
}

const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: {
    subject: `Kod för att logga in igen på SkillStreak`,
    text: (screenName, teamName, code, expiresInMinutes) =>
      [
        'Hej!',
        '',
        `Någon har bett om en ny inloggning för ${screenName} i ${teamName} på SkillStreak, eftersom den gamla sessionen inte längre fungerar (t.ex. ny telefon eller ominstallerad app).`,
        '',
        `Kod: ${code}`,
        '',
        `Öppna appen (eller sajten), välj "Har du redan ett konto?" och ange koden ovan. Koden är giltig i ${expiresInMinutes} minuter och går bara att använda en gång.`,
        '',
        'Var det inte du eller ditt barn som bad om detta? Ignorera det här mejlet — koden slutar gälla automatiskt och inget händer med kontot.',
      ].join('\n'),
    html: (
      safeScreenName,
      safeTeamName,
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Logga in igen</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Någon har bett om en ny inloggning för <strong>${safeScreenName}</strong> i
                <strong>${safeTeamName}</strong> på SkillStreak, eftersom den gamla sessionen
                inte längre fungerar (t.ex. ny telefon eller ominstallerad app).
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Öppna appen (eller sajten), välj <strong>"Har du redan ett konto?"</strong> och
                ange koden ovan. Giltig i ${expiresInMinutes} minuter, går bara att använda en
                gång.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det inte du eller ditt barn som bad om detta? Ignorera det här mejlet —
                koden slutar gälla automatiskt och inget händer med kontot.
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

export function buildSessionReissueEmail(
  input: SessionReissueEmailInput,
): RenderedEmail {
  const { screenName, teamName, code, expiresInMinutes, locale } = input;
  const copy = resolveCopy(locale);

  const subject = copy.subject;
  const text = copy.text(screenName, teamName, code, expiresInMinutes);

  const safeScreenName = escapeHtml(screenName);
  const safeTeamName = escapeHtml(teamName);
  const safeCode = escapeHtml(code);

  const html = copy.html(
    safeScreenName,
    safeTeamName,
    safeCode,
    expiresInMinutes,
    subject,
  );

  return { subject, html, text };
}
