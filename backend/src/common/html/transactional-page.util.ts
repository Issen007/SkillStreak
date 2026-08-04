// Shared inline-styled HTML wrapper for every mailed-link landing page
// (account erasure cancel/confirm, contact-change cancel, parental
// consent) — extracted after the same wrapper markup was independently
// duplicated in `account-erasure/erasure-cancel-page.templates.ts`,
// `account-erasure/erasure-confirm-page.templates.ts`, and
// `profile/contact-change-cancel-page.templates.ts`, with
// `consent/consent-page.templates.ts` carrying the same markup plus a
// `locale` param (docs/adr/0014-multi-language-support.md Decision 3).
// All four now share this one copy so the markup can't silently drift
// between pages. No external assets (fonts/CSS/images) — email clients
// and security scanners prefetch links in emails, and GET must have no
// side effects, so this stays self-contained.
import { PlayerLocale } from '../locale/player-locale.enum';

export function renderTransactionalHtmlPage(
  title: string,
  bodyHtml: string,
  locale: PlayerLocale = PlayerLocale.SV,
): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
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
