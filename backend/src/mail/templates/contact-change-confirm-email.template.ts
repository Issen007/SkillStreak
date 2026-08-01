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

// en/fi/da/nb/de/cs/fr translations below are AI-generated (this session),
// not sourced from a professional/native-speaker translator — recommend a
// native-speaker review pass before relying on this for real families.
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
  en: {
    subject: 'Confirm new contact address on SkillStreak',
    text: (screenName, code, expiresInMinutes) =>
      [
        'Hi there!',
        '',
        `This address is about to become the new contact address for ${screenName}'s account on SkillStreak.`,
        '',
        `Code: ${code}`,
        '',
        `Enter the code in the app (or on the website) to confirm the change. The code is valid for ${expiresInMinutes} minutes and can only be used once.`,
        '',
        "Wasn't this you? Ignore this email — the code will expire automatically and nothing will change.",
      ].join('\n'),
    html: (
      safeScreenName,
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Confirm new contact address</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                This address is about to become the new contact address for
                <strong>${safeScreenName}</strong>'s account on SkillStreak.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Enter the code in the app (or on the website) to confirm the change. Valid for
                ${expiresInMinutes} minutes, can only be used once.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Wasn't this you? Ignore this email — the code will expire automatically and
                nothing will change.
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
    subject: 'Vahvista uusi yhteystiedon osoite SkillStreakissa',
    text: (screenName, code, expiresInMinutes) =>
      [
        'Hei!',
        '',
        `Tästä osoitteesta on tulossa ${screenName}n tilin uusi yhteystieto-osoite SkillStreakissa.`,
        '',
        `Koodi: ${code}`,
        '',
        `Vahvista muutos syöttämällä koodi sovellukseen (tai sivustolle). Koodi on voimassa ${expiresInMinutes} minuuttia ja sen voi käyttää vain kerran.`,
        '',
        'Etkö pyytänyt tätä? Jätä tämä viesti huomiotta — koodi vanhenee automaattisesti eikä mikään muutu.',
      ].join('\n'),
    html: (
      safeScreenName,
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Vahvista uusi yhteystieto-osoite</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Tästä osoitteesta on tulossa <strong>${safeScreenName}</strong>n tilin uusi
                yhteystieto-osoite SkillStreakissa.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Vahvista muutos syöttämällä koodi sovellukseen (tai sivustolle). Voimassa
                ${expiresInMinutes} minuuttia, voidaan käyttää vain kerran.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Etkö pyytänyt tätä? Jätä tämä viesti huomiotta — koodi vanhenee automaattisesti
                eikä mikään muutu.
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
    subject: 'Bekræft ny kontaktadresse på SkillStreak',
    text: (screenName, code, expiresInMinutes) =>
      [
        'Hej!',
        '',
        `Denne adresse er ved at blive den nye kontaktadresse for ${screenName}s konto på SkillStreak.`,
        '',
        `Kode: ${code}`,
        '',
        `Indtast koden i appen (eller på sitet) for at bekræfte ændringen. Koden er gyldig i ${expiresInMinutes} minutter og kan kun bruges én gang.`,
        '',
        'Var det ikke dig? Ignorér denne mail — koden udløber automatisk, og der sker ingen ændringer.',
      ].join('\n'),
    html: (
      safeScreenName,
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bekræft ny kontaktadresse</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Denne adresse er ved at blive den nye kontaktadresse for
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
                Indtast koden i appen (eller på sitet) for at bekræfte ændringen. Gyldig i
                ${expiresInMinutes} minutter, kan kun bruges én gang.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det ikke dig? Ignorér denne mail — koden udløber automatisk, og der sker
                ingen ændringer.
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
    subject: 'Bekreft ny kontaktadresse på SkillStreak',
    text: (screenName, code, expiresInMinutes) =>
      [
        'Hei!',
        '',
        `Denne adressen er i ferd med å bli den nye kontaktadressen for ${screenName}s konto på SkillStreak.`,
        '',
        `Kode: ${code}`,
        '',
        `Skriv inn koden i appen (eller på nettsiden) for å bekrefte endringen. Koden er gyldig i ${expiresInMinutes} minutter og kan bare brukes én gang.`,
        '',
        'Var det ikke deg som ba om dette? Ignorer denne e-posten — koden slutter å gjelde automatisk, og ingenting endres.',
      ].join('\n'),
    html: (
      safeScreenName,
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bekreft ny kontaktadresse</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Denne adressen er i ferd med å bli den nye kontaktadressen for
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
                Skriv inn koden i appen (eller på nettsiden) for å bekrefte endringen. Gyldig i
                ${expiresInMinutes} minutter, kan bare brukes én gang.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det ikke deg som ba om dette? Ignorer denne e-posten — koden slutter å
                gjelde automatisk, og ingenting endres.
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
    subject: 'Neue Kontaktadresse auf SkillStreak bestätigen',
    text: (screenName, code, expiresInMinutes) =>
      [
        'Hallo!',
        '',
        `Diese Adresse wird bald die neue Kontaktadresse für das Konto von ${screenName} auf SkillStreak.`,
        '',
        `Code: ${code}`,
        '',
        `Gib den Code in der App (oder auf der Website) ein, um die Änderung zu bestätigen. Der Code ist ${expiresInMinutes} Minuten gültig und kann nur einmal verwendet werden.`,
        '',
        'War das nicht du? Ignoriere diese E-Mail — der Code läuft automatisch ab, und es ändert sich nichts.',
      ].join('\n'),
    html: (
      safeScreenName,
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Neue Kontaktadresse bestätigen</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Diese Adresse wird bald die neue Kontaktadresse für das Konto von
                <strong>${safeScreenName}</strong> auf SkillStreak.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Gib den Code in der App (oder auf der Website) ein, um die Änderung zu bestätigen.
                Gültig für ${expiresInMinutes} Minuten, nur einmal verwendbar.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                War das nicht du? Ignoriere diese E-Mail — der Code läuft automatisch ab, und
                es ändert sich nichts.
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
    subject: 'Potvrďte novou kontaktní adresu na SkillStreak',
    text: (screenName, code, expiresInMinutes) =>
      [
        'Ahoj!',
        '',
        `Tato adresa se stává novou kontaktní adresou pro účet uživatele ${screenName} na SkillStreak.`,
        '',
        `Kód: ${code}`,
        '',
        `Zadejte kód v aplikaci (nebo na webu) pro potvrzení změny. Kód je platný ${expiresInMinutes} minut a lze jej použít pouze jednou.`,
        '',
        'Nebyli jste to vy? Tento e-mail ignorujte — platnost kódu automaticky vyprší a nic se nezmění.',
      ].join('\n'),
    html: (
      safeScreenName,
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Potvrďte novou kontaktní adresu</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Tato adresa se stává novou kontaktní adresou pro účet uživatele
                <strong>${safeScreenName}</strong> na SkillStreak.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Zadejte kód v aplikaci (nebo na webu) pro potvrzení změny. Platný
                ${expiresInMinutes} minut, lze použít pouze jednou.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Nebyli jste to vy? Tento e-mail ignorujte — platnost kódu automaticky vyprší
                a nic se nezmění.
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
    subject: 'Confirmez la nouvelle adresse de contact sur SkillStreak',
    text: (screenName, code, expiresInMinutes) =>
      [
        'Bonjour !',
        '',
        `Cette adresse est en passe de devenir la nouvelle adresse de contact du compte de ${screenName} sur SkillStreak.`,
        '',
        `Code : ${code}`,
        '',
        `Saisissez le code dans l'application (ou sur le site) pour confirmer le changement. Le code est valable ${expiresInMinutes} minutes et ne peut être utilisé qu'une seule fois.`,
        '',
        "Ce n'était pas vous ? Ignorez cet e-mail — le code expirera automatiquement et rien ne changera.",
      ].join('\n'),
    html: (
      safeScreenName,
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Confirmez la nouvelle adresse de contact</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Cette adresse est en passe de devenir la nouvelle adresse de contact du compte de
                <strong>${safeScreenName}</strong> sur SkillStreak.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#FAFAF7;border-radius:12px;padding:20px;">
                    <span style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#1B1B3A;">${safeCode}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Saisissez le code dans l'application (ou sur le site) pour confirmer le
                changement. Valable ${expiresInMinutes} minutes, utilisable une seule fois.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Ce n'était pas vous ? Ignorez cet e-mail — le code expirera automatiquement et
                rien ne changera.
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
