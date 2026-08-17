import { Injectable, Logger } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The one author value that needs no recorded permission, because it
 *  identifies nobody. */
export const ANONYMOUS_AUTHOR = 'Anonym tränare';

export const DRILL_AGE_BANDS = ['9-11', '11-13', '13+'] as const;
export const DRILL_FOCUSES = [
  'teknik',
  'fys',
  'skott',
  'passning',
  'spelforstaelse',
] as const;

export type DrillAgeBand = (typeof DRILL_AGE_BANDS)[number];
export type DrillFocus = (typeof DRILL_FOCUSES)[number];

export interface Drill {
  slug: string;
  title: string;
  ageBand: DrillAgeBand;
  focus: DrillFocus;
  durationMinutes: number;
  locale: string;
  author: string;
  sourceNote: string | null;
  /**
   * Whether a coach has actually read this drill and vouched for it.
   *
   * Absent means false. Fail-closed on purpose: the failure this guards
   * against is unreviewed training advice reaching children, and a
   * forgotten field must not be the thing that publishes it.
   */
  coachReviewed: boolean;
  /** Markdown prose. Rendered escaped — it is text a human wrote, not markup. */
  body: string;
}

/** The listing shape: everything except the body, which is often long. */
export type DrillSummary = Omit<Drill, 'body'>;

/**
 * The coach drill library (ADR-0029 Decision 2).
 *
 * **There is deliberately no table.** Drills are Markdown files in this
 * repository, read once at boot. That is the point rather than a
 * shortcut: with no `drill` row, there is nothing for any query in this
 * app to join to a `player`, `team`, `video_clip` or `training_log_entry`
 * — Decision 1's "no per-child reference in the library" is
 * unrepresentable rather than merely forbidden. It also means the library
 * needs no entry in ADR-0013's per-entity erasure table, because there is
 * nothing about a child to erase.
 *
 * Moderation is `git` review: every change arrives as a diff, a human
 * reads it, and it merges through the existing flow. Decision 5 is
 * explicit that this is a *policy* control and must not be described to
 * anyone as filtered or checked content.
 *
 * Same mechanism as the Swedish wordlist — static, reviewable,
 * version-controlled data shipped into the image via `nest-cli.json`'s
 * `assets` entry and loaded with `readFileSync` relative to `__dirname`.
 *
 * Malformed files are skipped with a warning rather than crashing boot.
 * A typo in one drill's front matter must not take the API down; the
 * missing drill is visible in the console, and the log names the file.
 */
@Injectable()
export class DrillLibraryService {
  private readonly logger = new Logger(DrillLibraryService.name);
  private readonly drills: Drill[];

  constructor() {
    // Unreviewed drills are dropped here, at the boundary, rather than
    // filtered at each call site. Seven places read this library — the
    // coach API, drill groups, the health count and the training-plan
    // corpus among them — and a filter each of them has to remember is a
    // filter one of them will eventually forget.
    //
    // This mirrors Decision 1's reasoning about there being no `drill`
    // table at all: a draft that never enters `this.drills` cannot be
    // served by code that does not know drafts exist.
    const all = this.loadAll();
    this.drills = all.filter((drill) => drill.coachReviewed);

    const withheld = all.length - this.drills.length;
    this.logger.log(
      `Drill library loaded: ${this.drills.length} coach-reviewed drill(s)` +
        (withheld > 0
          ? `, ${withheld} withheld awaiting review (set coachReviewed: true to publish)`
          : '') +
        '.',
    );
  }

  list(filter?: {
    ageBand?: string;
    focus?: string;
    locale?: string;
  }): DrillSummary[] {
    return (
      this.drills
        .filter(
          (drill) =>
            (!filter?.ageBand || drill.ageBand === filter.ageBand) &&
            (!filter?.focus || drill.focus === filter.focus) &&
            (!filter?.locale || drill.locale === filter.locale),
        )
        // Body dropped explicitly rather than by destructuring, so the
        // listing's shape is a written decision instead of a side effect of
        // which fields happened to be omitted.
        .map((drill) => ({
          slug: drill.slug,
          title: drill.title,
          ageBand: drill.ageBand,
          focus: drill.focus,
          durationMinutes: drill.durationMinutes,
          locale: drill.locale,
          author: drill.author,
          sourceNote: drill.sourceNote,
        }))
        .sort((a, b) => a.title.localeCompare(b.title, 'sv'))
    );
  }

  findBySlug(slug: string): Drill | null {
    return this.drills.find((drill) => drill.slug === slug) ?? null;
  }

  private loadAll(): Drill[] {
    const dir = join(__dirname, 'library');
    let files: string[];
    try {
      files = readdirSync(dir).filter((name) => name.endsWith('.md'));
    } catch {
      // An empty or absent library is a valid state — the console shows an
      // empty shelf and says so. Not a reason to refuse to boot.
      this.logger.warn(`No drill library found at ${dir}.`);
      return [];
    }

    const loaded: Drill[] = [];
    for (const file of files) {
      try {
        loaded.push(parseDrill(file, readFileSync(join(dir, file), 'utf8')));
      } catch (error) {
        this.logger.warn(
          `Skipping drill "${file}" — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return loaded;
  }
}

/**
 * Parses one drill file.
 *
 * Hand-rolled rather than a YAML dependency: the front matter is six
 * scalar fields with a fixed vocabulary, and a general YAML parser would
 * accept far more than this format allows — including nested structures
 * and type coercions that the enum checks below would then have to
 * re-reject. Strict is easier here than permissive.
 */
export function parseDrill(fileName: string, raw: string): Drill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw.trim());
  if (!match) throw new Error('no front matter block');

  const [, frontMatter, body] = match;
  const fields = new Map<string, string>();
  for (const line of frontMatter.split(/\r?\n/)) {
    const fieldMatch = /^([A-Za-z]+):\s*(.*)$/.exec(line.trim());
    if (!fieldMatch) continue;
    // Strip surrounding quotes and any trailing `# comment`.
    const value = fieldMatch[2]
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^"(.*)"$/, '$1');
    fields.set(fieldMatch[1], value);
  }

  const required = (key: string): string => {
    const value = fields.get(key);
    if (!value) throw new Error(`missing "${key}"`);
    return value;
  };

  const ageBand = required('ageBand');
  if (!(DRILL_AGE_BANDS as readonly string[]).includes(ageBand)) {
    throw new Error(`ageBand "${ageBand}" is not one of the allowed bands`);
  }
  const focus = required('focus');
  if (!(DRILL_FOCUSES as readonly string[]).includes(focus)) {
    throw new Error(`focus "${focus}" is not one of the allowed values`);
  }
  const durationMinutes = Number(required('durationMinutes'));
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error('durationMinutes must be a positive whole number');
  }

  // ADR-0029 Decision 5 says the body carries no links, email addresses or
  // phone numbers, and until now nothing enforced it. That matters more
  // than it looks: a contact detail here is an off-platform channel from
  // an unvetted adult to coaches who work with children — a different
  // feature with a different review — and once ADR-0028 Phase 1 reads this
  // same corpus, the string becomes model grounding too.
  //
  // Rejecting the whole file rather than stripping the match: a drill that
  // was written to point somewhere should not be silently published with
  // the pointer removed and its meaning changed.
  const contact = findContactDetail(body);
  if (contact) {
    throw new Error(
      `body contains what looks like ${contact} — Decision 5 allows no links, emails or phone numbers`,
    );
  }

  // Decision 5 makes contribution a licence event and puts the record in
  // the file rather than in someone's inbox. It was being parsed by
  // nothing, so a file could say permission was NOT given and publish a
  // real adult's name anyway. The permission and the name must agree.
  const author = required('author');
  const consented = (fields.get('authorConsentedNamed') ?? '').toLowerCase();
  if (author !== ANONYMOUS_AUTHOR && consented !== 'true') {
    throw new Error(
      `author "${author}" is named but authorConsentedNamed is not true — use "${ANONYMOUS_AUTHOR}" or record the permission`,
    );
  }

  // Parsed, not inferred. The previous marker was the word "UTKAST" inside
  // `sourceNote`, which no code read — so twelve unreviewed drills were
  // being served to coaches and used as the training-plan model's corpus
  // while looking, in the files, like they were being held back. A comment
  // that asserts something the code does not do is worse than no comment,
  // because it stops anyone checking.
  const coachReviewed =
    (fields.get('coachReviewed') ?? '').toLowerCase() === 'true';

  return {
    slug: fileName.replace(/\.md$/, ''),
    title: required('title'),
    ageBand: ageBand as DrillAgeBand,
    focus: focus as DrillFocus,
    durationMinutes,
    locale: required('locale'),
    author,
    sourceNote: fields.get('sourceNote') ?? null,
    coachReviewed,
    body: body.trim(),
  };
}

/**
 * Looks for an off-platform contact detail in drill prose.
 *
 * Deliberately blunt and slightly over-eager: a false positive costs one
 * rejected file with a named reason in the log, which the author fixes in
 * a minute. A false negative publishes a contact channel to coaches. The
 * asymmetry says which way to lean.
 */
export function findContactDetail(body: string): string | null {
  if (/https?:\/\//i.test(body)) return 'a URL';
  if (/\bwww\.[a-z0-9-]+\.[a-z]{2,}/i.test(body)) return 'a URL';
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(body)) {
    return 'an email address';
  }
  // Phone numbers, without eating ordinary drill prose.
  //
  // The first version was `(?:\+?\d[\s\-()]*){7,}`, which rejected far more
  // than phone numbers: a run of seven digits separated by spaces or
  // dashes is completely normal here, so "Tillagd 2026-08-11" and "30 30
  // 30 30 30 30 sekunder" were both refused. A rejected drill is a missing
  // row and a warning nobody reads, so over-eagerness fails INVISIBLY —
  // the opposite of the asymmetry that comment claimed.
  //
  // The second attempt stripped whitespace before matching, which
  // reintroduced the same fault by a different route: "30 30 30 30 30 30"
  // compacts to twelve consecutive digits. Space-separated digits are
  // interval and station lists, and must not be joined.
  //
  // So: an international number, a solid run of 8+ digits, or Swedish
  // grouping — each matched against the text as written.
  if (/\+\d[\d\s-]{7,}/.test(body)) return 'a phone number';
  if (/(?<!\d)\d{8,}(?!\d)/.test(body)) return 'a phone number';
  if (/\b0\d{1,3}[-\s]\d{2,3}[-\s]?\d{2}[-\s]?\d{2}\b/.test(body)) {
    return 'a phone number';
  }

  return null;
}
