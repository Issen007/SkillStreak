import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDrill } from './drill-library.service';

const VALID = `---
title: "Kortpassningar under press"
ageBand: "9-11"
focus: "passning"
durationMinutes: 15
locale: "sv"
author: "Anna Lindqvist"
authorConsentedNamed: true
sourceNote: "Delad av författaren"
---

Body prose.
`;

describe('parseDrill', () => {
  it('reads the front matter and keeps the body', () => {
    const drill = parseDrill('kortpassningar.md', VALID);

    expect(drill).toMatchObject({
      slug: 'kortpassningar',
      title: 'Kortpassningar under press',
      ageBand: '9-11',
      focus: 'passning',
      durationMinutes: 15,
      author: 'Anna Lindqvist',
    });
    expect(drill.body).toBe('Body prose.');
  });

  it('rejects an age band outside the fixed vocabulary', () => {
    // The enums are the point: a general YAML parser would accept far more
    // than this format allows, which is why the parser is hand-rolled.
    expect(() => parseDrill('x.md', VALID.replace('"9-11"', '"5-7"'))).toThrow(
      /ageBand/,
    );
  });

  it('rejects a focus outside the fixed vocabulary', () => {
    expect(() =>
      parseDrill('x.md', VALID.replace('"passning"', '"kondition"')),
    ).toThrow(/focus/);
  });

  it('rejects a non-numeric or zero duration', () => {
    expect(() => parseDrill('x.md', VALID.replace('15', 'femton'))).toThrow(
      /durationMinutes/,
    );
    expect(() => parseDrill('x.md', VALID.replace('15', '0'))).toThrow(
      /durationMinutes/,
    );
  });

  it('rejects a file with no front matter at all', () => {
    expect(() => parseDrill('x.md', 'just some prose')).toThrow(/front matter/);
  });

  it('reports which required field is missing', () => {
    expect(() =>
      parseDrill(
        'x.md',
        VALID.replace('title: "Kortpassningar under press"\n', ''),
      ),
    ).toThrow(/title/);
  });

  it('strips trailing comments from a field', () => {
    const drill = parseDrill(
      'x.md',
      VALID.replace('"9-11"', '"9-11"   # fixed enum'),
    );

    expect(drill.ageBand).toBe('9-11');
  });

  it('treats a missing sourceNote as absent rather than failing', () => {
    const drill = parseDrill(
      'x.md',
      VALID.replace('sourceNote: "Delad av författaren"\n', ''),
    );

    expect(drill.sourceNote).toBeNull();
  });
});

/**
 * ADR-0029 Decision 5's content rules, which were specified and then
 * enforced by nothing. Both were security-review findings.
 */
describe('parseDrill: Decision 5 content rules', () => {
  const withBody = (body: string) =>
    VALID.replace('Body prose.', body).replace(
      'author: "Anna Lindqvist"',
      'author: "Anonym tränare"',
    );

  it.each([
    ['a URL', 'Se mer på https://example.se/övning'],
    ['a bare www URL', 'Se www.example.se för mer'],
    ['an email address', 'Hör av dig till anna@example.se'],
    ['a phone number', 'Ring mig på 070-123 45 67'],
  ])('rejects a body containing %s', (_label, body) => {
    // A contact detail here is an off-platform channel from an unvetted
    // adult to coaches who work with children — and, once the AI cluster
    // reads this corpus, model grounding as well.
    expect(() => parseDrill('x.md', withBody(body))).toThrow(/Decision 5/);
  });

  it('does not mistake ordinary numbers in a drill for a phone number', () => {
    // Rep counts, durations and years are the whole vocabulary of a drill.
    expect(() =>
      parseDrill('x.md', withBody('4 varv om 30 sekunder, 2026 års upplägg')),
    ).not.toThrow();
  });

  it('refuses a named author whose permission was not recorded', () => {
    // The file itself is the licence record. A name published against a
    // "false" is the exact contradiction the field exists to prevent.
    expect(() =>
      parseDrill(
        'x.md',
        VALID.replace(
          'authorConsentedNamed: true',
          'authorConsentedNamed: false',
        ),
      ),
    ).toThrow(/authorConsentedNamed/);
  });

  it('accepts a named author whose permission was recorded', () => {
    expect(() => parseDrill('x.md', VALID)).not.toThrow();
  });

  it('needs no permission for the anonymous author, who identifies nobody', () => {
    expect(() =>
      parseDrill(
        'x.md',
        VALID.replace('author: "Anna Lindqvist"', 'author: "Anonym tränare"'),
      ),
    ).not.toThrow();
  });
});

/**
 * The first phone heuristic rejected "Tillagd 2026-08-11" and "30 30 30 30
 * 30 30 sekunder" — both ordinary drill prose. A rejected drill is a
 * missing row and a warning nobody reads, so over-eagerness here fails
 * invisibly, which is the wrong direction to err in.
 */
describe('parseDrill: the phone heuristic vs ordinary drill prose', () => {
  const withBody = (body: string) =>
    VALID.replace('Body prose.', body).replace(
      'author: "Anna Lindqvist"',
      'author: "Anonym tränare"',
    );

  it.each([
    'Tillagd 2026-08-11 av tränaren.',
    'Kör intervaller: 30 30 30 30 30 30 sekunder.',
    'Stationer 1 2 3 4 5 6 7 8 i tur och ordning.',
    '3 x 10 reps, 4 set, 2 min vila.',
    'Passa 20 gånger på 45 sekunder, 3 varv.',
  ])('accepts %p', (body) => {
    expect(() => parseDrill('x.md', withBody(body))).not.toThrow();
  });

  it.each([
    'Ring mig på 070-123 45 67',
    'Nås på +46701234567',
    'Mobil: 0701234567',
  ])('still rejects %p', (body) => {
    expect(() => parseDrill('x.md', withBody(body))).toThrow(/phone number/);
  });
});

/**
 * The shipped library itself must parse. Every other test here uses a
 * fixture, so a rule that rejects the real files would pass CI and empty
 * the shelf in production — visible only via /health's drill count, after
 * deploy.
 */
describe('the drill library files that actually ship', () => {
  it('every file in src/drills/library parses', () => {
    const dir = join(__dirname, 'library');
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(() =>
        parseDrill(file, readFileSync(join(dir, file), 'utf8')),
      ).not.toThrow();
    }
  });
});
