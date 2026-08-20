// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A4 point 2 — the
// non-expiring revoke_code is "mailed alongside the original approval
// confirmation." Sent once, at the moment a PtPlayerConsent is approved,
// carrying the one link a parent (or the 13+ self-verifying player) will
// ever need to end this specific PT relationship later, unconditionally,
// with no expiry.
//
// Only sv/en implemented for v1 — see pt-consent-request-email.template.ts
// for the same, explicitly-scoped decision.
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface PtConsentApprovedEmailInput {
  screenName: string;
  ptDisplayName: string;
  revokeUrl: string;
  locale: PlayerLocale;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LocaleCopy {
  subject: (screenName: string) => string;
  text: (input: PtConsentApprovedEmailInput) => string;
  html: (input: PtConsentApprovedEmailInput, subject: string) => string;
}

const COPY: Record<'sv' | 'en' | 'es', LocaleCopy> = {
  sv: {
    subject: (screenName) =>
      `Bekräftat: ${screenName}s tränarrelation på SkillStreak`,
    text: (input) =>
      [
        'Hej!',
        '',
        `${input.ptDisplayName} har nu godkänts som personlig tränare och kan se ${input.screenName}s träningsdata på SkillStreak (skärmnamn, träningsstreak, träningslogg och märken — aldrig riktigt namn, kontaktuppgifter, lagchatt eller video).`,
        '',
        'Det går att återkalla det här när som helst, utan att ange något skäl — antingen direkt i appen (under Profil) eller via länken nedan, som alltid fungerar:',
        '',
        input.revokeUrl,
      ].join('\n'),
    html: (input, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#3DAA6B;">Bekräftat</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                <strong>${escapeHtml(input.ptDisplayName)}</strong> har nu godkänts som personlig tränare och kan se
                <strong>${escapeHtml(input.screenName)}</strong>s träningsdata på SkillStreak.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
                Det går att återkalla det här när som helst, utan att ange något skäl — antingen direkt i appen
                (under Profil) eller via länken nedan, som alltid fungerar:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#1B1B3A;">
                    <a href="${escapeHtml(input.revokeUrl)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Återkalla tillgången
                    </a>
                  </td>
                </tr>
              </table>
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
      `Confirmed: ${screenName}'s trainer relationship on SkillStreak`,
    text: (input) =>
      [
        'Hi there!',
        '',
        `${input.ptDisplayName} has now been approved as a personal trainer and can see ${input.screenName}'s training data on SkillStreak (screen name, training streak, training log, and badges — never real name, contact details, team chat, or video).`,
        '',
        'This can be revoked at any time, with no reason needed — either directly in the app (under Profile), or via the link below, which always works:',
        '',
        input.revokeUrl,
      ].join('\n'),
    html: (input, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#3DAA6B;">Confirmed</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                <strong>${escapeHtml(input.ptDisplayName)}</strong> has now been approved as a personal trainer and
                can see <strong>${escapeHtml(input.screenName)}</strong>'s training data on SkillStreak.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
                This can be revoked at any time, with no reason needed — either directly in the app (under Profile),
                or via the link below, which always works:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#1B1B3A;">
                    <a href="${escapeHtml(input.revokeUrl)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Revoke access
                    </a>
                  </td>
                </tr>
              </table>
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
    subject: (screenName) =>
      `Confirmado: la relación de ${screenName} con su entrenador personal en SkillStreak`,
    text: (input) =>
      [
        '¡Hola!',
        '',
        `${input.ptDisplayName} ha sido autorizado como entrenador personal y puede ver los datos de entrenamiento de ${input.screenName} en SkillStreak (nombre en la app, racha de entrenamiento, registro de entrenamientos e insignias; nunca el nombre real, los datos de contacto, el chat del equipo ni los vídeos).`,
        '',
        'Esto se puede retirar en cualquier momento y sin dar ninguna explicación: desde la propia app (en Perfil) o con el enlace de abajo, que siempre funciona:',
        '',
        input.revokeUrl,
      ].join('\n'),
    html: (input, subject) => `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#3DAA6B;">Confirmado</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                <strong>${escapeHtml(input.ptDisplayName)}</strong> ha sido autorizado como entrenador personal y
                can see <strong>${escapeHtml(input.screenName)}</strong> en SkillStreak.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
                Esto se puede retirar en cualquier momento y sin dar ninguna explicación: desde la propia app (en Perfil)
                o con el enlace de abajo, que siempre funciona:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#1B1B3A;">
                    <a href="${escapeHtml(input.revokeUrl)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Retirar el acceso
                    </a>
                  </td>
                </tr>
              </table>
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
  return locale === PlayerLocale.EN ? COPY.en : COPY.sv;
}

export function buildPtConsentApprovedEmail(
  input: PtConsentApprovedEmailInput,
): RenderedEmail {
  const copy = resolveCopy(input.locale);
  const subject = copy.subject(input.screenName);
  const text = copy.text(input);
  const html = copy.html(input, subject);
  return { subject, html, text };
}
