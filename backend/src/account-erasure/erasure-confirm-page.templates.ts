// docs/adr/0013-account-erasure.md Decision 3 — the confirm link's landing
// pages. Same reasoning/shape as
// profile/contact-change-cancel-page.templates.ts / consent/
// consent-page.templates.ts: inline-styled, no external assets (email
// clients/security scanners prefetch GET links), GET has zero side
// effects, only POST (the button on the GET page) actually starts the
// 30-day grace period.

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

/** GET, valid code: the genuine confirm step — a human must press this
 * button (which POSTs) for the 30-day grace period to actually start. */
export function renderErasureConfirmPreviewPage(screenName: string): string {
  const safeName = escapeHtml(screenName);
  return page(
    'Bekräfta radering av kontot — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Bekräfta radering av kontot</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
      Någon har bett om att radera <strong>${safeName}</strong>s konto på SkillStreak, inklusive
      allt innehåll kontot äger. Att trycka på knappen nedan startar en 30 dagars ångerperiod —
      kontot raderas inte förrän den perioden gått ut, och du kan avbryta när som helst innan dess.
    </p>
    <form method="POST" action="">
      <button type="submit" style="background-color:#FF6B35;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        Bekräfta radering
      </button>
    </form>
    `,
  );
}

export function renderErasureConfirmInvalidPage(): string {
  return page(
    'Länken fungerar inte längre — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Länken fungerar inte längre</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Den här länken är ogiltig, för gammal, eller så har begäran redan bekräftats eller avbrutits.
    </p>
    `,
  );
}

export function renderErasureConfirmedPage(
  scheduledForDateLabel: string,
): string {
  const safeDateLabel = escapeHtml(scheduledForDateLabel);
  return page(
    'Bekräftat — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">Bekräftat</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Raderingen är bekräftad. Kontot raderas den <strong>${safeDateLabel}</strong>, om inte begäran
      avbryts innan dess — antingen direkt i appen (under Profil) eller via länken i det separata
      mejl som just skickats.
    </p>
    `,
  );
}
