// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A3 — the actual
// informed-consent moment for a PT relationship: "names the specific PT
// (their display name + email, from the SSO identity)... and states
// plainly, in the same allow-listed terms as Decision A5, exactly what
// becomes visible if approved (screen name, streak/training-log history,
// badges) and what never does (real name, chat, video, any other child's
// data)."
//
// Only sv/en are implemented for v1 (unlike this codebase's other mail
// templates, which cover all 8 PlayerLocale values) — a deliberate,
// named scope decision for this already-large feature, not an oversight.
// `resolveCopy` falls back to `sv` for every other locale, same
// never-blank-or-broken posture as every other template here; extending
// to the remaining 6 locales is a small, additive follow-up (see
// docs/ACTION_PLAN.md's Phase 8 write-up).
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { escapeHtml } from './html-escape.util';

export interface PtConsentRequestEmailInput {
  screenName: string;
  isSelfVerification: boolean;
  ptDisplayName: string;
  ptEmail: string;
  reviewUrl: string;
  expiresInDays: number;
  locale: PlayerLocale;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LocaleCopy {
  subject: (screenName: string) => string;
  intro: (screenName: string, isSelfVerification: boolean) => string;
  text: (input: PtConsentRequestEmailInput) => string;
  html: (input: PtConsentRequestEmailInput, subject: string) => string;
}

const COPY: Record<'sv' | 'en' | 'es', LocaleCopy> = {
  sv: {
    subject: (screenName) =>
      `En personlig tränare vill se ${screenName}s träningsdata på SkillStreak`,
    intro: (screenName, isSelfVerification) =>
      isSelfVerification
        ? `Du (${screenName}) har blivit tillfrågad om att ge en personlig tränare tillgång till din träningsdata på SkillStreak.`
        : `Någon har bett om att ge en personlig tränare tillgång till ${screenName}s träningsdata på SkillStreak.`,
    text: (input) =>
      [
        'Hej!',
        '',
        input.isSelfVerification
          ? `Du (${input.screenName}) har blivit tillfrågad om att ge en personlig tränare tillgång till din träningsdata på SkillStreak.`
          : `Någon har bett om att ge en personlig tränare tillgång till ${input.screenName}s träningsdata på SkillStreak.`,
        '',
        `Tränaren: ${input.ptDisplayName} (${input.ptEmail})`,
        '',
        'Om du godkänner får den här personen se: skärmnamn, dagens/längsta träningsstreak, träningsloggen (datum, aktivitetstyp, längd) och intjänade märken.',
        'Den här personen ser ALDRIG: riktigt namn, kontaktuppgifter, lagchatt, videoklipp, eller några andra spelares data.',
        '',
        `Godkänn här: ${input.reviewUrl}`,
        '',
        `Länken är giltig i ${input.expiresInDays} dagar och går bara att använda en gång. Godkännandet går att återkalla när som helst, av spelaren själv i appen eller via en separat länk i bekräftelsemejlet.`,
        '',
        'Kände du inte igen den här förfrågan? Ignorera det här mejlet — länken slutar gälla automatiskt och ingenting delas.',
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">En personlig tränare vill se träningsdata</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                ${escapeHtml(COPY.sv.intro(input.screenName, input.isSelfVerification))}
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                Tränaren: <strong>${escapeHtml(input.ptDisplayName)}</strong> (${escapeHtml(input.ptEmail)})
              </p>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.5;">
                <strong>Om du godkänner ser den här personen:</strong> skärmnamn, tränings­streak, träningsloggen (datum, aktivitetstyp, längd) och intjänade märken.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
                <strong>Den här personen ser ALDRIG:</strong> riktigt namn, kontaktuppgifter, lagchatt, videoklipp, eller några andra spelares data.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${escapeHtml(input.reviewUrl)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Granska och godkänn
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                Länken är giltig i ${input.expiresInDays} dagar, går bara att använda en gång. Godkännandet går att
                återkalla när som helst — av spelaren själv i appen, eller via en separat länk i bekräftelsemejlet.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Kände du inte igen den här förfrågan? Ignorera det här mejlet — länken slutar gälla automatiskt och
                ingenting delas.
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
      `A personal trainer wants to see ${screenName}'s training data on SkillStreak`,
    intro: (screenName, isSelfVerification) =>
      isSelfVerification
        ? `You (${screenName}) have been asked to give a personal trainer access to your training data on SkillStreak.`
        : `Someone has requested to give a personal trainer access to ${screenName}'s training data on SkillStreak.`,
    text: (input) =>
      [
        'Hi there!',
        '',
        input.isSelfVerification
          ? `You (${input.screenName}) have been asked to give a personal trainer access to your training data on SkillStreak.`
          : `Someone has requested to give a personal trainer access to ${input.screenName}'s training data on SkillStreak.`,
        '',
        `The trainer: ${input.ptDisplayName} (${input.ptEmail})`,
        '',
        'If you approve, this person will be able to see: screen name, current/longest training streak, the training log (date, activity type, duration), and earned badges.',
        'This person will NEVER see: real name, contact details, team chat, video clips, or any other player’s data.',
        '',
        `Review and approve here: ${input.reviewUrl}`,
        '',
        `The link is valid for ${input.expiresInDays} days and can only be used once. Approval can be revoked at any time — by the player themself in the app, or via a separate link in the confirmation email.`,
        '',
        "Didn't recognize this request? Ignore this email — the link will expire automatically and nothing will be shared.",
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">A personal trainer wants to see training data</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                ${escapeHtml(COPY.en.intro(input.screenName, input.isSelfVerification))}
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                The trainer: <strong>${escapeHtml(input.ptDisplayName)}</strong> (${escapeHtml(input.ptEmail)})
              </p>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.5;">
                <strong>If you approve, this person will see:</strong> screen name, training streak, the training log (date, activity type, duration), and earned badges.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
                <strong>This person will NEVER see:</strong> real name, contact details, team chat, video clips, or any other player's data.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${escapeHtml(input.reviewUrl)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Review and approve
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                The link is valid for ${input.expiresInDays} days, can only be used once. Approval can be revoked at
                any time — by the player themself in the app, or via a separate link in the confirmation email.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                Didn't recognize this request? Ignore this email — the link will expire automatically and nothing
                will be shared.
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
    subject: (screenName) =>
      `Un entrenador personal quiere ver los datos de entrenamiento de ${screenName} en SkillStreak`,
    intro: (screenName, isSelfVerification) =>
      isSelfVerification
        ? `Te han pedido (a ti, ${screenName}) que des a un entrenador personal acceso a tus datos de entrenamiento en SkillStreak.`
        : `Alguien ha pedido dar a un entrenador personal acceso a los datos de entrenamiento de ${screenName} en SkillStreak.`,
    text: (input) =>
      [
        '¡Hola!',
        '',
        input.isSelfVerification
          ? `Te han pedido (a ti, ${input.screenName}) que des a un entrenador personal acceso a tus datos de entrenamiento en SkillStreak.`
          : `Alguien ha pedido dar a un entrenador personal acceso a los datos de entrenamiento de ${input.screenName} en SkillStreak.`,
        '',
        `El entrenador: ${input.ptDisplayName} (${input.ptEmail})`,
        '',
        'Si lo autorizas, esta persona podrá ver: el nombre en la app, la racha de entrenamiento actual y la más larga, el registro de entrenamientos (fecha, tipo de actividad, duración) y las insignias conseguidas.',
        'Esta persona NUNCA verá: el nombre real, los datos de contacto, el chat del equipo, los vídeos ni los datos de ningún otro jugador.',
        '',
        `Revísalo y autorízalo aquí: ${input.reviewUrl}`,
        '',
        `El enlace es válido durante ${input.expiresInDays} días y solo se puede usar una vez. La autorización se puede retirar en cualquier momento: por el propio jugador desde la app, o con un enlace aparte que va en el correo de confirmación.`,
        '',
        '¿No reconoces esta solicitud? Ignora este correo: el enlace caducará solo y no se compartirá nada.',
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Un entrenador personal quiere ver datos de entrenamiento</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                ${escapeHtml(COPY.es.intro(input.screenName, input.isSelfVerification))}
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
                El entrenador: <strong>${escapeHtml(input.ptDisplayName)}</strong> (${escapeHtml(input.ptEmail)})
              </p>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.5;">
                <strong>Si lo autorizas, esta persona verá:</strong> el nombre en la app, la racha de entrenamiento, el registro de entrenamientos (fecha, tipo de actividad, duración) y las insignias conseguidas.
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
                <strong>Esta persona NUNCA verá:</strong> el nombre real, los datos de contacto, el chat del equipo, los vídeos ni los datos de ningún otro jugador.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background-color:#FF6B35;">
                    <a href="${escapeHtml(input.reviewUrl)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                      Revisar y autorizar
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;">
                El enlace es válido durante ${input.expiresInDays} días y solo se puede usar una vez. La autorización se puede retirar en
                cualquier momento: por el propio jugador desde la app, o con un enlace aparte que va en el correo de confirmación.
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6B6B80;">
                ¿No reconoces esta solicitud? Ignora este correo: el enlace caducará solo y no se
                compartirá nada.
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
  return locale === PlayerLocale.EN ? COPY.en : COPY.sv; // never renders blank/broken
}

export function buildPtConsentRequestEmail(
  input: PtConsentRequestEmailInput,
): RenderedEmail {
  const copy = resolveCopy(input.locale);
  const subject = copy.subject(input.screenName);
  const text = copy.text(input);
  const html = copy.html(input, subject);
  return { subject, html, text };
}
