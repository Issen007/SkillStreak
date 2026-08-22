import { escapeHtml } from '../mail/templates/html-escape.util';

/**
 * The parent-facing pages for ADR-0030's public-sharing consent.
 *
 * Swedish, because the reader is a Swedish parent who has just clicked a
 * link in an email and has no account, no app and no context beyond what
 * this page tells them. Everything they need to decide is on the page —
 * there is nowhere else for them to look.
 *
 * **These pages state the interim posture plainly rather than glossing
 * it.** ADR-0030's amended Decision 3 removed per-clip approval: once a
 * parent approves, their child publishes whichever of their own clips
 * they choose, whenever they choose, with no further prompt. A parent who
 * approves thinking they will be asked each time has not consented to
 * what actually happens, so the review page says so in bold before the
 * button rather than in small print under it.
 */

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1d21;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
${body}
</div>
</body>
</html>`;
}

const H1 = 'margin:0 0 16px;font-size:22px;';
const P = 'margin:0 0 12px;font-size:15px;line-height:1.5;';
const BTN =
  'display:inline-block;padding:12px 20px;border:0;border-radius:8px;' +
  'font-size:15px;font-weight:600;cursor:pointer;';

export function renderReviewPage(input: {
  screenName: string;
  reviewCode: string;
}): string {
  const name = escapeHtml(input.screenName);
  // Absolute paths, for the reason pt-consent-page.templates.ts documents
  // at length: this page is served without a trailing slash, so a relative
  // form action resolves against the parent directory and silently drops
  // the code. That bug reached real parents once already.
  const base = `/api/v1/public-sharing/${encodeURIComponent(input.reviewCode)}`;
  return page(
    'Godkänn delning utanför laget — SkillStreak',
    `
    <h1 style="${H1}">Godkänn delning utanför laget</h1>
    <p style="${P}"><strong>${name}</strong> vill kunna dela sina egna
      träningsklipp utanför laget, så att andra som tränar innebandy kan se dem.</p>

    <p style="${P};background:#fff8e1;border-left:3px solid #f5a623;padding:12px;border-radius:4px;">
      <strong>Viktigt att veta innan du godkänner:</strong> du kommer
      <strong>inte</strong> att bli tillfrågad för varje klipp. Om du
      godkänner här väljer ${name} själv vilka av sina egna klipp som ska
      delas, och när. Du kan när som helst stänga av det igen.</p>

    <p style="${P}"><strong>Om du godkänner kan andra se:</strong> klippet,
      ${name}s skärmnamn och avatar.</p>
    <p style="${P}"><strong>Andra ser aldrig:</strong> riktigt namn,
      kontaktuppgifter, lagnamn, ort, lagchatt eller något om var ${name}
      tränar. Appen sparar aldrig plats. Bildtexten ${name} skrivit till
      klippet stannar också inom laget.</p>
    <p style="${P}"><strong>Om du stänger av det igen</strong> slutar alla
      klipp som delats att synas direkt, och de börjar inte synas igen av
      sig själva. Säger du ja en gång till får ${name} välja om varje klipp
      på nytt.</p>
    <p style="${P}">${name} kan bara dela sina <em>egna</em> klipp — aldrig
      någon annans.</p>
    <p style="${P}">Vi påminner dig med e-post en gång i månaden så länge
      det här är påslaget, så att du inte glömmer bort att det är på.</p>

    <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
      <form method="post" action="${escapeHtml(`${base}/approve`)}" style="margin:0;">
        <button type="submit" style="${BTN}background:#1f7a3f;color:#fff;">Godkänn</button>
      </form>
      <form method="post" action="${escapeHtml(`${base}/decline`)}" style="margin:0;">
        <button type="submit" style="${BTN}background:#eceef1;color:#1a1d21;">Nej tack</button>
      </form>
    </div>
    <p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">
      Om du inte gör något händer ingenting. Länken slutar gälla 14 dagar
      efter att den skickades.</p>
  `,
  );
}

export function renderApprovedPage(screenName: string): string {
  return page(
    'Godkänt — SkillStreak',
    `
    <h1 style="${H1}">Tack — det är godkänt</h1>
    <p style="${P}"><strong>${escapeHtml(screenName)}</strong> kan nu välja
      att dela sina egna klipp utanför laget.</p>
    <p style="${P}">Vi har skickat dig ett mejl med en länk du kan använda
      när som helst för att stänga av det igen. <strong>Spara det
      mejlet</strong> — länken slutar aldrig att gälla.</p>
    <p style="${P}">Du får också en påminnelse en gång i månaden så länge
      delningen är påslagen.</p>
  `,
  );
}

export function renderDeclinedPage(): string {
  return page(
    'Nej tack — SkillStreak',
    `
    <h1 style="${H1}">Tack för svaret</h1>
    <p style="${P}">Ingen delning utanför laget har slagits på. Klipp syns
      bara för det egna laget, precis som tidigare.</p>
    <p style="${P}">Du behöver inte göra något mer.</p>
  `,
  );
}

export function renderRevokePreviewPage(input: {
  screenName: string;
  revokeCode: string;
}): string {
  const name = escapeHtml(input.screenName);
  const action = escapeHtml(
    `/api/v1/public-sharing/revoke/${encodeURIComponent(input.revokeCode)}`,
  );
  return page(
    'Stäng av delning utanför laget — SkillStreak',
    `
    <h1 style="${H1}">Stäng av delning utanför laget</h1>
    <p style="${P}">Delning utanför laget är påslagen för
      <strong>${name}</strong>.</p>
    <p style="${P}">Om du stänger av den försvinner <strong>alla</strong>
      ${name}s klipp från det publika flödet direkt. Klippen finns kvar för
      det egna laget.</p>
    <div style="margin-top:24px;">
      <form method="post" action="${action}" style="margin:0;">
        <button type="submit" style="${BTN}background:#b3261e;color:#fff;">Stäng av delning</button>
      </form>
    </div>
  `,
  );
}

export function renderRevokedPage(): string {
  return page(
    'Avstängt — SkillStreak',
    `
    <h1 style="${H1}">Delningen är avstängd</h1>
    <p style="${P}">Klippen syns nu bara för det egna laget igen. Det gäller
      direkt, även klipp som delats tidigare.</p>
    <p style="${P}">Vill ni slå på det igen får ditt barn skicka en ny
      förfrågan från appen.</p>
  `,
  );
}

/**
 * One page for every dead link — expired, already used, already revoked,
 * or simply wrong. Deliberately does not distinguish between them: the
 * code is the only credential these routes have, so telling an unknown
 * visitor *why* a code failed turns the page into an oracle for guessing
 * valid ones.
 */
export function renderInvalidPage(): string {
  return page(
    'Länken gäller inte — SkillStreak',
    `
    <h1 style="${H1}">Länken gäller inte längre</h1>
    <p style="${P}">Den här länken har antingen redan använts, gått ut,
      eller så har inställningen redan ändrats.</p>
    <p style="${P}">Om ditt barn fortfarande vill kunna dela klipp utanför
      laget kan de skicka en ny förfrågan från appen, så får du ett nytt
      mejl.</p>
  `,
  );
}
