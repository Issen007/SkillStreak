// docs/adr/0020-usage-analytics-product-metrics.md Decision 5 — the
// monthly usage/product-metrics report, emailed to the project owner via
// the same MailService/SMTP relay every other template here uses. No new
// delivery mechanism, no new templating library.
//
// Two deliberate differences from its sibling templates in this folder:
//
// 1. **English, not Swedish.** Every other template here is addressed to a
//    child's parent, a coach, or a player — real product copy, so Swedish
//    (see CLAUDE.md's language note). This one is internal
//    project-owner-only operational output with no player-facing surface at
//    all (Decision 4), the same audience and language as
//    `tools/uptime-monitor`'s alert emails.
// 2. **Domain-free input.** Takes a plain, already-formatted section list
//    rather than the UsageMetricsReport type, for exactly the reason
//    chat-report-notification-email.template.ts takes a `reasonLabel`
//    string instead of importing team-chat's enum: mail/templates stays
//    free of a dependency on any feature module. The formatting lives in
//    usage-metrics/usage-report-sections.ts, next to the numbers it
//    describes.
import { RenderedEmail } from './consent-request-email.template';
import { escapeHtml } from './html-escape.util';

export interface UsageReportEmailSection {
  heading: string;
  /** Pre-formatted "label: value" lines — never raw child data. Decision 3
   * guarantees at the source that nothing reaching this template is a
   * per-player or named-team value; this template deliberately can't tell
   * the difference, so the guarantee has to hold upstream, not here. */
  lines: string[];
  /** Optional caveat printed under the section in smaller type (e.g. what
   * a window-scoped number does and doesn't include). */
  note?: string;
}

export interface UsageReportEmailInput {
  /** e.g. '2026-08-01' — the run date, used in the subject line so a year
   * of these sorts sensibly in an inbox. */
  generatedOn: string;
  /** e.g. 'trailing 30 days, 2026-07-02 to 2026-08-01'. */
  windowLabel: string;
  sections: UsageReportEmailSection[];
}

export function buildUsageReportEmail(
  input: UsageReportEmailInput,
): RenderedEmail {
  const { generatedOn, windowLabel, sections } = input;

  const subject = `[SkillStreak] Usage report — ${generatedOn}`;

  const text = [
    'SkillStreak usage report',
    `Generated: ${generatedOn}`,
    `Window: ${windowLabel}`,
    '',
    'Aggregate figures only — no per-player and no named-team numbers,',
    'by design (docs/adr/0020-usage-analytics-product-metrics.md Decision 3).',
    ...sections.flatMap((section) => [
      '',
      `== ${section.heading} ==`,
      ...section.lines,
      ...(section.note ? [`(${section.note})`] : []),
    ]),
  ].join('\n');

  const sectionsHtml = sections
    .map(
      (section) => `
              <h2 style="margin:24px 0 8px;font-size:16px;color:#1B1B3A;">${escapeHtml(section.heading)}</h2>
              <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;">
                ${section.lines
                  .map((line) => `<li>${escapeHtml(line)}</li>`)
                  .join('\n                ')}
              </ul>${
                section.note
                  ? `
              <p style="margin:6px 0 0;font-size:12px;line-height:1.5;color:#5B5B7A;">${escapeHtml(section.note)}</p>`
                  : ''
              }`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1B1B3A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFAF7;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:16px;padding:32px;max-width:600px;">
          <tr>
            <td>
              <h1 style="margin:0 0 4px;font-size:20px;color:#1B1B3A;">SkillStreak usage report</h1>
              <p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:#5B5B7A;">
                Generated ${escapeHtml(generatedOn)} &middot; ${escapeHtml(windowLabel)}
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#5B5B7A;">
                Aggregate figures only — no per-player and no named-team numbers, by design
                (ADR-0020 Decision 3).
              </p>${sectionsHtml}
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
