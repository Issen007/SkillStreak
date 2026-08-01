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
//
// docs/adr/0014-multi-language-support.md Decision 3 — same `COPY`/
// `resolveCopy` fallback pattern as every other template in this
// directory; see consent-request-email.template.ts's comment for the full
// reasoning.

import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface SelfVerificationEmailInput {
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
  subject: (teamName: string) => string;
  text: (screenName: string, teamName: string, consentUrl: string) => string;
  html: (
    safeScreenName: string,
    safeTeamName: string,
    safeUrl: string,
    subject: string,
  ) => string;
}

// en/fi/da/nb/de/cs/fr translations below are AI-generated (this session),
// not sourced from a professional/native-speaker translator — recommend a
// native-speaker review pass before relying on this for real families,
// especially given this template's GDPR consent context.
const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: {
    subject: (teamName) =>
      `Verifiera ditt konto för ${teamName} på SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hej!',
        '',
        `Nästan klart! Du har gått med i ${teamName} på SkillStreak — en app för dagliga träningsstreak och ett gemensamt lagpoäng-mål.`,
        '',
        'Klicka på länken nedan för att verifiera din e-post och aktivera ditt konto.',
        '',
        `Verifiera här: ${consentUrl}`,
        '',
        'Länken är giltig i 7 dagar.',
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
</html>`,
  },
  en: {
    subject: (teamName) => `Verify your account for ${teamName} on SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hi there!',
        '',
        `Almost done! You've joined ${teamName} on SkillStreak — an app for daily training streaks and a shared team point goal.`,
        '',
        'Click the link below to verify your email and activate your account.',
        '',
        `Verify here: ${consentUrl}`,
        '',
        'The link is valid for 7 days.',
      ].join('\n'),
    html: (safeScreenName, safeTeamName, safeUrl, subject) => `<!DOCTYPE html>
<html lang="en">
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Verify your account</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                Almost done! You've joined <strong>${safeTeamName}</strong> on SkillStreak
                as <strong>${safeScreenName}</strong> — an app for daily training streaks and a shared team point goal.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Click the button below to verify your email and start logging training sessions.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Verify my account
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                The link is valid for 7 days. If the button doesn't work, copy this address into your browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
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
  fi: {
    subject: (teamName) =>
      `Vahvista tilisi joukkueelle ${teamName} SkillStreakissa`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hei!',
        '',
        `Melkein valmista! Olet liittynyt joukkueeseen ${teamName} SkillStreakissa — sovellukseen, jossa harjoitellaan päivittäin putkeen ja kerätään yhteistä joukkuepistemäärää.`,
        '',
        'Vahvista sähköpostiosoitteesi ja ota tilisi käyttöön klikkaamalla alla olevaa linkkiä.',
        '',
        `Vahvista täällä: ${consentUrl}`,
        '',
        'Linkki on voimassa 7 päivää.',
      ].join('\n'),
    html: (safeScreenName, safeTeamName, safeUrl, subject) => `<!DOCTYPE html>
<html lang="fi">
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Vahvista tilisi</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                Melkein valmista! Olet liittynyt joukkueeseen <strong>${safeTeamName}</strong> SkillStreakissa
                nimellä <strong>${safeScreenName}</strong> — sovellukseen, jossa harjoitellaan päivittäin putkeen ja kerätään yhteistä joukkuepistemäärää.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Klikkaa alla olevaa painiketta vahvistaaksesi sähköpostiosoitteesi ja aloittaaksesi harjoitusten kirjaamisen.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Vahvista tilini
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Linkki on voimassa 7 päivää. Jos painike ei toimi, kopioi tämä osoite selaimeesi:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
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
  da: {
    subject: (teamName) => `Bekræft din konto for ${teamName} på SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hej!',
        '',
        `Næsten færdig! Du er blevet medlem af ${teamName} på SkillStreak — en app til daglige træningsstreaks og et fælles holdpoint-mål.`,
        '',
        'Klik på linket nedenfor for at bekræfte din e-mail og aktivere din konto.',
        '',
        `Bekræft her: ${consentUrl}`,
        '',
        'Linket er gyldigt i 7 dage.',
      ].join('\n'),
    html: (safeScreenName, safeTeamName, safeUrl, subject) => `<!DOCTYPE html>
<html lang="da">
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bekræft din konto</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                Næsten færdig! Du er blevet medlem af <strong>${safeTeamName}</strong> på SkillStreak
                som <strong>${safeScreenName}</strong> — en app til daglige træningsstreaks og et fælles holdpoint-mål.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Klik på knappen nedenfor for at bekræfte din e-mail og begynde at logge træningspas.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Bekræft min konto
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Linket er gyldigt i 7 dage. Virker knappen ikke, så kopiér denne adresse til browseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
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
  nb: {
    subject: (teamName) => `Bekreft kontoen din for ${teamName} på SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hei!',
        '',
        `Nesten ferdig! Du har blitt med i ${teamName} på SkillStreak — en app for daglige treningsstreaker og et felles lagpoengmål.`,
        '',
        'Klikk på lenken nedenfor for å bekrefte e-posten din og aktivere kontoen din.',
        '',
        `Bekreft her: ${consentUrl}`,
        '',
        'Lenken er gyldig i 7 dager.',
      ].join('\n'),
    html: (safeScreenName, safeTeamName, safeUrl, subject) => `<!DOCTYPE html>
<html lang="nb">
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bekreft kontoen din</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                Nesten ferdig! Du har blitt med i <strong>${safeTeamName}</strong> på SkillStreak
                som <strong>${safeScreenName}</strong> — en app for daglige treningsstreaker og et felles lagpoengmål.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Klikk på knappen nedenfor for å bekrefte e-posten din og begynne å logge treningsøkter.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Bekreft kontoen min
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Lenken er gyldig i 7 dager. Fungerer ikke knappen, kopier denne adressen til nettleseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
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
  de: {
    subject: (teamName) =>
      `Bestätige dein Konto für ${teamName} auf SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hallo!',
        '',
        `Fast geschafft! Du bist ${teamName} auf SkillStreak beigetreten — einer App für tägliche Trainings-Streaks und ein gemeinsames Team-Punkteziel.`,
        '',
        'Klicke auf den Link unten, um deine E-Mail-Adresse zu bestätigen und dein Konto zu aktivieren.',
        '',
        `Hier bestätigen: ${consentUrl}`,
        '',
        'Der Link ist 7 Tage gültig.',
      ].join('\n'),
    html: (safeScreenName, safeTeamName, safeUrl, subject) => `<!DOCTYPE html>
<html lang="de">
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bestätige dein Konto</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                Fast geschafft! Du bist <strong>${safeTeamName}</strong> auf SkillStreak beigetreten
                als <strong>${safeScreenName}</strong> — einer App für tägliche Trainings-Streaks und ein gemeinsames Team-Punkteziel.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Klicke auf den Button unten, um deine E-Mail-Adresse zu bestätigen und mit dem Eintragen von Trainingseinheiten zu beginnen.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Mein Konto bestätigen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Der Link ist 7 Tage gültig. Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
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
  cs: {
    subject: (teamName) =>
      `Ověřte svůj účet pro tým ${teamName} na SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Ahoj!',
        '',
        `Už téměř hotovo! Připojil(a) ses k týmu ${teamName} na SkillStreak — aplikaci pro denní tréninkové série a společný týmový bodový cíl.`,
        '',
        'Klikni na odkaz níže a ověř svou e-mailovou adresu, abys aktivoval(a) svůj účet.',
        '',
        `Ověřit zde: ${consentUrl}`,
        '',
        'Odkaz je platný 7 dní.',
      ].join('\n'),
    html: (safeScreenName, safeTeamName, safeUrl, subject) => `<!DOCTYPE html>
<html lang="cs">
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Ověřte svůj účet</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                Už téměř hotovo! Připojil(a) ses k týmu <strong>${safeTeamName}</strong> na SkillStreak
                jako <strong>${safeScreenName}</strong> — aplikaci pro denní tréninkové série a společný týmový bodový cíl.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Klikni na tlačítko níže a ověř svou e-mailovou adresu, abys mohl(a) začít zaznamenávat tréninky.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Ověřit můj účet
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Odkaz je platný 7 dní. Pokud tlačítko nefunguje, zkopírujte tuto adresu do prohlížeče:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
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
  fr: {
    subject: (teamName) =>
      `Vérifiez votre compte pour ${teamName} sur SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Bonjour !',
        '',
        `Presque terminé ! Vous avez rejoint ${teamName} sur SkillStreak — une application pour des séries d'entraînement quotidiennes et un objectif de points d'équipe commun.`,
        '',
        'Cliquez sur le lien ci-dessous pour vérifier votre adresse e-mail et activer votre compte.',
        '',
        `Vérifier ici : ${consentUrl}`,
        '',
        'Le lien est valable 7 jours.',
      ].join('\n'),
    html: (safeScreenName, safeTeamName, safeUrl, subject) => `<!DOCTYPE html>
<html lang="fr">
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Vérifiez votre compte</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                Presque terminé ! Vous avez rejoint <strong>${safeTeamName}</strong> sur SkillStreak
                sous le nom <strong>${safeScreenName}</strong> — une application pour des séries d'entraînement quotidiennes et un objectif de points d'équipe commun.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Cliquez sur le bouton ci-dessous pour vérifier votre adresse e-mail et commencer à enregistrer vos séances d'entraînement.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Vérifier mon compte
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Le lien est valable 7 jours. Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br />
                <span style="word-break:break-all;">${safeUrl}</span>
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
};

function resolveCopy(locale: PlayerLocale): LocaleCopy {
  return COPY[locale] ?? COPY.sv!; // never renders blank/broken
}

export function buildSelfVerificationEmail(
  input: SelfVerificationEmailInput,
): RenderedEmail {
  const { screenName, teamName, consentUrl, locale } = input;
  const copy = resolveCopy(locale);

  const subject = copy.subject(teamName);
  const text = copy.text(screenName, teamName, consentUrl);

  const safeScreenName = escapeHtml(screenName);
  const safeTeamName = escapeHtml(teamName);
  const safeUrl = escapeHtml(consentUrl);

  const html = copy.html(safeScreenName, safeTeamName, safeUrl, subject);

  return { subject, html, text };
}
