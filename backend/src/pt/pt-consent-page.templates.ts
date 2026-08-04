// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A3's mailed
// review-and-approve endpoints, and Decision A4 point 2's revoke link —
// same GET-preview/POST-action landing-page shape as account-erasure's
// erasure-confirm/cancel pages, sharing the same
// renderTransactionalHtmlPage wrapper so the markup can't silently drift.
import { escapeHtml } from '../mail/templates/html-escape.util';
import { renderTransactionalHtmlPage as page } from '../common/html/transactional-page.util';

/** GET, valid code — the actual informed-consent moment: names the PT and
 * states plainly what becomes visible if approved / what never does,
 * mirroring the request email's own copy (Decision A3). Two buttons
 * (approve/decline), each its own POST — neither fires on the GET itself. */
export function renderPtConsentReviewPage(input: {
  screenName: string;
  ptDisplayName: string;
  ptEmail: string;
}): string {
  const safeScreenName = escapeHtml(input.screenName);
  const safePtDisplayName = escapeHtml(input.ptDisplayName);
  const safePtEmail = escapeHtml(input.ptEmail);
  return page(
    'Granska tränarförfrågan — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Granska tränarförfrågan</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      <strong>${safePtDisplayName}</strong> (${safePtEmail}) har bett om att bli godkänd som personlig tränare
      för <strong>${safeScreenName}</strong> på SkillStreak.
    </p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;">
      <strong>Om du godkänner ser den här personen:</strong> skärmnamn, träningsstreak, träningsloggen
      (datum, aktivitetstyp, längd) och intjänade märken.
    </p>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.5;">
      <strong>Den här personen ser ALDRIG:</strong> riktigt namn, kontaktuppgifter, lagchatt, videoklipp,
      eller några andra spelares data.
    </p>
    <form method="POST" action="approve" style="display:inline-block;margin-right:12px;">
      <button type="submit" style="background-color:#3DAA6B;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        Godkänn
      </button>
    </form>
    <form method="POST" action="decline" style="display:inline-block;">
      <button type="submit" style="background-color:#FFFFFF;color:#1B1B3A;border:1px solid #D9D9E3;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        Avböj
      </button>
    </form>
    `,
  );
}

export function renderPtConsentInvalidPage(): string {
  return page(
    'Länken fungerar inte längre — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Länken fungerar inte längre</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Den här länken är ogiltig, för gammal, eller så har begäran redan avgjorts.
    </p>
    `,
  );
}

export function renderPtConsentApprovedPage(ptDisplayName: string): string {
  const safeName = escapeHtml(ptDisplayName);
  return page(
    'Godkänt — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">Godkänt</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      <strong>${safeName}</strong> kan nu se träningsdatan. Ett bekräftelsemejl med en länk för att när som
      helst återkalla tillgången skickas separat.
    </p>
    `,
  );
}

export function renderPtConsentDeclinedPage(): string {
  return page(
    'Avböjt — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Avböjt</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Förfrågan är avböjd. Ingen träningsdata delas.
    </p>
    `,
  );
}

/** GET, valid revoke code — Decision A4 point 2's non-expiring link. */
export function renderPtConsentRevokePreviewPage(input: {
  screenName: string;
  ptDisplayName: string;
}): string {
  const safeScreenName = escapeHtml(input.screenName);
  const safePtDisplayName = escapeHtml(input.ptDisplayName);
  return page(
    'Återkalla tränartillgång — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Återkalla tränartillgång</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
      Detta tar omedelbart bort <strong>${safePtDisplayName}</strong>s tillgång till
      <strong>${safeScreenName}</strong>s träningsdata på SkillStreak. Inget skäl behövs.
    </p>
    <form method="POST" action="">
      <button type="submit" style="background-color:#1B1B3A;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        Återkalla tillgången
      </button>
    </form>
    `,
  );
}

export function renderPtConsentRevokedPage(): string {
  return page(
    'Återkallat — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">Återkallat</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Tillgången är återkallad med omedelbar verkan.
    </p>
    `,
  );
}

export function renderPtConsentRevokeInvalidPage(): string {
  return page(
    'Länken fungerar inte längre — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Länken fungerar inte längre</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Den här länken är ogiltig, eller så är tillgången redan återkallad.
    </p>
    `,
  );
}
