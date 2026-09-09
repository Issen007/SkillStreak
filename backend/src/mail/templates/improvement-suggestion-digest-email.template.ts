// docs/adr/0037-in-app-improvement-suggestions.md — the weekly digest of
// the improvement-suggestion queue, emailed to the project owner via the
// same MailService/SMTP relay every other template here uses. No new
// delivery mechanism, no new templating library.
//
// Two deliberate properties, both load-bearing:
//
// 1. **Counts only. No child-authored text ever reaches this template.**
//    The project owner chose this shape on 2026-09-09 over mailing the
//    suggestions themselves: a child's free text copied into a mailbox is
//    outside the 90-day retention sweep, outside the erasure cascade, and
//    outside every other control this app has over that data. The digest
//    is a nudge to go and open the console, not a copy of the queue.
//    `ImprovementSuggestionDigestCounts` has no field a suggestion's body
//    could be put in, which is the second layer under that promise.
// 2. **English, not Swedish.** Same audience and reasoning as
//    usage-report-email.template.ts: internal, project-owner-only
//    operational output with no player-facing surface at all. Every other
//    template in this folder is addressed to a child, a parent or a coach
//    and is therefore Swedish.
import { RenderedEmail } from './consent-request-email.template';
import { escapeHtml } from './html-escape.util';

export interface ImprovementSuggestionDigestCounts {
  /** Filed in the trailing window — the "anything new?" number. */
  newInWindow: number;
  /** Still `open` across the whole table: the actual backlog. */
  open: number;
  /** Picked up but not finished. */
  triaged: number;
  /** Deliberately included: a week where the only movement was closing
   * things is still movement, and a digest that only ever counts arrivals
   * makes the queue look like it never drains. */
  closed: number;
  /** e.g. 7 — stated in the mail so the first number is unambiguous. */
  windowDays: number;
  /** e.g. '2026-09-09' — the run date, so a year of these sorts sensibly
   * in an inbox. */
  generatedOn: string;
}

export function buildImprovementSuggestionDigestEmail(
  counts: ImprovementSuggestionDigestCounts,
): RenderedEmail {
  const { newInWindow, open, triaged, closed, windowDays, generatedOn } =
    counts;

  const subject =
    newInWindow > 0
      ? `[SkillStreak] ${newInWindow} new idea${newInWindow === 1 ? '' : 's'} from players — ${generatedOn}`
      : `[SkillStreak] Idea queue: ${open} still open — ${generatedOn}`;

  const lines = [
    `New in the last ${windowDays} days: ${newInWindow}`,
    `Open: ${open}`,
    `Triaged: ${triaged}`,
    `Closed: ${closed}`,
  ];

  const text = [
    'SkillStreak — player improvement suggestions',
    `Generated: ${generatedOn}`,
    '',
    ...lines,
    '',
    'Counts only. What the players actually wrote is in the staff',
    'console under "Ideas" — it is deliberately not copied into this',
    'mail, so children’s own words stay inside the app’s retention',
    'and erasure rules.',
    '',
    'Suggestions are deleted 90 days after they arrive. If one is worth',
    'keeping, write it into the backlog in your own words.',
  ].join('\n');

  const html = [
    '<p><strong>SkillStreak — player improvement suggestions</strong></p>',
    `<p>Generated: ${escapeHtml(generatedOn)}</p>`,
    '<ul>',
    // escapeHtml on values that are numbers today is not defensive
    // theatre: it is what keeps this template safe if someone later
    // widens the input type. The template can't tell where a value came
    // from, so it escapes everything it prints.
    ...lines.map((line) => `<li>${escapeHtml(line)}</li>`),
    '</ul>',
    '<p>Counts only. What the players actually wrote is in the staff console under &ldquo;Ideas&rdquo; — it is deliberately not copied into this mail, so children&rsquo;s own words stay inside the app&rsquo;s retention and erasure rules.</p>',
    '<p style="color:#666;font-size:13px">Suggestions are deleted 90 days after they arrive. If one is worth keeping, write it into the backlog in your own words.</p>',
  ].join('\n');

  return { subject, html, text };
}
