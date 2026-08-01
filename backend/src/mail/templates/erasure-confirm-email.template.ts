// docs/adr/0013-account-erasure.md Decision 2/3 — sent to the request-time
// snapshot of parent_contact, carrying the link that actually starts the
// 30-day grace-period clock. A bare in-app tap only creates this request;
// nothing durable happens until this link is followed and confirmed (see
// the ADR's "email-gates-the-clock" resolution) — a link, not an in-app
// "enter this code" flow, deliberately: the whole point of Decision 2's
// fix is that a merely-borrowed/compromised session can't complete this on
// its own, so there is no authenticated confirm endpoint to type the code
// back into (see GET/POST /players/erasure-confirm/:code, unauthenticated,
// mirroring ConsentController's link-only shape, not
// contact-change-confirm's in-app code entry).
//
// docs/adr/0014-multi-language-support.md Decision 3 — same `COPY`/
// `resolveCopy` fallback pattern as every other template in this
// directory; see consent-request-email.template.ts's comment for the full
// reasoning. Caller (AccountErasureService) already has the player's own
// Player row in hand, so `locale` comes from `player.locale` — no new
// query needed.

import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface ErasureConfirmEmailInput {
  screenName: string;
  confirmUrl: string;
  expiresInHours: number;
  locale: PlayerLocale;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LocaleCopy {
  subject: (screenName: string) => string;
  text: (
    screenName: string,
    confirmUrl: string,
    expiresInHours: number,
  ) => string;
  html: (
    safeScreenName: string,
    safeUrl: string,
    expiresInHours: number,
    subject: string,
  ) => string;
}

// en/fi/da/nb/de/cs/fr translations below are AI-generated (this session),
// not sourced from a professional/native-speaker translator — recommend a
// native-speaker review pass before relying on this for real families.
const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: {
    subject: (screenName) =>
      `Bekräfta radering av ${screenName}s konto på SkillStreak`,
    text: (screenName, confirmUrl, expiresInHours) =>
      [
        'Hej!',
        '',
        `Någon har bett om att radera ${screenName}s konto på SkillStreak, inklusive allt innehåll kontot äger.`,
        '',
        `Bekräfta här: ${confirmUrl}`,
        '',
        `Länken är giltig i ${expiresInHours} timmar och går bara att använda en gång. Att bekräfta startar en 30 dagars ångerperiod — kontot raderas inte förrän den perioden gått ut.`,
        '',
        'Var det inte du (eller ditt barn) som bad om detta? Ignorera det här mejlet — länken slutar gälla automatiskt och ingenting raderas.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, expiresInHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bekräfta radering av kontot</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Någon har bett om att radera <strong>${safeScreenName}</strong>s konto på SkillStreak,
                inklusive allt innehåll kontot äger.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Bekräfta radering
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Länken är giltig i ${expiresInHours} timmar, går bara att använda en gång. Att
                bekräfta startar en 30 dagars ångerperiod — kontot raderas inte förrän den perioden
                gått ut, och det går att avbryta när som helst innan dess.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Fungerar knappen inte, kopiera denna adress till webbläsaren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det inte du (eller ditt barn) som bad om detta? Ignorera det här mejlet — länken
                slutar gälla automatiskt och ingenting raderas.
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
      `Confirm deletion of ${screenName}'s account on SkillStreak`,
    text: (screenName, confirmUrl, expiresInHours) =>
      [
        'Hi there!',
        '',
        `Someone has requested to delete ${screenName}'s account on SkillStreak, including everything the account owns.`,
        '',
        `Confirm here: ${confirmUrl}`,
        '',
        `The link is valid for ${expiresInHours} hours and can only be used once. Confirming starts a 30-day grace period — the account isn't deleted until that period has passed.`,
        '',
        "Wasn't this you (or your child)? Ignore this email — the link will expire automatically and nothing will be deleted.",
      ].join('\n'),
    html: (safeScreenName, safeUrl, expiresInHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Confirm account deletion</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Someone has requested to delete <strong>${safeScreenName}</strong>'s account on SkillStreak,
                including everything the account owns.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Confirm deletion
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                The link is valid for ${expiresInHours} hours, can only be used once. Confirming
                starts a 30-day grace period — the account isn't deleted until that period has
                passed, and it can be cancelled at any time before then.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                If the button doesn't work, copy this address into your browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Wasn't this you (or your child)? Ignore this email — the link will expire
                automatically and nothing will be deleted.
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
      `Vahvista ${screenName}n tilin poistaminen SkillStreakista`,
    text: (screenName, confirmUrl, expiresInHours) =>
      [
        'Hei!',
        '',
        `Joku on pyytänyt poistaa ${screenName}n tilin SkillStreakista, mukaan lukien kaiken tilin omistaman sisällön.`,
        '',
        `Vahvista täällä: ${confirmUrl}`,
        '',
        `Linkki on voimassa ${expiresInHours} tuntia ja sen voi käyttää vain kerran. Vahvistaminen käynnistää 30 päivän harkinta-ajan — tiliä ei poisteta ennen kuin tämä aika on kulunut.`,
        '',
        'Etkö pyytänyt tätä (tai lapsesi)? Jätä tämä viesti huomiotta — linkki vanhenee automaattisesti eikä mitään poisteta.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, expiresInHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Vahvista tilin poistaminen</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Joku on pyytänyt poistaa <strong>${safeScreenName}</strong>n tilin SkillStreakista,
                mukaan lukien kaiken tilin omistaman sisällön.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Vahvista poistaminen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Linkki on voimassa ${expiresInHours} tuntia, voidaan käyttää vain kerran.
                Vahvistaminen käynnistää 30 päivän harkinta-ajan — tiliä ei poisteta ennen kuin
                tämä aika on kulunut, ja pyynnön voi perua milloin tahansa ennen sitä.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Jos painike ei toimi, kopioi tämä osoite selaimeesi:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Etkö pyytänyt tätä (tai lapsesi)? Jätä tämä viesti huomiotta — linkki vanhenee
                automaattisesti eikä mitään poisteta.
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
      `Bekræft sletning af ${screenName}s konto på SkillStreak`,
    text: (screenName, confirmUrl, expiresInHours) =>
      [
        'Hej!',
        '',
        `Nogen har bedt om at slette ${screenName}s konto på SkillStreak, inklusive alt indhold kontoen ejer.`,
        '',
        `Bekræft her: ${confirmUrl}`,
        '',
        `Linket er gyldigt i ${expiresInHours} timer og kan kun bruges én gang. En bekræftelse starter en 30-dages fortrydelsesperiode — kontoen slettes ikke, før den periode er udløbet.`,
        '',
        'Var det ikke dig (eller dit barn), der bad om dette? Ignorér denne mail — linket udløber automatisk, og der slettes intet.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, expiresInHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bekræft sletning af kontoen</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Nogen har bedt om at slette <strong>${safeScreenName}</strong>s konto på SkillStreak,
                inklusive alt indhold kontoen ejer.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Bekræft sletning
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Linket er gyldigt i ${expiresInHours} timer, kan kun bruges én gang. En
                bekræftelse starter en 30-dages fortrydelsesperiode — kontoen slettes ikke, før
                den periode er udløbet, og det kan annulleres når som helst inden da.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Virker knappen ikke, så kopiér denne adresse til browseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det ikke dig (eller dit barn), der bad om dette? Ignorér denne mail — linket
                udløber automatisk, og der slettes intet.
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
      `Bekreft sletting av ${screenName}s konto på SkillStreak`,
    text: (screenName, confirmUrl, expiresInHours) =>
      [
        'Hei!',
        '',
        `Noen har bedt om å slette ${screenName}s konto på SkillStreak, inkludert alt innhold kontoen eier.`,
        '',
        `Bekreft her: ${confirmUrl}`,
        '',
        `Lenken er gyldig i ${expiresInHours} timer og kan bare brukes én gang. Å bekrefte starter en 30 dagers angreperiode — kontoen slettes ikke før den perioden er over.`,
        '',
        'Var det ikke deg (eller barnet ditt) som ba om dette? Ignorer denne e-posten — lenken slutter å gjelde automatisk, og ingenting slettes.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, expiresInHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Bekreft sletting av kontoen</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Noen har bedt om å slette <strong>${safeScreenName}</strong>s konto på SkillStreak,
                inkludert alt innhold kontoen eier.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Bekreft sletting
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Lenken er gyldig i ${expiresInHours} timer, kan bare brukes én gang. Å bekrefte
                starter en 30 dagers angreperiode — kontoen slettes ikke før den perioden er
                over, og det kan avbrytes når som helst innen den tid.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Fungerer ikke knappen, kopier denne adressen til nettleseren:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Var det ikke deg (eller barnet ditt) som ba om dette? Ignorer denne e-posten —
                lenken slutter å gjelde automatisk, og ingenting slettes.
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
      `Löschung des Kontos von ${screenName} auf SkillStreak bestätigen`,
    text: (screenName, confirmUrl, expiresInHours) =>
      [
        'Hallo!',
        '',
        `Jemand hat beantragt, das Konto von ${screenName} auf SkillStreak zu löschen, einschließlich aller Inhalte, die dem Konto gehören.`,
        '',
        `Hier bestätigen: ${confirmUrl}`,
        '',
        `Der Link ist ${expiresInHours} Stunden gültig und kann nur einmal verwendet werden. Die Bestätigung startet eine 30-tägige Widerrufsfrist — das Konto wird erst nach Ablauf dieser Frist gelöscht.`,
        '',
        'War das nicht du (oder dein Kind)? Ignoriere diese E-Mail — der Link läuft automatisch ab, und es wird nichts gelöscht.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, expiresInHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Löschung des Kontos bestätigen</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Jemand hat beantragt, das Konto von <strong>${safeScreenName}</strong> auf SkillStreak
                zu löschen, einschließlich aller Inhalte, die dem Konto gehören.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Löschung bestätigen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Der Link ist ${expiresInHours} Stunden gültig, kann nur einmal verwendet werden.
                Die Bestätigung startet eine 30-tägige Widerrufsfrist — das Konto wird erst
                nach Ablauf dieser Frist gelöscht, und der Antrag kann jederzeit vorher
                widerrufen werden.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                War das nicht du (oder dein Kind)? Ignoriere diese E-Mail — der Link läuft
                automatisch ab, und es wird nichts gelöscht.
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
      `Potvrďte smazání účtu uživatele ${screenName} na SkillStreak`,
    text: (screenName, confirmUrl, expiresInHours) =>
      [
        'Ahoj!',
        '',
        `Někdo požádal o smazání účtu uživatele ${screenName} na SkillStreak, včetně veškerého obsahu, který účet vlastní.`,
        '',
        `Potvrďte zde: ${confirmUrl}`,
        '',
        `Odkaz je platný ${expiresInHours} hodin a lze jej použít pouze jednou. Potvrzením se spustí 30denní lhůta na rozmyšlenou — účet nebude smazán, dokud tato lhůta neuplyne.`,
        '',
        'Nebyli jste to vy (nebo vaše dítě), kdo o to požádal? Tento e-mail ignorujte — platnost odkazu automaticky vyprší a nic se nesmaže.',
      ].join('\n'),
    html: (safeScreenName, safeUrl, expiresInHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Potvrďte smazání účtu</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Někdo požádal o smazání účtu uživatele <strong>${safeScreenName}</strong> na SkillStreak,
                včetně veškerého obsahu, který účet vlastní.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Potvrdit smazání
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Odkaz je platný ${expiresInHours} hodin, lze jej použít pouze jednou. Potvrzením
                se spustí 30denní lhůta na rozmyšlenou — účet nebude smazán, dokud tato lhůta
                neuplyne, a žádost lze kdykoli předtím zrušit.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Pokud tlačítko nefunguje, zkopírujte tuto adresu do prohlížeče:<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Nebyli jste to vy (nebo vaše dítě), kdo o to požádal? Tento e-mail ignorujte —
                platnost odkazu automaticky vyprší a nic se nesmaže.
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
      `Confirmez la suppression du compte de ${screenName} sur SkillStreak`,
    text: (screenName, confirmUrl, expiresInHours) =>
      [
        'Bonjour !',
        '',
        `Quelqu'un a demandé la suppression du compte de ${screenName} sur SkillStreak, y compris tout le contenu que possède ce compte.`,
        '',
        `Confirmer ici : ${confirmUrl}`,
        '',
        `Le lien est valable ${expiresInHours} heures et ne peut être utilisé qu'une seule fois. La confirmation déclenche un délai de rétractation de 30 jours — le compte ne sera pas supprimé avant la fin de ce délai.`,
        '',
        "Ce n'était pas vous (ou votre enfant) ? Ignorez cet e-mail — le lien expirera automatiquement et rien ne sera supprimé.",
      ].join('\n'),
    html: (safeScreenName, safeUrl, expiresInHours, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Confirmez la suppression du compte</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Quelqu'un a demandé la suppression du compte de <strong>${safeScreenName}</strong>
                sur SkillStreak, y compris tout le contenu que possède ce compte.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Confirmer la suppression
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.5;">
                Le lien est valable ${expiresInHours} heures, ne peut être utilisé qu'une seule
                fois. La confirmation déclenche un délai de rétractation de 30 jours — le compte
                ne sera pas supprimé avant la fin de ce délai, et la demande peut être annulée
                à tout moment avant cela.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br />
                <span style="word-break:break-all;">${safeUrl}</span>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Ce n'était pas vous (ou votre enfant) ? Ignorez cet e-mail — le lien expirera
                automatiquement et rien ne sera supprimé.
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

export function buildErasureConfirmEmail(
  input: ErasureConfirmEmailInput,
): RenderedEmail {
  const { screenName, confirmUrl, expiresInHours, locale } = input;
  const copy = resolveCopy(locale);

  const subject = copy.subject(screenName);
  const text = copy.text(screenName, confirmUrl, expiresInHours);

  const safeScreenName = escapeHtml(screenName);
  const safeUrl = escapeHtml(confirmUrl);

  const html = copy.html(safeScreenName, safeUrl, expiresInHours, subject);

  return { subject, html, text };
}
