// docs/adr/0012-profile-page-and-contact-email-change.md's addendum —
// the cancel link's landing pages. Same reasoning/shape as
// consent/consent-page.templates.ts: inline-styled, no external assets
// (email clients/security scanners prefetch GET links), GET has zero
// side effects, only POST (the button on the GET page) actually cancels.

import { escapeHtml } from '../mail/templates/html-escape.util';
import { renderTransactionalHtmlPage as page } from '../common/html/transactional-page.util';

/** GET, valid code: the genuine cancel step — a human must press this
 * button (which POSTs) for anything to actually happen. */
export function renderCancelConfirmPage(screenName: string): string {
  const safeName = escapeHtml(screenName);
  return page(
    `Avbryt bytet av kontaktadress — SkillStreak`,
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Avbryt bytet av kontaktadress</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
      En kontaktadressändring för <strong>${safeName}</strong>s konto på SkillStreak väntar
      på att träda i kraft. Om det inte var du (eller din förälder) som bad om detta,
      tryck på knappen nedan för att stoppa ändringen. Det loggar också ut alla
      aktiva sessioner på kontot.
    </p>
    <form method="POST" action="">
      <button type="submit" style="background-color:#FF6B35;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        Avbryt bytet
      </button>
    </form>
    `,
  );
}

export function renderCancelInvalidPage(): string {
  return page(
    'Länken fungerar inte längre — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Länken fungerar inte längre</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Den här länken är ogiltig, för gammal, eller så har ändringen redan trätt i kraft
      eller redan avbrutits.
    </p>
    `,
  );
}

export function renderCancelAppliedPage(): string {
  return page(
    'Avbrutet — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">Avbrutet</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Kontaktadressändringen är stoppad, och alla aktiva sessioner på kontot har loggats
      ut. Ingenting mer behöver göras.
    </p>
    `,
  );
}
