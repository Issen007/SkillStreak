// docs/adr/0012-profile-page-and-contact-email-change.md decision 1, step
// 3 — sent to the CURRENT (old) address on file, at request time, before
// the change takes effect. Purely informational: no code, nothing
// actionable from this email itself. Deliberately sent *before* the
// change completes (not after) — gives the real account owner a window
// to react (contact the coach) while the change is still pending, rather
// than a too-late "this already happened" notice.
//
// docs/adr/0014-multi-language-support.md Decision 3 — same `COPY`/
// `resolveCopy` fallback pattern as every other template in this
// directory; see consent-request-email.template.ts's comment for the full
// reasoning. Caller (ProfileService) already has the player's own Player
// row in hand, so `locale` comes from `player.locale` — no new query
// needed.

import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface ContactChangeNotifyOldEmailInput {
  screenName: string;
  locale: PlayerLocale;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LocaleCopy {
  subject: (screenName: string) => string;
  text: (screenName: string) => string;
  html: (safeScreenName: string, subject: string) => string;
}

// en/fi/da/nb/de/cs/fr translations below are AI-generated (this session),
// not sourced from a professional/native-speaker translator — recommend a
// native-speaker review pass before relying on this for real families.
const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: {
    subject: (screenName) =>
      `Kontaktadressen för ${screenName}s konto håller på att ändras`,
    text: (screenName) =>
      [
        'Hej!',
        '',
        `Någon har bett om att byta kontaktadress för ${screenName}s konto på SkillStreak till en ny adress.`,
        '',
        'Var det du (eller din förälder) som gjorde detta? Då behöver du inte göra något — ändringen slutförs bara om den nya adressen bekräftas.',
        '',
        'Var det inte du? Hör av dig till lagets tränare så snart som möjligt.',
      ].join('\n'),
    html: (safeScreenName, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktadressen håller på att ändras</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                Någon har bett om att byta kontaktadress för <strong>${safeScreenName}</strong>s
                konto på SkillStreak till en ny adress.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
                Var det du (eller din förälder) som gjorde detta? Då behöver du inte göra
                något — ändringen slutförs bara om den nya adressen bekräftas.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.5;font-weight:700;">
                Var det inte du? Hör av dig till lagets tränare så snart som möjligt.
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
      `The contact address for ${screenName}'s account is about to change`,
    text: (screenName) =>
      [
        'Hi there!',
        '',
        `Someone has requested to change the contact address for ${screenName}'s account on SkillStreak to a new address.`,
        '',
        "Was this you (or your parent)? Then you don't need to do anything — the change only completes once the new address is confirmed.",
        '',
        "Wasn't this you? Contact the team's coach as soon as possible.",
      ].join('\n'),
    html: (safeScreenName, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">The contact address is about to change</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                Someone has requested to change the contact address for <strong>${safeScreenName}</strong>'s
                account on SkillStreak to a new address.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
                Was this you (or your parent)? Then you don't need to do anything — the change
                only completes once the new address is confirmed.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.5;font-weight:700;">
                Wasn't this you? Contact the team's coach as soon as possible.
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
      `Yhteystiedon osoite tilille ${screenName} on vaihtumassa`,
    text: (screenName) =>
      [
        'Hei!',
        '',
        `Joku on pyytänyt vaihtaa ${screenName}n tilin yhteystieto-osoitteen SkillStreakissa uuteen osoitteeseen.`,
        '',
        'Olitko tämä sinä (tai vanhempasi)? Silloin sinun ei tarvitse tehdä mitään — muutos tulee voimaan vasta, kun uusi osoite on vahvistettu.',
        '',
        'Etkö ollut sinä? Ota mahdollisimman pian yhteyttä joukkueen valmentajaan.',
      ].join('\n'),
    html: (safeScreenName, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Yhteystiedon osoite on vaihtumassa</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                Joku on pyytänyt vaihtaa <strong>${safeScreenName}</strong>n tilin yhteystieto-osoitteen
                SkillStreakissa uuteen osoitteeseen.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
                Olitko tämä sinä (tai vanhempasi)? Silloin sinun ei tarvitse tehdä mitään — muutos
                tulee voimaan vasta, kun uusi osoite on vahvistettu.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.5;font-weight:700;">
                Etkö ollut sinä? Ota mahdollisimman pian yhteyttä joukkueen valmentajaan.
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
      `Kontaktadressen for ${screenName}s konto er ved at blive ændret`,
    text: (screenName) =>
      [
        'Hej!',
        '',
        `Nogen har bedt om at ændre kontaktadressen for ${screenName}s konto på SkillStreak til en ny adresse.`,
        '',
        'Var det dig (eller din forælder), der gjorde dette? Så behøver du ikke gøre noget — ændringen gennemføres først, når den nye adresse er bekræftet.',
        '',
        'Var det ikke dig? Kontakt holdets træner så hurtigt som muligt.',
      ].join('\n'),
    html: (safeScreenName, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktadressen er ved at blive ændret</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                Nogen har bedt om at ændre kontaktadressen for <strong>${safeScreenName}</strong>s
                konto på SkillStreak til en ny adresse.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
                Var det dig (eller din forælder), der gjorde dette? Så behøver du ikke gøre noget
                — ændringen gennemføres først, når den nye adresse er bekræftet.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.5;font-weight:700;">
                Var det ikke dig? Kontakt holdets træner så hurtigt som muligt.
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
      `Kontaktadressen for ${screenName}s konto er i ferd med å bli endret`,
    text: (screenName) =>
      [
        'Hei!',
        '',
        `Noen har bedt om å endre kontaktadressen for ${screenName}s konto på SkillStreak til en ny adresse.`,
        '',
        'Var det deg (eller foresatte) som gjorde dette? Da trenger du ikke gjøre noe — endringen fullføres først når den nye adressen er bekreftet.',
        '',
        'Var det ikke deg? Ta kontakt med lagets trener så snart som mulig.',
      ].join('\n'),
    html: (safeScreenName, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktadressen er i ferd med å bli endret</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                Noen har bedt om å endre kontaktadressen for <strong>${safeScreenName}</strong>s
                konto på SkillStreak til en ny adresse.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
                Var det deg (eller foresatte) som gjorde dette? Da trenger du ikke gjøre noe —
                endringen fullføres først når den nye adressen er bekreftet.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.5;font-weight:700;">
                Var det ikke deg? Ta kontakt med lagets trener så snart som mulig.
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
      `Die Kontaktadresse für das Konto von ${screenName} wird geändert`,
    text: (screenName) =>
      [
        'Hallo!',
        '',
        `Jemand hat beantragt, die Kontaktadresse für das Konto von ${screenName} auf SkillStreak in eine neue Adresse zu ändern.`,
        '',
        'Warst du das (oder ein Elternteil)? Dann musst du nichts weiter tun — die Änderung wird erst wirksam, wenn die neue Adresse bestätigt wird.',
        '',
        'War das nicht du? Wende dich so schnell wie möglich an den Trainer bzw. die Trainerin des Teams.',
      ].join('\n'),
    html: (safeScreenName, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Die Kontaktadresse wird geändert</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                Jemand hat beantragt, die Kontaktadresse für das Konto von <strong>${safeScreenName}</strong>
                auf SkillStreak in eine neue Adresse zu ändern.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
                Warst du das (oder ein Elternteil)? Dann musst du nichts weiter tun — die
                Änderung wird erst wirksam, wenn die neue Adresse bestätigt wird.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.5;font-weight:700;">
                War das nicht du? Wende dich so schnell wie möglich an den Trainer bzw. die
                Trainerin des Teams.
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
      `Kontaktní adresa účtu uživatele ${screenName} se mění`,
    text: (screenName) =>
      [
        'Ahoj!',
        '',
        `Někdo požádal o změnu kontaktní adresy účtu uživatele ${screenName} na SkillStreak na novou adresu.`,
        '',
        'Byli jste to vy (nebo váš rodič)? Pak nemusíte nic dělat — změna se dokončí, až bude nová adresa potvrzena.',
        '',
        'Nebyli jste to vy? Co nejdříve kontaktujte trenéra týmu.',
      ].join('\n'),
    html: (safeScreenName, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Kontaktní adresa se mění</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                Někdo požádal o změnu kontaktní adresy účtu uživatele <strong>${safeScreenName}</strong>
                na SkillStreak na novou adresu.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
                Byli jste to vy (nebo váš rodič)? Pak nemusíte nic dělat — změna se dokončí, až
                bude nová adresa potvrzena.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.5;font-weight:700;">
                Nebyli jste to vy? Co nejdříve kontaktujte trenéra týmu.
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
      `L'adresse de contact du compte de ${screenName} est en cours de modification`,
    text: (screenName) =>
      [
        'Bonjour !',
        '',
        `Quelqu'un a demandé à changer l'adresse de contact du compte de ${screenName} sur SkillStreak pour une nouvelle adresse.`,
        '',
        "Est-ce vous (ou votre parent) qui avez fait cela ? Vous n'avez alors rien à faire — le changement ne sera effectif que lorsque la nouvelle adresse aura été confirmée.",
        '',
        "Ce n'était pas vous ? Contactez l'entraîneur de l'équipe dès que possible.",
      ].join('\n'),
    html: (safeScreenName, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">L'adresse de contact est en cours de modification</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                Quelqu'un a demandé à changer l'adresse de contact du compte de <strong>${safeScreenName}</strong>
                sur SkillStreak pour une nouvelle adresse.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
                Est-ce vous (ou votre parent) qui avez fait cela ? Vous n'avez alors rien à
                faire — le changement ne sera effectif que lorsque la nouvelle adresse aura
                été confirmée.
              </p>
              <p style="margin:0;font-size:14px;line-height:1.5;font-weight:700;">
                Ce n'était pas vous ? Contactez l'entraîneur de l'équipe dès que possible.
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

export function buildContactChangeNotifyOldEmail(
  input: ContactChangeNotifyOldEmailInput,
): RenderedEmail {
  const { screenName, locale } = input;
  const copy = resolveCopy(locale);

  const subject = copy.subject(screenName);
  const text = copy.text(screenName);

  const safeScreenName = escapeHtml(screenName);

  const html = copy.html(safeScreenName, subject);

  return { subject, html, text };
}
