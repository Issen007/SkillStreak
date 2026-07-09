// Shared by OnboardingService (the real signup flow) and the
// send-test-consent-email script, so there is exactly one place that
// defines what a parent's consent-request email says — per the task that
// introduced this: "don't duplicate the email template — extract it if
// needed so both call sites share it."
//
// Copy is deliberately plain: what's happening, what approving means, one
// clear link. No urgency/pressure language — this app's audience is
// children's parents, per CLAUDE.md's non-negotiable constraints.

import { escapeHtml } from './html-escape.util';

export interface ConsentRequestEmailInput {
  screenName: string;
  teamName: string;
  consentUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildConsentRequestEmail(
  input: ConsentRequestEmailInput,
): RenderedEmail {
  const { screenName, teamName, consentUrl } = input;

  const subject = `${screenName} vill gå med i ${teamName} på SkillStreak`;

  const text = [
    'Hej!',
    '',
    `${screenName} vill gå med i ${teamName} på SkillStreak — en app för dagliga träningsstreak och ett gemensamt lagpoäng-mål.`,
    '',
    `Om du godkänner kan ${screenName} börja logga träningspass och se lagets gemensamma poäng ("VM-Guld"-mätaren).`,
    '',
    `Godkänn här: ${consentUrl}`,
    '',
    'Länken är giltig i 7 dagar. Har du frågor, hör av dig till tränaren.',
  ].join('\n');

  const safeScreenName = escapeHtml(screenName);
  const safeTeamName = escapeHtml(teamName);
  const safeUrl = escapeHtml(consentUrl);

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
</html>`;

  return { subject, html, text };
}
