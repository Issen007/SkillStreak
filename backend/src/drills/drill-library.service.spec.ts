import { parseDrill } from './drill-library.service';

const VALID = `---
title: "Kortpassningar under press"
ageBand: "9-11"
focus: "passning"
durationMinutes: 15
locale: "sv"
author: "Anna Lindqvist"
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
