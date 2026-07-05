// Inline-styled, self-contained HTML for the parent-facing consent pages —
// no external assets (fonts/CSS/images), per the task: email clients and
// security scanners often prefetch links in emails, and a page that loads
// external resources on GET would be a needless second side channel on top
// of the "GET must have no side effects" rule these pages already follow.
// Not a full app screen — a one-off transactional page, kept minimal.
// Colors are the docs/design/style-guide.md tokens (paper/ink/flame/gold/
// success); no external font — system font stack only.

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

/** GET, valid token: the genuine confirmation step — a human must press
 * this button (which POSTs) for anything to actually change. */
export function renderConsentConfirmPage(screenName: string): string {
  const safeName = escapeHtml(screenName);
  return page(
    `Godkänn ${safeName} — SkillStreak`,
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Godkänn ${safeName} på SkillStreak</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      <strong>${safeName}</strong> vill logga träningspass i SkillStreak — en app för dagliga
      träningsstreak och ett gemensamt lagpoäng-mål. Inga bilder eller platsdata samlas in,
      och ${safeName} syns bara för sitt eget lag.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
      Om du godkänner kan ${safeName} börja logga träningspass från och med nu. Du kan alltid
      höra av dig till tränaren om du ändrar dig senare.
    </p>
    <form method="POST" action="">
      <button type="submit" style="background-color:#FF6B35;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        Jag godkänner
      </button>
    </form>
    `,
  );
}

/** GET, invalid/expired/already-consumed token: deliberately identical
 * copy regardless of *why* the token doesn't resolve — never hints
 * whether it was close to valid. */
export function renderConsentInvalidPage(): string {
  return page(
    'Länken är inte längre giltig — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Länken är inte längre giltig</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Den här länken för godkännande fungerar inte längre. Det kan bero på att den redan har
      använts eller gått ut. Hör av dig till tränaren om du behöver en ny länk.
    </p>
    `,
  );
}

/** POST, successful approval. */
export function renderConsentApprovedPage(screenName: string): string {
  const safeName = escapeHtml(screenName);
  return page(
    'Tack! — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">Tack!</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      ${safeName} kan nu börja logga träningar.
    </p>
    `,
  );
}

/** POST, token already consumed/invalid/expired — friendly, not an error,
 * since a second POST to an already-used link is an expected case (e.g. a
 * parent double-tapping the button), not a failure. */
export function renderConsentAlreadyUsedPage(): string {
  return page(
    'Redan bekräftat — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Redan bekräftat</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Det här godkännandet är redan genomfört, eller så har länken gått ut. Inget mer behöver
      göras. Hör av dig till tränaren om något verkar fel.
    </p>
    `,
  );
}
