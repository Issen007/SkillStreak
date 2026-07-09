// docs/adr/0007-team-chat.md Decision 3 — the best-effort email sent to (a)
// the reported player's own parent and (b) the team's coach, if one is on
// file, at most once per reported player per rolling 24 hours (see
// RedisService.tryClaimChatReportNotifyCooldown). One shared template for
// both recipients (same content, different address) — same "reuse, don't
// duplicate" posture as consent-request-email.template.ts.
//
// Deliberately does NOT name the reporter anywhere (ADR-0007 Decision 1's
// anonymity guarantee — retaliation-prevention in a peer group with no
// adult mediating it) and deliberately plain, non-alarmist copy, same
// reasoning as the consent-request email: this app's audience is children's
// parents/coaches, not just the players.
import { RenderedEmail } from './consent-request-email.template';
import { escapeHtml } from './html-escape.util';

// Deliberately takes an already-Swedish-translated `reasonLabel` string
// rather than importing team-chat's ChatMessageReportReason enum — keeps
// mail/templates free of a dependency on team-chat/ (the enum-to-Swedish-
// label mapping lives in TeamChatService, which owns the enum).
export interface ChatReportNotificationEmailInput {
  reportedScreenName: string;
  teamName: string;
  reasonLabel: string;
  messageContent: string;
}

export function buildChatReportNotificationEmail(
  input: ChatReportNotificationEmailInput,
): RenderedEmail {
  const { reportedScreenName, teamName, reasonLabel, messageContent } = input;

  const subject = `Ett meddelande från ${reportedScreenName} i ${teamName} har rapporterats`;

  const text = [
    'Hej!',
    '',
    `Ett meddelande som ${reportedScreenName} skrev i lagchatten för ${teamName} på SkillStreak har rapporterats av en lagkompis, med anledningen "${reasonLabel}".`,
    '',
    `Meddelandet löd: "${messageContent}"`,
    '',
    'Det här är en automatisk avisering — SkillStreak döljer inte meddelandet automatiskt. Vi rekommenderar att du pratar med ditt barn/laget om vad som hänt.',
    '',
    'Vem som rapporterade meddelandet visas inte, för att skydda den personen.',
  ].join('\n');

  const safeScreenName = escapeHtml(reportedScreenName);
  const safeTeamName = escapeHtml(teamName);
  const safeReasonLabel = escapeHtml(reasonLabel);
  const safeMessageContent = escapeHtml(messageContent);

  const html = `<!DOCTYPE html>
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1B1B3A;">Ett meddelande har rapporterats</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
                Ett meddelande som <strong>${safeScreenName}</strong> skrev i lagchatten för <strong>${safeTeamName}</strong>
                på SkillStreak har rapporterats av en lagkompis, med anledningen &quot;${safeReasonLabel}&quot;.
              </p>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;padding:12px;background-color:#FAFAF7;border-radius:8px;">
                &quot;${safeMessageContent}&quot;
              </p>
              <p style="margin:0 0 12px;font-size:13px;line-height:1.5;">
                Det här är en automatisk avisering — SkillStreak döljer inte meddelandet automatiskt. Vi rekommenderar att du pratar med ditt barn/laget om vad som hänt.
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#1B1B3A;">
                Vem som rapporterade meddelandet visas inte, för att skydda den personen.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
