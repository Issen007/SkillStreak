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

// en/fi/da/nb/de/cs/fr translations below are AI-generated (this session),
// not sourced from a professional/native-speaker translator — recommend a
// native-speaker review pass before relying on this for real families,
// especially given this template's GDPR consent context.
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
  en: {
    subject: (screenName, teamName) =>
      `${screenName} wants to join ${teamName} on SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hi there!',
        '',
        `${screenName} wants to join ${teamName} on SkillStreak — an app for daily training streaks and a shared team point goal.`,
        '',
        `If you approve, ${screenName} can start logging training sessions and see the team's shared points (the "VM-Guld" meter).`,
        '',
        `Approve here: ${consentUrl}`,
        '',
        'The link is valid for 7 days. Questions? Get in touch with the coach.',
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Approval for ${safeScreenName}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong> wants to join <strong>${safeTeamName}</strong> on SkillStreak
                — an app for daily training streaks and a shared team point goal.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                If you approve, ${safeScreenName} can start logging training sessions and see the team's shared points.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Approve ${safeScreenName}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                The link is valid for 7 days. If the button doesn't work, copy this address into your browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Questions? Get in touch with the coach.
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
    subject: (screenName, teamName) =>
      `${screenName} haluaa liittyä joukkueeseen ${teamName} SkillStreakissa`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hei!',
        '',
        `${screenName} haluaa liittyä joukkueeseen ${teamName} SkillStreakissa — sovellukseen, jossa harjoitellaan päivittäin putkeen ja kerätään yhteistä joukkuepistemäärää.`,
        '',
        `Jos hyväksyt, ${screenName} voi alkaa kirjata harjoituksia ja seurata joukkueen yhteisiä pisteitä ("VM-Guld"-mittaria).`,
        '',
        `Hyväksy täällä: ${consentUrl}`,
        '',
        'Linkki on voimassa 7 päivää. Jos sinulla on kysyttävää, ota yhteyttä valmentajaan.',
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Hyväksyntä pelaajalle ${safeScreenName}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong> haluaa liittyä joukkueeseen <strong>${safeTeamName}</strong> SkillStreakissa
                — sovellukseen, jossa harjoitellaan päivittäin putkeen ja kerätään yhteistä joukkuepistemäärää.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Jos hyväksyt, ${safeScreenName} voi alkaa kirjata harjoituksia ja seurata joukkueen yhteisiä pisteitä.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Hyväksy ${safeScreenName}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Linkki on voimassa 7 päivää. Jos painike ei toimi, kopioi tämä osoite selaimeesi:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Onko sinulla kysyttävää? Ota yhteyttä valmentajaan.
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
    subject: (screenName, teamName) =>
      `${screenName} vil gerne være med i ${teamName} på SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hej!',
        '',
        `${screenName} vil gerne være med i ${teamName} på SkillStreak — en app til daglige træningsstreaks og et fælles holdpoint-mål.`,
        '',
        `Hvis du godkender det, kan ${screenName} begynde at logge træningspas og se holdets fælles point ("VM-Guld"-måleren).`,
        '',
        `Godkend her: ${consentUrl}`,
        '',
        'Linket er gyldigt i 7 dage. Har du spørgsmål, så kontakt træneren.',
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Godkendelse for ${safeScreenName}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong> vil gerne være med i <strong>${safeTeamName}</strong> på SkillStreak
                — en app til daglige træningsstreaks og et fælles holdpoint-mål.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Hvis du godkender det, kan ${safeScreenName} begynde at logge træningspas og se holdets fælles point.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Godkend ${safeScreenName}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Linket er gyldigt i 7 dage. Virker knappen ikke, så kopiér denne adresse til browseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Har du spørgsmål? Kontakt træneren.
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
    subject: (screenName, teamName) =>
      `${screenName} vil bli med i ${teamName} på SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hei!',
        '',
        `${screenName} vil bli med i ${teamName} på SkillStreak — en app for daglige treningsstreaker og et felles lagpoengmål.`,
        '',
        `Hvis du godkjenner, kan ${screenName} begynne å logge treningsøkter og se lagets felles poeng ("VM-Guld"-måleren).`,
        '',
        `Godkjenn her: ${consentUrl}`,
        '',
        'Lenken er gyldig i 7 dager. Har du spørsmål, ta kontakt med treneren.',
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Godkjenning for ${safeScreenName}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong> vil bli med i <strong>${safeTeamName}</strong> på SkillStreak
                — en app for daglige treningsstreaker og et felles lagpoengmål.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Hvis du godkjenner, kan ${safeScreenName} begynne å logge treningsøkter og se lagets felles poeng.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Godkjenn ${safeScreenName}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Lenken er gyldig i 7 dager. Fungerer ikke knappen, kopier denne adressen til nettleseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Har du spørsmål? Ta kontakt med treneren.
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
    subject: (screenName, teamName) =>
      `${screenName} möchte ${teamName} auf SkillStreak beitreten`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Hallo!',
        '',
        `${screenName} möchte ${teamName} auf SkillStreak beitreten — einer App für tägliche Trainings-Streaks und ein gemeinsames Team-Punkteziel.`,
        '',
        `Wenn du zustimmst, kann ${screenName} ab sofort Trainingseinheiten eintragen und die gemeinsamen Punkte des Teams sehen (die „VM-Guld"-Anzeige).`,
        '',
        `Hier zustimmen: ${consentUrl}`,
        '',
        'Der Link ist 7 Tage gültig. Bei Fragen wende dich bitte an den Trainer bzw. die Trainerin.',
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Zustimmung für ${safeScreenName}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong> möchte <strong>${safeTeamName}</strong> auf SkillStreak beitreten
                — einer App für tägliche Trainings-Streaks und ein gemeinsames Team-Punkteziel.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Wenn du zustimmst, kann ${safeScreenName} ab sofort Trainingseinheiten eintragen und die gemeinsamen Punkte des Teams sehen.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      ${safeScreenName} zustimmen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Der Link ist 7 Tage gültig. Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Fragen? Wende dich an den Trainer bzw. die Trainerin.
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
    subject: (screenName, teamName) =>
      `${screenName} se chce připojit k týmu ${teamName} na SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Ahoj!',
        '',
        `${screenName} se chce připojit k týmu ${teamName} na SkillStreak — aplikaci pro denní tréninkové série a společný týmový bodový cíl.`,
        '',
        `Pokud souhlasíte, ${screenName} může začít zaznamenávat tréninky a sledovat společné body týmu (ukazatel „VM-Guld").`,
        '',
        `Souhlasit zde: ${consentUrl}`,
        '',
        'Odkaz je platný 7 dní. Máte-li dotazy, ozvěte se trenérovi.',
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Souhlas pro ${safeScreenName}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong> se chce připojit k týmu <strong>${safeTeamName}</strong> na SkillStreak
                — aplikaci pro denní tréninkové série a společný týmový bodový cíl.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Pokud souhlasíte, ${safeScreenName} může začít zaznamenávat tréninky a sledovat společné body týmu.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Souhlasím za ${safeScreenName}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Odkaz je platný 7 dní. Pokud tlačítko nefunguje, zkopírujte tuto adresu do prohlížeče:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Máte dotazy? Ozvěte se trenérovi.
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
    subject: (screenName, teamName) =>
      `${screenName} souhaite rejoindre ${teamName} sur SkillStreak`,
    text: (screenName, teamName, consentUrl) =>
      [
        'Bonjour !',
        '',
        `${screenName} souhaite rejoindre ${teamName} sur SkillStreak — une application pour des séries d'entraînement quotidiennes et un objectif de points d'équipe commun.`,
        '',
        `Si vous approuvez, ${screenName} pourra commencer à enregistrer ses séances d'entraînement et voir les points communs de l'équipe (le compteur « VM-Guld »).`,
        '',
        `Approuver ici : ${consentUrl}`,
        '',
        "Le lien est valable 7 jours. Des questions ? Contactez l'entraîneur.",
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Approbation pour ${safeScreenName}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong> souhaite rejoindre <strong>${safeTeamName}</strong> sur SkillStreak
                — une application pour des séries d'entraînement quotidiennes et un objectif de points d'équipe commun.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
                Si vous approuvez, ${safeScreenName} pourra commencer à enregistrer ses séances d'entraînement et voir les points communs de l'équipe.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Approuver pour ${safeScreenName}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Le lien est valable 7 jours. Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Des questions ? Contactez l'entraîneur.
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
