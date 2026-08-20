// docs/adr/0013-account-erasure.md Decision 2/3 — sent at CONFIRM time (not
// request time), to the same recipient_contact_snapshot the confirm-code
// email went to (never re-resolved from PlayerPrivateInfo — see the ADR's
// contact-change-race fix). This is what actually implements "30 days to
// regret it": a real, actionable link, valid the whole grace period, not
// just an informational notice.
//
// docs/adr/0014-multi-language-support.md Decision 3 — same `COPY`/
// `resolveCopy` fallback pattern as every other template in this
// directory; see consent-request-email.template.ts's comment for the full
// reasoning. Caller (AccountErasureService) already looks up the Player
// row inline before sending, so `locale` comes from `player.locale` — no
// extra query needed.

import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface ErasureCancelEmailInput {
  screenName: string;
  cancelUrl: string;
  scheduledForDateLabel: string;
  locale: PlayerLocale;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LocaleCopy {
  subject: (screenName: string, scheduledForDateLabel: string) => string;
  text: (
    screenName: string,
    cancelUrl: string,
    scheduledForDateLabel: string,
  ) => string;
  html: (
    safeScreenName: string,
    safeUrl: string,
    safeDateLabel: string,
    subject: string,
  ) => string;
}

// en/fi/da/nb/de/cs/fr translations below are AI-generated (this session),
// not sourced from a professional/native-speaker translator — recommend a
// native-speaker review pass before relying on this for real families.
const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: {
    subject: (screenName, scheduledForDateLabel) =>
      `Bekräftat: ${screenName}s konto raderas den ${scheduledForDateLabel}`,
    text: (screenName, cancelUrl, scheduledForDateLabel) =>
      [
        'Hej!',
        '',
        `Raderingen av ${screenName}s konto på SkillStreak har bekräftats. Kontot och allt innehåll det äger raderas den ${scheduledForDateLabel}, om inte begäran avbryts innan dess.`,
        '',
        'Ångrar du dig?',
        '',
        `Avbryt här: ${cancelUrl}`,
        '',
        'Du kan också avbryta direkt i appen, under Profil, när som helst innan raderingsdatumet.',
        '',
        'Var det du själv som bad om detta? Då behöver du inte göra något — raderingen sker automatiskt på det angivna datumet.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, safeDateLabel, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontot raderas den ${safeDateLabel}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Raderingen av <strong>${safeScreenName}</strong>s konto på SkillStreak har bekräftats.
                Kontot och allt innehåll det äger raderas den <strong>${safeDateLabel}</strong>, om inte
                begäran avbryts innan dess.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Ångrar du dig?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Avbryt raderingen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Du kan också avbryta direkt i appen, under Profil, när som helst innan raderingsdatumet.
                Fungerar knappen inte, kopiera denna adress till webbläsaren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det du själv som bad om detta? Då behöver du inte göra något — raderingen sker
                automatiskt på det angivna datumet.
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
    subject: (screenName, scheduledForDateLabel) =>
      `Confirmed: ${screenName}'s account will be deleted on ${scheduledForDateLabel}`,
    text: (screenName, cancelUrl, scheduledForDateLabel) =>
      [
        'Hi there!',
        '',
        `The deletion of ${screenName}'s account on SkillStreak has been confirmed. The account and everything it owns will be deleted on ${scheduledForDateLabel}, unless the request is cancelled before then.`,
        '',
        'Changed your mind?',
        '',
        `Cancel here: ${cancelUrl}`,
        '',
        'You can also cancel directly in the app, under Profile, any time before the deletion date.',
        '',
        "Was this you who requested this? Then you don't need to do anything — deletion happens automatically on the stated date.",
      ].join('\n'),
    html: (safeScreenName, safeUrl, safeDateLabel, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">The account will be deleted on ${safeDateLabel}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                The deletion of <strong>${safeScreenName}</strong>'s account on SkillStreak has been confirmed.
                The account and everything it owns will be deleted on <strong>${safeDateLabel}</strong>, unless
                the request is cancelled before then.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Changed your mind?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Cancel the deletion
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                You can also cancel directly in the app, under Profile, any time before the deletion date.
                If the button doesn't work, copy this address into your browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Was this you who requested this? Then you don't need to do anything — deletion
                happens automatically on the stated date.
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
    subject: (screenName, scheduledForDateLabel) =>
      `Vahvistettu: ${screenName}n tili poistetaan ${scheduledForDateLabel}`,
    text: (screenName, cancelUrl, scheduledForDateLabel) =>
      [
        'Hei!',
        '',
        `${screenName}n tilin poistaminen SkillStreakista on vahvistettu. Tili ja kaikki sen omistama sisältö poistetaan ${scheduledForDateLabel}, ellei pyyntöä perua sitä ennen.`,
        '',
        'Muutitko mielesi?',
        '',
        `Peru täällä: ${cancelUrl}`,
        '',
        'Voit myös perua suoraan sovelluksessa, kohdassa Profiili, milloin tahansa ennen poistopäivää.',
        '',
        'Pyysitkö tätä itse? Silloin sinun ei tarvitse tehdä mitään — poisto tapahtuu automaattisesti ilmoitettuna päivänä.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, safeDateLabel, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Tili poistetaan ${safeDateLabel}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                <strong>${safeScreenName}</strong>n tilin poistaminen SkillStreakista on vahvistettu.
                Tili ja kaikki sen omistama sisältö poistetaan <strong>${safeDateLabel}</strong>, ellei
                pyyntöä perua sitä ennen.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Muutitko mielesi?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Peru poisto
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Voit myös perua suoraan sovelluksessa, kohdassa Profiili, milloin tahansa ennen
                poistopäivää. Jos painike ei toimi, kopioi tämä osoite selaimeesi:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Pyysitkö tätä itse? Silloin sinun ei tarvitse tehdä mitään — poisto tapahtuu
                automaattisesti ilmoitettuna päivänä.
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
    subject: (screenName, scheduledForDateLabel) =>
      `Bekræftet: ${screenName}s konto slettes den ${scheduledForDateLabel}`,
    text: (screenName, cancelUrl, scheduledForDateLabel) =>
      [
        'Hej!',
        '',
        `Sletningen af ${screenName}s konto på SkillStreak er blevet bekræftet. Kontoen og alt indhold, den ejer, slettes den ${scheduledForDateLabel}, medmindre anmodningen annulleres inden da.`,
        '',
        'Har du fortrudt?',
        '',
        `Annuller her: ${cancelUrl}`,
        '',
        'Du kan også annullere direkte i appen, under Profil, når som helst inden sletningsdatoen.',
        '',
        'Var det dig selv, der bad om dette? Så behøver du ikke gøre noget — sletningen sker automatisk på den angivne dato.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, safeDateLabel, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontoen slettes den ${safeDateLabel}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Sletningen af <strong>${safeScreenName}</strong>s konto på SkillStreak er blevet
                bekræftet. Kontoen og alt indhold, den ejer, slettes den <strong>${safeDateLabel}</strong>,
                medmindre anmodningen annulleres inden da.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Har du fortrudt?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Annuller sletningen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Du kan også annullere direkte i appen, under Profil, når som helst inden
                sletningsdatoen. Virker knappen ikke, så kopiér denne adresse til browseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det dig selv, der bad om dette? Så behøver du ikke gøre noget — sletningen
                sker automatisk på den angivne dato.
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
    subject: (screenName, scheduledForDateLabel) =>
      `Bekreftet: ${screenName}s konto slettes den ${scheduledForDateLabel}`,
    text: (screenName, cancelUrl, scheduledForDateLabel) =>
      [
        'Hei!',
        '',
        `Slettingen av ${screenName}s konto på SkillStreak er bekreftet. Kontoen og alt innhold den eier, slettes den ${scheduledForDateLabel}, med mindre forespørselen avbrytes før den tid.`,
        '',
        'Angrer du?',
        '',
        `Avbryt her: ${cancelUrl}`,
        '',
        'Du kan også avbryte direkte i appen, under Profil, når som helst før slettedatoen.',
        '',
        'Var det du selv som ba om dette? Da trenger du ikke gjøre noe — slettingen skjer automatisk på den angitte datoen.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, safeDateLabel, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontoen slettes den ${safeDateLabel}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Slettingen av <strong>${safeScreenName}</strong>s konto på SkillStreak er bekreftet.
                Kontoen og alt innhold den eier, slettes den <strong>${safeDateLabel}</strong>, med
                mindre forespørselen avbrytes før den tid.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Angrer du?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Avbryt slettingen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Du kan også avbryte direkte i appen, under Profil, når som helst før slettedatoen.
                Fungerer ikke knappen, kopier denne adressen til nettleseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det du selv som ba om dette? Da trenger du ikke gjøre noe — slettingen skjer
                automatisk på den angitte datoen.
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
    subject: (screenName, scheduledForDateLabel) =>
      `Bestätigt: das Konto von ${screenName} wird am ${scheduledForDateLabel} gelöscht`,
    text: (screenName, cancelUrl, scheduledForDateLabel) =>
      [
        'Hallo!',
        '',
        `Die Löschung des Kontos von ${screenName} auf SkillStreak wurde bestätigt. Das Konto und alle Inhalte, die es besitzt, werden am ${scheduledForDateLabel} gelöscht, sofern der Antrag nicht vorher widerrufen wird.`,
        '',
        'Hast du es dir anders überlegt?',
        '',
        `Hier abbrechen: ${cancelUrl}`,
        '',
        'Du kannst auch direkt in der App unter Profil jederzeit vor dem Löschdatum widerrufen.',
        '',
        'Warst du das selbst, der/die das beantragt hat? Dann musst du nichts weiter tun — die Löschung erfolgt automatisch am angegebenen Datum.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, safeDateLabel, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Das Konto wird am ${safeDateLabel} gelöscht</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Die Löschung des Kontos von <strong>${safeScreenName}</strong> auf SkillStreak wurde
                bestätigt. Das Konto und alle Inhalte, die es besitzt, werden am
                <strong>${safeDateLabel}</strong> gelöscht, sofern der Antrag nicht vorher widerrufen wird.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Hast du es dir anders überlegt?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Löschung widerrufen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Du kannst auch direkt in der App unter Profil jederzeit vor dem Löschdatum
                widerrufen. Falls der Button nicht funktioniert, kopiere diese Adresse in
                deinen Browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Warst du das selbst, der/die das beantragt hat? Dann musst du nichts weiter
                tun — die Löschung erfolgt automatisch am angegebenen Datum.
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
    subject: (screenName, scheduledForDateLabel) =>
      `Potvrzeno: účet uživatele ${screenName} bude smazán dne ${scheduledForDateLabel}`,
    text: (screenName, cancelUrl, scheduledForDateLabel) =>
      [
        'Ahoj!',
        '',
        `Smazání účtu uživatele ${screenName} na SkillStreak bylo potvrzeno. Účet a veškerý obsah, který vlastní, bude smazán dne ${scheduledForDateLabel}, pokud žádost nebude do té doby zrušena.`,
        '',
        'Rozmysleli jste si to?',
        '',
        `Zrušit zde: ${cancelUrl}`,
        '',
        'Zrušit můžete také přímo v aplikaci, v sekci Profil, kdykoli před datem smazání.',
        '',
        'Byli jste to vy sami, kdo o to požádal? Pak nemusíte nic dělat — smazání proběhne automaticky v uvedeném datu.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, safeDateLabel, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Účet bude smazán dne ${safeDateLabel}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Smazání účtu uživatele <strong>${safeScreenName}</strong> na SkillStreak bylo potvrzeno.
                Účet a veškerý obsah, který vlastní, bude smazán dne <strong>${safeDateLabel}</strong>,
                pokud žádost nebude do té doby zrušena.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Rozmysleli jste si to?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Zrušit smazání
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Zrušit můžete také přímo v aplikaci, v sekci Profil, kdykoli před datem smazání.
                Pokud tlačítko nefunguje, zkopírujte tuto adresu do prohlížeče:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Byli jste to vy sami, kdo o to požádal? Pak nemusíte nic dělat — smazání proběhne
                automaticky v uvedeném datu.
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
    subject: (screenName, scheduledForDateLabel) =>
      `Confirmé : le compte de ${screenName} sera supprimé le ${scheduledForDateLabel}`,
    text: (screenName, cancelUrl, scheduledForDateLabel) =>
      [
        'Bonjour !',
        '',
        `La suppression du compte de ${screenName} sur SkillStreak a été confirmée. Le compte et tout le contenu qu'il possède seront supprimés le ${scheduledForDateLabel}, sauf si la demande est annulée avant cette date.`,
        '',
        "Vous avez changé d'avis ?",
        '',
        `Annuler ici : ${cancelUrl}`,
        '',
        "Vous pouvez également annuler directement dans l'application, dans Profil, à tout moment avant la date de suppression.",
        '',
        "Est-ce vous qui aviez fait cette demande ? Vous n'avez alors rien à faire — la suppression a lieu automatiquement à la date indiquée.",
      ].join('\n'),
    html: (safeScreenName, safeUrl, safeDateLabel, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Le compte sera supprimé le ${safeDateLabel}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                La suppression du compte de <strong>${safeScreenName}</strong> sur SkillStreak a été
                confirmée. Le compte et tout le contenu qu'il possède seront supprimés le
                <strong>${safeDateLabel}</strong>, sauf si la demande est annulée avant cette date.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                Vous avez changé d'avis ?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Annuler la suppression
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Vous pouvez également annuler directement dans l'application, dans Profil, à
                tout moment avant la date de suppression. Si le bouton ne fonctionne pas, copiez
                cette adresse dans votre navigateur :<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Est-ce vous qui aviez fait cette demande ? Vous n'avez alors rien à faire — la
                suppression a lieu automatiquement à la date indiquée.
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
  es: {
    subject: (screenName, scheduledForDateLabel) =>
      `Confirmado: la cuenta de ${screenName} se borrará el ${scheduledForDateLabel}`,
    text: (screenName, cancelUrl, scheduledForDateLabel) =>
      [
        '¡Hola!',
        '',
        `Se ha confirmado el borrado de la cuenta de ${screenName} en SkillStreak. La cuenta y todo lo que le pertenece se borrarán el ${scheduledForDateLabel}, a menos que se cancele la solicitud antes.`,
        '',
        '¿Has cambiado de idea?',
        '',
        `Cancélalo aquí: ${cancelUrl}`,
        '',
        'También puedes cancelarlo directamente en la app, en Perfil, en cualquier momento antes de la fecha de borrado.',
        '',
        '¿Lo has pedido tú? Entonces no tienes que hacer nada: el borrado se hará automáticamente en la fecha indicada.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, safeDateLabel, subject) => `<!DOCTYPE html>
<html lang="es">
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">The account will be deleted on ${safeDateLabel}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Se ha confirmado el borrado de la cuenta de <strong>${safeScreenName}</strong> en SkillStreak.
                La cuenta y todo lo que le pertenece se borrarán el <strong>${safeDateLabel}</strong>, a menos que
                se cancele la solicitud antes.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;font-weight:700;">
                ¿Has cambiado de idea?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Cancelar el borrado
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                También puedes cancelarlo directamente en la app, en Perfil, en cualquier momento antes de la fecha de borrado.
                Si el botón no funciona, copia esta dirección en tu navegador:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                ¿Lo has pedido tú? Entonces no tienes que hacer nada: el borrado
                se hará automáticamente en la fecha indicada.
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

export function buildErasureCancelEmail(
  input: ErasureCancelEmailInput,
): RenderedEmail {
  const { screenName, cancelUrl, scheduledForDateLabel, locale } = input;
  const copy = resolveCopy(locale);

  const subject = copy.subject(screenName, scheduledForDateLabel);
  const text = copy.text(screenName, cancelUrl, scheduledForDateLabel);

  const safeScreenName = escapeHtml(screenName);
  const safeUrl = escapeHtml(cancelUrl);
  const safeDateLabel = escapeHtml(scheduledForDateLabel);

  const html = copy.html(safeScreenName, safeUrl, safeDateLabel, subject);

  return { subject, html, text };
}
