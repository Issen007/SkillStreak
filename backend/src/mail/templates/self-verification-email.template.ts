// The 13+ counterpart to consent-request-email.template.ts — same shared-
// template reasoning (OnboardingService and the send-test-consent-email
// script both need exactly one definition of what this email says), but
// addressed to the player themselves, not a parent/guardian. Added
// 2026-07-27 for age-banded self-verification (13+) — see
// self-verification-age.util.ts and docs/adr/0002-data-model.md addendum §2.
//
// Copy is first-person ("verify your own account"), not third-person
// ("does your child have permission") — the whole point of this template
// existing separately is that nobody else is being asked anything here.

import { escapeHtml } from './html-escape.util';

export interface SelfVerificationEmailInput {
  screenName: string;
  teamName: string;
  consentUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildSelfVerificationEmail(
  input: SelfVerificationEmailInput,
): RenderedEmail {
  const { screenName, teamName, consentUrl } = input;

  const subject = `Verifiera ditt konto för ${teamName} på SkillStreak`;

  const text = [
    'Hej!',
    '',
    `Nästan klart! Du har gått med i ${teamName} på SkillStreak — en app för dagliga träningsstreak och ett gemensamt lagpoäng-mål.`,
    '',
    'Klicka på länken nedan för att verifiera din e-post och aktivera ditt konto.',
    '',
    `Verifiera här: ${consentUrl}`,
    '',
    'Länken är giltig i 7 dagar.',
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Verifiera ditt konto</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                Nästan klart! Du har gått med i <strong>${safeTeamName}</strong> på SkillStreak
                som <strong>${safeScreenName}</strong> — en app för dagliga träningsstreak och ett gemensamt lagpoäng-mål.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Klicka på knappen nedan för att verifiera din e-post och börja logga träningspass.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Verifiera mitt konto
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Länken är giltig i 7 dagar. Fungerar knappen inte, kopiera denna adress till webbläsaren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
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
