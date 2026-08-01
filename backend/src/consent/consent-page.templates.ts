// Inline-styled, self-contained HTML for the parent-facing consent pages —
// no external assets (fonts/CSS/images), per the task: email clients and
// security scanners often prefetch links in emails, and a page that loads
// external resources on GET would be a needless second side channel on top
// of the "GET must have no side effects" rule these pages already follow.
// Not a full app screen — a one-off transactional page, kept minimal.
// Colors are the docs/design/style-guide.md tokens (paper/ink/flame/gold/
// success); no external font — system font stack only.
//
// docs/adr/0014-multi-language-support.md Decision 3 — this page takes the
// same locale as its corresponding email, resolved the same way (the
// Player row the consentToken already resolves to). Only the four pages
// that have a resolved Player in hand (confirm/approved, both flavors)
// take a `locale` param — the invalid/already-used pages have no token to
// resolve a Player from, so they stay the existing hardcoded Swedish copy,
// same as before this ADR. `COPY`/`resolveCopy` per-page, same pattern as
// every mail template in `mail/templates/*.template.ts` — only `sv` has
// real content; en/fi/da/nb fall through to it (no translation content in
// part (a), per the ADR).

import { PlayerLocale } from '../common/locale/player-locale.enum';

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

interface ConsentConfirmCopy {
  title: (safeName: string) => string;
  heading: (safeName: string) => string;
  body1: (safeName: string) => string;
  body2: (safeName: string) => string;
  button: string;
}

const CONSENT_CONFIRM_COPY: Partial<Record<PlayerLocale, ConsentConfirmCopy>> =
  {
    sv: {
      title: (safeName) => `Godkänn ${safeName} — SkillStreak`,
      heading: (safeName) => `Godkänn ${safeName} på SkillStreak`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> vill logga träningspass i SkillStreak — en app för dagliga
      träningsstreak och ett gemensamt lagpoäng-mål. Inga bilder eller platsdata samlas in,
      och ${safeName} syns bara för sitt eget lag.`,
      body2: (safeName) =>
        `Om du godkänner kan ${safeName} börja logga träningspass från och med nu. Du kan alltid
      höra av dig till tränaren om du ändrar dig senare.`,
      button: 'Jag godkänner',
    },
    // en/fi/da/nb/de/cs/fr: added incrementally, per part (b).
  };

function resolveConsentConfirmCopy(locale: PlayerLocale): ConsentConfirmCopy {
  return CONSENT_CONFIRM_COPY[locale] ?? CONSENT_CONFIRM_COPY.sv!;
}

/** GET, valid token: the genuine confirmation step — a human must press
 * this button (which POSTs) for anything to actually change. */
export function renderConsentConfirmPage(
  screenName: string,
  locale: PlayerLocale,
): string {
  const safeName = escapeHtml(screenName);
  const copy = resolveConsentConfirmCopy(locale);
  return page(
    copy.title(safeName),
    `
    <h1 style="margin:0 0 16px;font-size:22px;">${copy.heading(safeName)}</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      ${copy.body1(safeName)}
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
      ${copy.body2(safeName)}
    </p>
    <form method="POST" action="">
      <button type="submit" style="background-color:#FF6B35;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        ${copy.button}
      </button>
    </form>
    `,
  );
}

const SELF_VERIFICATION_CONFIRM_COPY: Partial<
  Record<PlayerLocale, ConsentConfirmCopy>
> = {
  sv: {
    title: () => `Verifiera ditt konto — SkillStreak`,
    heading: () => `Verifiera ditt konto på SkillStreak`,
    body1: (safeName) =>
      `Nästan klart, <strong>${safeName}</strong>! Bekräfta att det här är din e-post för att
      aktivera ditt konto. Inga bilder eller platsdata samlas in, och du syns bara för ditt eget lag.`,
    body2: () =>
      `När du bekräftar kan du börja logga träningspass från och med nu.`,
    button: 'Verifiera mitt konto',
  },
  // en/fi/da/nb/de/cs/fr: added incrementally, per part (b).
};

function resolveSelfVerificationConfirmCopy(
  locale: PlayerLocale,
): ConsentConfirmCopy {
  return (
    SELF_VERIFICATION_CONFIRM_COPY[locale] ?? SELF_VERIFICATION_CONFIRM_COPY.sv!
  );
}

/** GET, valid token, self-verification (13+, added 2026-07-27) — first-
 * person copy: the player is confirming their own email, nobody else is
 * being asked anything, unlike renderConsentConfirmPage's "does a parent
 * approve this child" framing. Same POST-to-confirm mechanism. */
export function renderSelfVerificationConfirmPage(
  screenName: string,
  locale: PlayerLocale,
): string {
  const safeName = escapeHtml(screenName);
  const copy = resolveSelfVerificationConfirmCopy(locale);
  return page(
    copy.title(safeName),
    `
    <h1 style="margin:0 0 16px;font-size:22px;">${copy.heading(safeName)}</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      ${copy.body1(safeName)}
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
      ${copy.body2(safeName)}
    </p>
    <form method="POST" action="">
      <button type="submit" style="background-color:#FF6B35;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        ${copy.button}
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

interface ConsentApprovedCopy {
  title: string;
  heading: string;
  body: (safeName: string) => string;
}

const CONSENT_APPROVED_COPY: Partial<
  Record<PlayerLocale, ConsentApprovedCopy>
> = {
  sv: {
    title: 'Tack! — SkillStreak',
    heading: 'Tack!',
    body: (safeName) => `${safeName} kan nu börja logga träningar.`,
  },
  // en/fi/da/nb/de/cs/fr: added incrementally, per part (b).
};

function resolveConsentApprovedCopy(locale: PlayerLocale): ConsentApprovedCopy {
  return CONSENT_APPROVED_COPY[locale] ?? CONSENT_APPROVED_COPY.sv!;
}

/** POST, successful approval. */
export function renderConsentApprovedPage(
  screenName: string,
  locale: PlayerLocale,
): string {
  const safeName = escapeHtml(screenName);
  const copy = resolveConsentApprovedCopy(locale);
  return page(
    copy.title,
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">${copy.heading}</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      ${copy.body(safeName)}
    </p>
    `,
  );
}

const SELF_VERIFICATION_APPROVED_COPY: Partial<
  Record<PlayerLocale, ConsentApprovedCopy>
> = {
  sv: {
    title: 'Klart! — SkillStreak',
    heading: 'Klart!',
    body: (safeName) =>
      `Ditt konto är verifierat, ${safeName}. Du kan nu börja logga träningar.`,
  },
  // en/fi/da/nb/de/cs/fr: added incrementally, per part (b).
};

function resolveSelfVerificationApprovedCopy(
  locale: PlayerLocale,
): ConsentApprovedCopy {
  return (
    SELF_VERIFICATION_APPROVED_COPY[locale] ??
    SELF_VERIFICATION_APPROVED_COPY.sv!
  );
}

/** POST, successful self-verification (13+). */
export function renderSelfVerificationApprovedPage(
  screenName: string,
  locale: PlayerLocale,
): string {
  const safeName = escapeHtml(screenName);
  const copy = resolveSelfVerificationApprovedCopy(locale);
  return page(
    copy.title,
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">${copy.heading}</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      ${copy.body(safeName)}
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
