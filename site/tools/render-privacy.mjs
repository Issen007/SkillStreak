/**
 * Renders docs/legal/privacy-policy-DRAFT.md into site/privacy/index.html.
 *
 * **Generated, never hand-edited.** A privacy policy that says one thing
 * in the repository and another on the website is worse than having no
 * page at all, and that drift stays invisible until someone compares the
 * two line by line. One source of truth, converted at build time.
 *
 * The converter handles exactly the constructs this document uses —
 * headings, tables, blockquotes, ordered and unordered lists, rules,
 * bold, italics and code spans — and throws on a line it cannot classify
 * rather than dropping it. Silently losing a clause from a legal document
 * is the one failure worth crashing a build over.
 *
 *   node site/tools/render-privacy.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const SRC = join(repoRoot, 'docs/legal/privacy-policy-DRAFT.md');
const OUT = join(repoRoot, 'site/privacy/index.html');

const esc = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Inline formatting.
 *
 * Code spans are lifted out first so that `**` inside one is not read as
 * bold. The placeholder is a private-use character rather than anything
 * digit- or punctuation-shaped: an earlier version used a bare number
 * between spaces, which happily matched ordinary prose like "for 90
 * days" and corrupted it.
 */
function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `${codes.length - 1}`;
  });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(
    /(\d+)/g,
    (_m, index) => `<code>${esc(codes[Number(index)])}</code>`,
  );
}

/** Blocks inside a blockquote: same rules, kept deliberately small. */
function renderQuoted(text) {
  return text
    .split(/\n{2,}/)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const trimmed = chunk.trim();
      const heading = /^(#{1,6})\s+([\s\S]*)$/.exec(trimmed);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${inline(heading[2].replace(/\n/g, ' '))}</h${level}>`;
      }
      if (/^-\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
        const ordered = /^\d+\.\s/.test(trimmed);
        const marker = ordered ? /^\d+\.\s+/ : /^-\s+/;
        // Continuation lines are folded into their item BEFORE inline
        // formatting runs. Without this, bold that opens on one source
        // line and closes on the next never meets its pair, and the
        // asterisks survive into the published page.
        const items = [];
        for (const raw of trimmed.split('\n')) {
          if (!raw.trim()) continue;
          if (marker.test(raw)) items.push(raw.replace(marker, ''));
          else if (items.length) items[items.length - 1] += ` ${raw.trim()}`;
        }
        const tag = ordered ? 'ol' : 'ul';
        return `<${tag}>${items
          .map((t) => `<li>${inline(t)}</li>`)
          .join('')}</${tag}>`;
      }
      return `<p>${inline(trimmed.replace(/\n/g, ' '))}</p>`;
    })
    .join('');
}

const lines = readFileSync(SRC, 'utf8').split('\n');
const out = [];
let i = 0;

const isTableRow = (l) => l.startsWith('|');
const isDivider = (l) => /^\|[\s:|-]+\|$/.test(l ?? '');
const startsBlock = (l) => /^(#{1,6}\s|>|\||-\s|\d+\.\s|---$)/.test(l);

while (i < lines.length) {
  const line = lines[i];

  if (line.trim() === '') {
    i += 1;
    continue;
  }

  if (line === '---') {
    out.push('<hr />');
    i += 1;
    continue;
  }

  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) {
    out.push(
      `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`,
    );
    i += 1;
    continue;
  }

  if (line.startsWith('>')) {
    const buf = [];
    while (i < lines.length && lines[i].startsWith('>')) {
      buf.push(lines[i].replace(/^>\s?/, ''));
      i += 1;
    }
    out.push(`<blockquote>${renderQuoted(buf.join('\n'))}</blockquote>`);
    continue;
  }

  if (isTableRow(line)) {
    const rows = [];
    while (i < lines.length && isTableRow(lines[i])) {
      rows.push(lines[i]);
      i += 1;
    }
    const cells = (r) =>
      r
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(isDivider(rows[1]) ? 2 : 1);
    out.push(
      `<table><thead><tr>${head
        .map((c) => `<th>${inline(c)}</th>`)
        .join('')}</tr></thead><tbody>${body
        .map(
          (r) =>
            `<tr>${cells(r)
              .map((c) => `<td>${inline(c)}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</tbody></table>`,
    );
    continue;
  }

  const ordered = /^\d+\.\s+(.*)$/.exec(line);
  const bulleted = /^-\s+(.*)$/.exec(line);
  if (ordered || bulleted) {
    const tag = ordered ? 'ol' : 'ul';
    const pattern = ordered ? /^\d+\.\s+(.*)$/ : /^-\s+(.*)$/;
    const items = [];
    while (i < lines.length) {
      const match = pattern.exec(lines[i]);
      if (match) {
        items.push(match[1]);
        i += 1;
        // Wrapped continuation lines are indented under their item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
        }
        continue;
      }
      // A blank line only ends the list if what follows is not part of it.
      if (lines[i].trim() === '' && /^(\s{2,}\S|\d+\.\s|-\s)/.test(lines[i + 1] ?? '')) {
        i += 1;
        continue;
      }
      break;
    }
    out.push(
      `<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`,
    );
    continue;
  }

  const para = [];
  while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) {
    para.push(lines[i].trim());
    i += 1;
  }
  if (para.length === 0) {
    throw new Error(
      `render-privacy: could not classify line ${i + 1}: ${JSON.stringify(lines[i])}`,
    );
  }
  out.push(`<p>${inline(para.join(' '))}</p>`);
}

const html = `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Integritetspolicy — SkillStreak</title>
<meta name="description" content="SkillStreak's privacy policy: what is collected about a player, why, how long it is kept, and who processes it." />
<!-- GENERATED from docs/legal/privacy-policy-DRAFT.md by site/tools/render-privacy.mjs. Do not edit by hand. -->
<style>
  :root { --ink:#1B1B3A; --paper:#FAFAF7; --muted:#6B6B85; --line:#E3E3EC; --warn-bg:#FFF8E1; --warn-line:#F0D98A; --code:#EFEFF4; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
    font:16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:760px; margin:0 auto; padding:32px 20px 72px; }
  h1 { font-size:30px; line-height:1.25; margin:0 0 24px; }
  h2 { font-size:22px; margin:36px 0 12px; padding-top:14px; border-top:1px solid var(--line); }
  h3 { font-size:17px; margin:24px 0 8px; }
  blockquote { margin:24px 0; padding:16px 18px; background:var(--warn-bg);
    border:1px solid var(--warn-line); border-radius:12px; }
  blockquote h2 { border:0; padding:0; margin:0 0 8px; font-size:18px; }
  blockquote > :last-child { margin-bottom:0; }
  table { width:100%; border-collapse:collapse; margin:16px 0; display:block; overflow-x:auto; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:700; }
  code { background:var(--code); padding:1px 5px; border-radius:5px; font-size:0.9em; word-break:break-word; }
  hr { border:0; border-top:1px solid var(--line); margin:32px 0; }
  a { color:#C2410C; }
  .back { display:inline-block; margin-bottom:20px; color:var(--muted); text-decoration:none; font-size:14px; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#F2F2F7; --paper:#141420; --muted:#A0A0B8; --line:#2C2C3E;
            --warn-bg:#2A2415; --warn-line:#5A4A1E; --code:#24243A; }
  }
</style>
</head>
<body>
<main>
<a class="back" href="/">&larr; skillstreak.xyz</a>
${out.join('\n')}
</main>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(
  `render-privacy: wrote ${OUT} — ${out.length} blocks, ${html.length} bytes`,
);
