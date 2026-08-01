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

// en/fi/da/nb/de/cs/fr translations below are AI-generated (this session),
// not sourced from a professional/native-speaker translator — recommend a
// native-speaker review pass before relying on this for real families.
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
  en: {
    subject: `Code to log back in to SkillStreak`,
    text: (screenName, teamName, code, expiresInMinutes) =>
      [
        'Hi there!',
        '',
        `Someone has requested a new login for ${screenName} in ${teamName} on SkillStreak, because the old session no longer works (e.g. a new phone or a reinstalled app).`,
        '',
        `Code: ${code}`,
        '',
        `Open the app (or the website), choose "Already have an account?" and enter the code above. The code is valid for ${expiresInMinutes} minutes and can only be used once.`,
        '',
        "Wasn't this you or your child? Ignore this email — the code will expire automatically and nothing will happen to the account.",
      ].join('\n'),
    html: (
      safeScreenName,
      safeTeamName,
      safeCode,
      expiresInMinutes,
      subject,
    ) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Log back in</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Someone has requested a new login for <strong>${safeScreenName}</strong> in
                <strong>${safeTeamName}</strong> on SkillStreak, because the old session
                no longer works (e.g. a new phone or a reinstalled app).
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Open the app (or the website), choose <strong>"Already have an account?"</strong> and
                enter the code above. Valid for ${expiresInMinutes} minutes, can only be used
                once.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Wasn't this you or your child? Ignore this email — the code will expire
                automatically and nothing will happen to the account.
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
    subject: `Koodi kirjautuaksesi uudelleen SkillStreakiin`,
    text: (screenName, teamName, code, expiresInMinutes) =>
      [
        'Hei!',
        '',
        `Joku on pyytänyt uutta kirjautumista pelaajalle ${screenName} joukkueessa ${teamName} SkillStreakissa, koska vanha istunto ei enää toimi (esim. uusi puhelin tai sovellus asennettiin uudelleen).`,
        '',
        `Koodi: ${code}`,
        '',
        `Avaa sovellus (tai sivusto), valitse "Onko sinulla jo tili?" ja syötä yllä oleva koodi. Koodi on voimassa ${expiresInMinutes} minuuttia ja sen voi käyttää vain kerran.`,
        '',
        'Etkö pyytänyt tätä sinä tai lapsesi? Jätä tämä viesti huomiotta — koodi vanhenee automaattisesti eikä tilille tapahdu mitään.',
      ].join('\n'),
    html: (
      safeScreenName,
      safeTeamName,
      safeCode,
      expiresInMinutes,
      subject,
    ) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kirjaudu uudelleen</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Joku on pyytänyt uutta kirjautumista pelaajalle <strong>${safeScreenName}</strong>
                joukkueessa <strong>${safeTeamName}</strong> SkillStreakissa, koska vanha istunto
                ei enää toimi (esim. uusi puhelin tai sovellus asennettiin uudelleen).
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Avaa sovellus (tai sivusto), valitse <strong>"Onko sinulla jo tili?"</strong> ja
                syötä yllä oleva koodi. Voimassa ${expiresInMinutes} minuuttia, voidaan käyttää
                vain kerran.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Etkö pyytänyt tätä sinä tai lapsesi? Jätä tämä viesti huomiotta — koodi vanhenee
                automaattisesti eikä tilille tapahdu mitään.
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
    subject: `Kode til at logge ind igen på SkillStreak`,
    text: (screenName, teamName, code, expiresInMinutes) =>
      [
        'Hej!',
        '',
        `Nogen har bedt om et nyt login til ${screenName} i ${teamName} på SkillStreak, fordi den gamle session ikke længere virker (f.eks. ny telefon eller geninstalleret app).`,
        '',
        `Kode: ${code}`,
        '',
        `Åbn appen (eller sitet), vælg "Har du allerede en konto?" og indtast koden ovenfor. Koden er gyldig i ${expiresInMinutes} minutter og kan kun bruges én gang.`,
        '',
        'Var det ikke dig eller dit barn, der bad om dette? Ignorér denne mail — koden udløber automatisk, og der sker intet med kontoen.',
      ].join('\n'),
    html: (
      safeScreenName,
      safeTeamName,
      safeCode,
      expiresInMinutes,
      subject,
    ) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Log ind igen</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Nogen har bedt om et nyt login til <strong>${safeScreenName}</strong> i
                <strong>${safeTeamName}</strong> på SkillStreak, fordi den gamle session ikke
                længere virker (f.eks. ny telefon eller geninstalleret app).
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Åbn appen (eller sitet), vælg <strong>"Har du allerede en konto?"</strong> og
                indtast koden ovenfor. Gyldig i ${expiresInMinutes} minutter, kan kun bruges
                én gang.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det ikke dig eller dit barn, der bad om dette? Ignorér denne mail — koden
                udløber automatisk, og der sker intet med kontoen.
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
    subject: `Kode for å logge inn igjen på SkillStreak`,
    text: (screenName, teamName, code, expiresInMinutes) =>
      [
        'Hei!',
        '',
        `Noen har bedt om en ny innlogging for ${screenName} i ${teamName} på SkillStreak, fordi den gamle økten ikke lenger fungerer (f.eks. ny telefon eller ominstallert app).`,
        '',
        `Kode: ${code}`,
        '',
        `Åpne appen (eller nettsiden), velg "Har du allerede en konto?" og skriv inn koden over. Koden er gyldig i ${expiresInMinutes} minutter og kan bare brukes én gang.`,
        '',
        'Var det ikke deg eller barnet ditt som ba om dette? Ignorer denne e-posten — koden slutter å gjelde automatisk, og ingenting skjer med kontoen.',
      ].join('\n'),
    html: (
      safeScreenName,
      safeTeamName,
      safeCode,
      expiresInMinutes,
      subject,
    ) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Logg inn igjen</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Noen har bedt om en ny innlogging for <strong>${safeScreenName}</strong> i
                <strong>${safeTeamName}</strong> på SkillStreak, fordi den gamle økten ikke
                lenger fungerer (f.eks. ny telefon eller ominstallert app).
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Åpne appen (eller nettsiden), velg <strong>"Har du allerede en konto?"</strong> og
                skriv inn koden over. Gyldig i ${expiresInMinutes} minutter, kan bare brukes
                én gang.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det ikke deg eller barnet ditt som ba om dette? Ignorer denne e-posten —
                koden slutter å gjelde automatisk, og ingenting skjer med kontoen.
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
    subject: `Code zum erneuten Anmelden bei SkillStreak`,
    text: (screenName, teamName, code, expiresInMinutes) =>
      [
        'Hallo!',
        '',
        `Jemand hat eine neue Anmeldung für ${screenName} im Team ${teamName} auf SkillStreak angefordert, da die alte Sitzung nicht mehr funktioniert (z. B. neues Telefon oder neu installierte App).`,
        '',
        `Code: ${code}`,
        '',
        `Öffne die App (oder die Website), wähle „Hast du schon ein Konto?" und gib den obigen Code ein. Der Code ist ${expiresInMinutes} Minuten gültig und kann nur einmal verwendet werden.`,
        '',
        'War das nicht du oder dein Kind? Ignoriere diese E-Mail — der Code läuft automatisch ab, und mit dem Konto passiert nichts.',
      ].join('\n'),
    html: (
      safeScreenName,
      safeTeamName,
      safeCode,
      expiresInMinutes,
      subject,
    ) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Erneut anmelden</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Jemand hat eine neue Anmeldung für <strong>${safeScreenName}</strong> im Team
                <strong>${safeTeamName}</strong> auf SkillStreak angefordert, da die alte
                Sitzung nicht mehr funktioniert (z. B. neues Telefon oder neu installierte App).
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Öffne die App (oder die Website), wähle <strong>„Hast du schon ein Konto?"</strong> und
                gib den obigen Code ein. Gültig für ${expiresInMinutes} Minuten, nur einmal
                verwendbar.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                War das nicht du oder dein Kind? Ignoriere diese E-Mail — der Code läuft
                automatisch ab, und mit dem Konto passiert nichts.
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
    subject: `Kód pro opětovné přihlášení na SkillStreak`,
    text: (screenName, teamName, code, expiresInMinutes) =>
      [
        'Ahoj!',
        '',
        `Někdo požádal o nové přihlášení pro ${screenName} v týmu ${teamName} na SkillStreak, protože stará relace už nefunguje (např. nový telefon nebo přeinstalovaná aplikace).`,
        '',
        `Kód: ${code}`,
        '',
        `Otevřete aplikaci (nebo web), vyberte „Už máte účet?" a zadejte kód uvedený výše. Kód je platný ${expiresInMinutes} minut a lze jej použít pouze jednou.`,
        '',
        'Nebyli jste to vy nebo vaše dítě, kdo o to požádal? Tento e-mail ignorujte — platnost kódu automaticky vyprší a s účtem se nic nestane.',
      ].join('\n'),
    html: (
      safeScreenName,
      safeTeamName,
      safeCode,
      expiresInMinutes,
      subject,
    ) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Přihlaste se znovu</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Někdo požádal o nové přihlášení pro <strong>${safeScreenName}</strong> v týmu
                <strong>${safeTeamName}</strong> na SkillStreak, protože stará relace už
                nefunguje (např. nový telefon nebo přeinstalovaná aplikace).
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Otevřete aplikaci (nebo web), vyberte <strong>„Už máte účet?"</strong> a zadejte
                kód uvedený výše. Platný ${expiresInMinutes} minut, lze použít pouze jednou.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Nebyli jste to vy nebo vaše dítě, kdo o to požádal? Tento e-mail ignorujte —
                platnost kódu automaticky vyprší a s účtem se nic nestane.
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
    subject: `Code pour vous reconnecter à SkillStreak`,
    text: (screenName, teamName, code, expiresInMinutes) =>
      [
        'Bonjour !',
        '',
        `Quelqu'un a demandé une nouvelle connexion pour ${screenName} dans ${teamName} sur SkillStreak, car l'ancienne session ne fonctionne plus (par exemple un nouveau téléphone ou une application réinstallée).`,
        '',
        `Code : ${code}`,
        '',
        `Ouvrez l'application (ou le site), choisissez « Vous avez déjà un compte ? » et saisissez le code ci-dessus. Le code est valable ${expiresInMinutes} minutes et ne peut être utilisé qu'une seule fois.`,
        '',
        "Ce n'était pas vous ou votre enfant ? Ignorez cet e-mail — le code expirera automatiquement et rien ne se passera avec le compte.",
      ].join('\n'),
    html: (
      safeScreenName,
      safeTeamName,
      safeCode,
      expiresInMinutes,
      subject,
    ) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Reconnectez-vous</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Quelqu'un a demandé une nouvelle connexion pour <strong>${safeScreenName}</strong>
                dans <strong>${safeTeamName}</strong> sur SkillStreak, car l'ancienne session ne
                fonctionne plus (par exemple un nouveau téléphone ou une application réinstallée).
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Ouvrez l'application (ou le site), choisissez <strong>« Vous avez déjà un compte ? »</strong> et
                saisissez le code ci-dessus. Valable ${expiresInMinutes} minutes, utilisable une
                seule fois.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Ce n'était pas vous ou votre enfant ? Ignorez cet e-mail — le code expirera
                automatiquement et rien ne se passera avec le compte.
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
