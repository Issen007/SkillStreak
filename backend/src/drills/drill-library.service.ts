import { Injectable, Logger } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    this.drills = this.loadAll();
    this.logger.log(`Drill library loaded: ${this.drills.length} drill(s).`);
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

  return {
    slug: fileName.replace(/\.md$/, ''),
    title: required('title'),
    ageBand: ageBand as DrillAgeBand,
    focus: focus as DrillFocus,
    durationMinutes,
    locale: required('locale'),
    author: required('author'),
    sourceNote: fields.get('sourceNote') ?? null,
    body: body.trim(),
  };
}
