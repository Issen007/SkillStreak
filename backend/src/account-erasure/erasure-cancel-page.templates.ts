// docs/adr/0013-account-erasure.md Decision 3/7 — the mailed cancel link's
// landing pages. A BACKUP path ("I don't have my session / this is a new
// phone"), not the primary one (that's the authenticated
// POST /players/me/erasure/cancel — see AccountErasureController) — but
// this route deliberately mirrors the confirm page's GET/POST split for
// the same email-prefetch-safety reason.

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
export function renderErasureCancelPreviewPage(screenName: string): string {
  const safeName = escapeHtml(screenName);
  return page(
    'Avbryt radering av kontot — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Avbryt radering av kontot</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
      En begäran om att radera <strong>${safeName}</strong>s konto på SkillStreak väntar på att
      genomföras. Tryck på knappen nedan för att avbryta — kontot och allt dess innehåll finns kvar
      precis som vanligt.
    </p>
    <form method="POST" action="">
      <button type="submit" style="background-color:#FF6B35;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        Avbryt raderingen
      </button>
    </form>
    `,
  );
}

export function renderErasureCancelInvalidPage(): string {
  return page(
    'Länken fungerar inte längre — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Länken fungerar inte längre</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Den här länken är ogiltig, för gammal, eller så har raderingen redan avbrutits eller
      genomförts.
    </p>
    `,
  );
}

export function renderErasureCancelledPage(): string {
  return page(
    'Avbrutet — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">Avbrutet</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Raderingen av kontot är avbruten. Ingenting mer behöver göras — kontot fortsätter fungera
      precis som vanligt.
    </p>
    `,
  );
}
