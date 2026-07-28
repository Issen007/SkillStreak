// docs/adr/0012-profile-page-and-contact-email-change.md's addendum —
// the cancel link's landing pages. Same reasoning/shape as
// consent/consent-page.templates.ts: inline-styled, no external assets
// (email clients/security scanners prefetch GET links), GET has zero
// side effects, only POST (the button on the GET page) actually cancels.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1B1B3A;">
  <div style="max-width:480px;margin:48px auto;padding:32px;background-color:#FFFFFF;border-radius:16px;box-shadow:0 2px 12px rgba(27,27,58,0.08);">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

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
