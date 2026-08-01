// Shared by OnboardingService (the real signup flow) and the
// send-test-consent-email script, so there is exactly one place that
// defines what a parent's consent-request email says — per the task that
// introduced this: "don't duplicate the email template — extract it if
// needed so both call sites share it."
//
// Copy is deliberately plain: what's happening, what approving means, one
// clear link. No urgency/pressure language — this app's audience is
// children's parents, per CLAUDE.md's non-negotiable constraints.
//
// docs/adr/0014-multi-language-support.md Decision 3 — `locale` is a
// required input, resolved via the `COPY`/`resolveCopy` fallback pattern
// below (only `sv` has real content in part (a); en/fi/da/nb fall through
// to it, never a blank/broken email). Callers pass `Player.locale` — see
// the ADR's per-call-site "where locale comes from" list.

import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface ConsentRequestEmailInput {
  screenName: string;
  teamName: string;
  consentUrl: string;
  locale: PlayerLocale;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LocaleCopy {
  subject: (screenName: string, teamName: string) => string;
  text: (screenName: string, teamName: string, consentUrl: string) => string;
  html: (
    safeScreenName: string,
    safeTeamName: string,
    safeUrl: string,
    subject: string,
  ) => string;
}

const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: {
    subject: (screenName, teamName) =>
      `${screenName} vill gå med i ${teamName} på SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hej!',
        '',
        `${screenName} vill gå med i ${teamName} på SkillStreak — en app för dagliga träningsstreak och ett gemensamt lagpoäng-mål.`,
        '',
        `Om du godkänner kan ${screenName} börja logga träningspass och se lagets gemensamma poäng ("VM-Guld"-mätaren).`,
        '',
        `Godkänn här: ${consentUrl}`,
        '',
        'Länken är giltig i 7 dagar. Har du frågor, hör av dig till tränaren.',
      ].join('\n'),
    html: (safeScreenName, safeTeamName, safeUrl, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Godkännande för ${safeScreenName}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong> vill gå med i <strong>${safeTeamName}</strong> på SkillStreak
                — en app för dagliga träningsstreak och ett gemensamt lagpoäng-mål.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Om du godkänner kan ${safeScreenName} börja logga träningspass och se lagets gemensamma poäng.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Godkänn ${safeScreenName}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Länken är giltig i 7 dagar. Fungerar knappen inte, kopiera denna adress till webbläsaren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Har du frågor? Hör av dig till tränaren.
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

export function buildConsentRequestEmail(
  input: ConsentRequestEmailInput,
): RenderedEmail {
  const { screenName, teamName, consentUrl, locale } = input;
  const copy = resolveCopy(locale);

  const subject = copy.subject(screenName, teamName);
  const text = copy.text(screenName, teamName, consentUrl);

  const safeScreenName = escapeHtml(screenName);
  const safeTeamName = escapeHtml(teamName);
  const safeUrl = escapeHtml(consentUrl);

  const html = copy.html(safeScreenName, safeTeamName, safeUrl, subject);

  return { subject, html, text };
}
