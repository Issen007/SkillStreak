// docs/adr/0012-profile-page-and-contact-email-change.md's addendum
// (security-reviewer finding, 2026-07-28) — sent to the OLD address once
// the new-address code is confirmed, not at request time. Unlike
// contact-change-notify-old-email.template.ts (purely informational,
// sent at request time, before anything concrete exists to act on), this
// one carries a real, actionable cancel link: the change is now in a
// 24h grace period, and this is the only way to stop it.
//
// A clickable link, not a code to type into the app — unlike the confirm
// email (session-reissue-style, expects the same device/person who's
// already using the app), the OLD address might belong to someone who
// isn't the one holding the phone with the app on it at all (a parent
// checking email on a laptop, say). Same reasoning as the parental-
// consent link's own GET-preview/POST-confirm web page, not an app
// screen — see ProfileController/contact-change-cancel-page.templates.ts.
//
// docs/adr/0014-multi-language-support.md Decision 3 — same `COPY`/
// `resolveCopy` fallback pattern as every other template in this
// directory; see consent-request-email.template.ts's comment for the full
// reasoning. Caller (ProfileService) already has the player's own Player
// row in hand, so `locale` comes from `player.locale` — no new query
// needed.

import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface ContactChangeCancelEmailInput {
  screenName: string;
  cancelUrl: string;
  graceHours: number;
  locale: PlayerLocale;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LocaleCopy {
  subject: (screenName: string) => string;
  text: (screenName: string, cancelUrl: string, graceHours: number) => string;
  html: (
    safeScreenName: string,
    safeUrl: string,
    graceHours: number,
    subject: string,
  ) => string;
}

// en/fi/da/nb/de/cs/fr translations below are AI-generated (this session),
// not sourced from a professional/native-speaker translator — recommend a
// native-speaker review pass before relying on this for real families.
const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: {
    subject: (screenName) =>
      `Bekräftat: kontaktadressen för ${screenName}s konto byts snart`,
    text: (screenName, cancelUrl, graceHours) =>
      [
        'Hej!',
        '',
        `Bytet av kontaktadress för ${screenName}s konto på SkillStreak har bekräftats och träder i kraft om ${graceHours} timmar.`,
        '',
        'Var det inte du (eller din förälder) som gjorde detta?',
        '',
        `Avbryt här: ${cancelUrl}`,
        '',
        'Det loggar också ut alla aktiva sessioner på kontot, så den som gjorde ändringen loggas ut.',
        '',
        'Var det du själv? Då behöver du inte göra något — bytet slutförs automatiskt.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, graceHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktadressen byts snart</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Bytet av kontaktadress för <strong>${safeScreenName}</strong>s konto på SkillStreak
                har bekräftats och träder i kraft om ${graceHours} timmar.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Var det inte du (eller din förälder) som gjorde detta?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Avbryt bytet
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Det loggar också ut alla aktiva sessioner på kontot. Fungerar knappen inte,
                kopiera denna adress till webbläsaren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det du själv? Då behöver du inte göra något — bytet slutförs automatiskt.
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
    subject: (screenName) =>
      `Confirmed: the contact address for ${screenName}'s account is changing soon`,
    text: (screenName, cancelUrl, graceHours) =>
      [
        'Hi there!',
        '',
        `The contact-address change for ${screenName}'s account on SkillStreak has been confirmed and takes effect in ${graceHours} hours.`,
        '',
        "Wasn't this you (or your parent)?",
        '',
        `Cancel here: ${cancelUrl}`,
        '',
        'This also logs out every active session on the account, so whoever made the change will be signed out.',
        '',
        "Was this you? Then you don't need to do anything — the change completes automatically.",
      ].join('\n'),
    html: (safeScreenName, safeUrl, graceHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">The contact address is changing soon</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                The contact-address change for <strong>${safeScreenName}</strong>'s account on SkillStreak
                has been confirmed and takes effect in ${graceHours} hours.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Wasn't this you (or your parent)?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Cancel the change
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                This also logs out every active session on the account. If the button doesn't
                work, copy this address into your browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Was this you? Then you don't need to do anything — the change completes
                automatically.
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
    subject: (screenName) =>
      `Vahvistettu: ${screenName}n tilin yhteystiedon osoite vaihtuu pian`,
    text: (screenName, cancelUrl, graceHours) =>
      [
        'Hei!',
        '',
        `${screenName}n tilin yhteystieto-osoitteen vaihto SkillStreakissa on vahvistettu ja tulee voimaan ${graceHours} tunnin kuluttua.`,
        '',
        'Etkö ollut tämä sinä (tai vanhempasi)?',
        '',
        `Peruuta täällä: ${cancelUrl}`,
        '',
        'Tämä kirjaa myös ulos kaikki tilin aktiiviset kirjautumiset, jolloin muutoksen tehnyt kirjautuu ulos.',
        '',
        'Olitko tämä sinä? Silloin sinun ei tarvitse tehdä mitään — vaihto tapahtuu automaattisesti.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, graceHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Yhteystiedon osoite vaihtuu pian</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong>n tilin yhteystieto-osoitteen vaihto SkillStreakissa
                on vahvistettu ja tulee voimaan ${graceHours} tunnin kuluttua.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Etkö ollut tämä sinä (tai vanhempasi)?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Peruuta vaihto
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Tämä kirjaa myös ulos kaikki tilin aktiiviset kirjautumiset. Jos painike ei
                toimi, kopioi tämä osoite selaimeesi:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Olitko tämä sinä? Silloin sinun ei tarvitse tehdä mitään — vaihto tapahtuu
                automaattisesti.
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
    subject: (screenName) =>
      `Bekræftet: kontaktadressen for ${screenName}s konto skiftes snart`,
    text: (screenName, cancelUrl, graceHours) =>
      [
        'Hej!',
        '',
        `Skiftet af kontaktadresse for ${screenName}s konto på SkillStreak er blevet bekræftet og træder i kraft om ${graceHours} timer.`,
        '',
        'Var det ikke dig (eller din forælder), der gjorde dette?',
        '',
        `Annuller her: ${cancelUrl}`,
        '',
        'Det logger også alle aktive sessioner på kontoen ud, så den, der foretog ændringen, bliver logget ud.',
        '',
        'Var det dig selv? Så behøver du ikke gøre noget — skiftet gennemføres automatisk.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, graceHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktadressen skiftes snart</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Skiftet af kontaktadresse for <strong>${safeScreenName}</strong>s konto på SkillStreak
                er blevet bekræftet og træder i kraft om ${graceHours} timer.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Var det ikke dig (eller din forælder), der gjorde dette?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Annuller skiftet
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Det logger også alle aktive sessioner på kontoen ud. Virker knappen ikke, så
                kopiér denne adresse til browseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det dig selv? Så behøver du ikke gøre noget — skiftet gennemføres automatisk.
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
    subject: (screenName) =>
      `Bekreftet: kontaktadressen for ${screenName}s konto byttes snart`,
    text: (screenName, cancelUrl, graceHours) =>
      [
        'Hei!',
        '',
        `Byttet av kontaktadresse for ${screenName}s konto på SkillStreak er bekreftet og trer i kraft om ${graceHours} timer.`,
        '',
        'Var det ikke deg (eller foresatte) som gjorde dette?',
        '',
        `Avbryt her: ${cancelUrl}`,
        '',
        'Dette logger også ut alle aktive økter på kontoen, slik at den som gjorde endringen blir logget ut.',
        '',
        'Var det deg selv? Da trenger du ikke gjøre noe — byttet fullføres automatisk.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, graceHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktadressen byttes snart</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Byttet av kontaktadresse for <strong>${safeScreenName}</strong>s konto på SkillStreak
                er bekreftet og trer i kraft om ${graceHours} timer.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Var det ikke deg (eller foresatte) som gjorde dette?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Avbryt byttet
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Dette logger også ut alle aktive økter på kontoen. Fungerer ikke knappen, kopier
                denne adressen til nettleseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det deg selv? Da trenger du ikke gjøre noe — byttet fullføres automatisk.
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
    subject: (screenName) =>
      `Bestätigt: die Kontaktadresse für das Konto von ${screenName} wird bald geändert`,
    text: (screenName, cancelUrl, graceHours) =>
      [
        'Hallo!',
        '',
        `Die Änderung der Kontaktadresse für das Konto von ${screenName} auf SkillStreak wurde bestätigt und tritt in ${graceHours} Stunden in Kraft.`,
        '',
        'War das nicht du (oder ein Elternteil)?',
        '',
        `Hier abbrechen: ${cancelUrl}`,
        '',
        'Dadurch werden außerdem alle aktiven Sitzungen des Kontos beendet, sodass diejenige Person, die die Änderung vorgenommen hat, abgemeldet wird.',
        '',
        'Warst du das selbst? Dann musst du nichts weiter tun — die Änderung wird automatisch abgeschlossen.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, graceHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Die Kontaktadresse wird bald geändert</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Die Änderung der Kontaktadresse für das Konto von <strong>${safeScreenName}</strong>
                auf SkillStreak wurde bestätigt und tritt in ${graceHours} Stunden in Kraft.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                War das nicht du (oder ein Elternteil)?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Änderung abbrechen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Dadurch werden außerdem alle aktiven Sitzungen des Kontos beendet. Falls der
                Button nicht funktioniert, kopiere diese Adresse in deinen Browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Warst du das selbst? Dann musst du nichts weiter tun — die Änderung wird
                automatisch abgeschlossen.
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
    subject: (screenName) =>
      `Potvrzeno: kontaktní adresa účtu uživatele ${screenName} se brzy změní`,
    text: (screenName, cancelUrl, graceHours) =>
      [
        'Ahoj!',
        '',
        `Změna kontaktní adresy účtu uživatele ${screenName} na SkillStreak byla potvrzena a nabude účinnosti za ${graceHours} hodin.`,
        '',
        'Nebyli jste to vy (nebo váš rodič)?',
        '',
        `Zrušit zde: ${cancelUrl}`,
        '',
        'Tím se také odhlásí všechna aktivní přihlášení na účtu, takže osoba, která změnu provedla, bude odhlášena.',
        '',
        'Byli jste to vy sami? Pak nemusíte nic dělat — změna se dokončí automaticky.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, graceHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktní adresa se brzy změní</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Změna kontaktní adresy účtu uživatele <strong>${safeScreenName}</strong> na SkillStreak
                byla potvrzena a nabude účinnosti za ${graceHours} hodin.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Nebyli jste to vy (nebo váš rodič)?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Zrušit změnu
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Tím se také odhlásí všechna aktivní přihlášení na účtu. Pokud tlačítko nefunguje,
                zkopírujte tuto adresu do prohlížeče:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Byli jste to vy sami? Pak nemusíte nic dělat — změna se dokončí automaticky.
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
    subject: (screenName) =>
      `Confirmé : l'adresse de contact du compte de ${screenName} change bientôt`,
    text: (screenName, cancelUrl, graceHours) =>
      [
        'Bonjour !',
        '',
        `Le changement d'adresse de contact du compte de ${screenName} sur SkillStreak a été confirmé et prendra effet dans ${graceHours} heures.`,
        '',
        "Ce n'était pas vous (ou votre parent) ?",
        '',
        `Annuler ici : ${cancelUrl}`,
        '',
        "Cela déconnecte également toutes les sessions actives du compte, afin que la personne à l'origine du changement soit déconnectée.",
        '',
        "C'était vous ? Vous n'avez alors rien à faire — le changement se termine automatiquement.",
      ].join('\n'),
    html: (safeScreenName, safeUrl, graceHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">L'adresse de contact change bientôt</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Le changement d'adresse de contact du compte de <strong>${safeScreenName}</strong>
                sur SkillStreak a été confirmé et prendra effet dans ${graceHours} heures.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Ce n'était pas vous (ou votre parent) ?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Annuler le changement
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Cela déconnecte également toutes les sessions actives du compte. Si le bouton ne
                fonctionne pas, copiez cette adresse dans votre navigateur :<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                C'était vous ? Vous n'avez alors rien à faire — le changement se termine
                automatiquement.
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

export function buildContactChangeCancelEmail(
  input: ContactChangeCancelEmailInput,
): RenderedEmail {
  const { screenName, cancelUrl, graceHours, locale } = input;
  const copy = resolveCopy(locale);

  const subject = copy.subject(screenName);
  const text = copy.text(screenName, cancelUrl, graceHours);

  const safeScreenName = escapeHtml(screenName);
  const safeUrl = escapeHtml(cancelUrl);

  const html = copy.html(safeScreenName, safeUrl, graceHours, subject);

  return { subject, html, text };
}
