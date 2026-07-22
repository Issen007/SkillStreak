// docs/adr/0010-video-storage-and-serving.md Decision 4 /
// docs/design/phase3-flows.md's "Parent-notification email copy" section —
// the best-effort email sent to (a) the uploader's own parent and (b) the
// team's coach, if one is on file, at most once per uploader per rolling 24
// hours (see RedisService.tryClaimClipReportNotifyCooldown).
//
// Unlike chat-report-notification-email.template.ts (one shared template
// for both recipients), this feature needs two genuinely different bodies:
// the parent email names the child and offers reassurance/next steps, the
// coach email deliberately does NOT name the uploader (the coach can ask
// their own roster directly if they want to — this email's job is
// awareness, not a formal incident report naming a specific kid).
//
// Key phrases below are preserved verbatim per security-reviewer's specific
// ask (docs/ACTION_PLAN.md's Phase 3 section / phase3-flows.md): "som en
// försiktighetsåtgärd" ("as a precaution") and "Det här betyder inte att
// något är fastställt fel" ("this doesn't mean anything has been
// established as wrong") — the copy must not read as an accusation already
// proven true, since a single unverified report both hides the clip and
// triggers this email. Deliberately absent, same as every other report-path
// email in this app: the reporter's identity (never revealed).
import { RenderedEmail } from './consent-request-email.template';
import { escapeHtml } from './html-escape.util';

export interface ClipReportParentEmailInput {
  uploaderScreenName: string;
}

export interface ClipReportCoachEmailInput {
  teamName: string;
}

function wrapEmailHtml(subject: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
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
              ${bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildClipReportParentEmail(
  input: ClipReportParentEmailInput,
): RenderedEmail {
  const { uploaderScreenName } = input;
  const subject = `En video från ${uploaderScreenName} har rapporterats`;

  const text = [
    'Hej!',
    '',
    `En lagkompis har rapporterat en video som ${uploaderScreenName} laddade upp i lagets klippflöde i appen. Vi har ingen automatisk granskning av videoinnehåll, så som en försiktighetsåtgärd är klippet nu dolt för hela laget, i väntan på att en vuxen kan titta på det.`,
    '',
    `Det här betyder inte att något är fastställt fel med videon — bara att en rapport kommit in. Ni behöver inte göra något just nu. Om ni vill kan ni titta på klippet tillsammans med ${uploaderScreenName}, eller höra av er till lagets tränare om ni har frågor. Videon är fortfarande sparad (inte borttagen) om ni vill se den innan ni bestämmer er för något.`,
    '',
    'Hälsningar,',
    'SkillStreak',
  ].join('\n');

  const safeName = escapeHtml(uploaderScreenName);
  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">En video har rapporterats</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      En lagkompis har rapporterat en video som <strong>${safeName}</strong> laddade upp i lagets klippflöde i appen.
      Vi har ingen automatisk granskning av videoinnehåll, så som en försiktighetsåtgärd är klippet nu dolt för hela laget,
      i väntan på att en vuxen kan titta på det.
    </p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      <strong>Det här betyder inte att något är fastställt fel med videon</strong> — bara att en rapport kommit in.
      Ni behöver inte göra något just nu. Om ni vill kan ni titta på klippet tillsammans med ${safeName}, eller höra av
      er till lagets tränare om ni har frågor. Videon är fortfarande sparad (inte borttagen) om ni vill se den innan ni
      bestämmer er för något.
    </p>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
      Hälsningar,<br />SkillStreak
    </p>`;

  return { subject, html: wrapEmailHtml(subject, bodyHtml), text };
}

export function buildClipReportCoachEmail(
  input: ClipReportCoachEmailInput,
): RenderedEmail {
  const { teamName } = input;
  const subject = `Ett klipp i ${teamName}s flöde har rapporterats`;

  const text = [
    'Hej!',
    '',
    `Ett klipp som laddades upp av en spelare i ${teamName} har rapporterats av en lagkompis och är nu dolt för laget, som en försiktighetsåtgärd. Vi skickar också den här informationen till spelarens egen förälder eller vårdnadshavare.`,
    '',
    'Det finns ingen åtgärd som krävs av dig just nu — det här är bara för din kännedom, om du vill följa upp med laget.',
    '',
    'Hälsningar,',
    'SkillStreak',
  ].join('\n');

  const safeTeamName = escapeHtml(teamName);
  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Ett klipp har rapporterats</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      Ett klipp som laddades upp av en spelare i <strong>${safeTeamName}</strong> har rapporterats av en lagkompis och är
      nu dolt för laget, som en försiktighetsåtgärd. Vi skickar också den här informationen till spelarens egen förälder
      eller vårdnadshavare.
    </p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      Det finns ingen åtgärd som krävs av dig just nu — det här är bara för din kännedom, om du vill följa upp med laget.
    </p>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
      Hälsningar,<br />SkillStreak
    </p>`;

  return { subject, html: wrapEmailHtml(subject, bodyHtml), text };
}
