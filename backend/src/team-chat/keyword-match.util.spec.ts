import { buildKeywordPattern, containsBannedWord } from './keyword-match.util';

// docs/adr/0007-team-chat.md Decision 2's own expectations, tested
// directly against the pure matching logic (no wordlist file, no DI) —
// case-insensitive, word-boundary-aware, resistant to repeated-character
// and inserted-punctuation/space evasion.
describe('buildKeywordPattern / containsBannedWord', () => {
  const wordlist = ['fitta', 'hora', 'idiot'];

  it('matches the exact word', () => {
    expect(containsBannedWord('fitta', wordlist)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(containsBannedWord('FITTA', wordlist)).toBe(true);
    expect(containsBannedWord('FiTtA', wordlist)).toBe(true);
  });

  it('matches the word embedded in an ordinary sentence, at a real word boundary', () => {
    expect(containsBannedWord('din fitta idiot', wordlist)).toBe(true);
  });

  it('does NOT flag an innocent word that merely contains a banned entry as a substring with no separator (word-boundary-awareness)', () => {
    // "ort" isn't in this wordlist, but this is the shape of the concern:
    // a banned entry embedded with no boundary inside a longer, unrelated
    // word must not match. Using "idiot" against "idiotisk" as the concrete
    // check: "idiotisk" contains "idiot" directly, immediately followed by
    // more letters — the lookahead assertion must reject this.
    expect(containsBannedWord('idiotisk', wordlist)).toBe(false);
  });

  it('does NOT flag a banned word preceded by more letters with no separator', () => {
    expect(containsBannedWord('minidiot', wordlist)).toBe(false);
  });

  it('absorbs repeated-character evasion ("fittaaaa")', () => {
    expect(containsBannedWord('fittaaaa', wordlist)).toBe(true);
  });

  it('absorbs repeated-character evasion on an internal doubled letter too ("fiitttaaa")', () => {
    expect(containsBannedWord('fiitttaaa', wordlist)).toBe(true);
  });

  it('absorbs inserted punctuation between every letter ("f.i.t.t.a")', () => {
    expect(containsBannedWord('f.i.t.t.a', wordlist)).toBe(true);
  });

  it('absorbs inserted spaces between every letter ("f i t t a")', () => {
    expect(containsBannedWord('f i t t a', wordlist)).toBe(true);
  });

  it('absorbs a mix of inserted punctuation and repeated characters ("f--iii..t_t@aaa")', () => {
    expect(containsBannedWord('f--iii..t_t@aaa', wordlist)).toBe(true);
  });

  it('does not match ordinary, unrelated content', () => {
    expect(containsBannedWord('Bra jobbat idag allihopa! 💪', wordlist)).toBe(
      false,
    );
  });

  it('handles Swedish å/ä/ö as ordinary letters, not accents to strip', () => {
    const svWordlist = ['skitstövel'];
    expect(containsBannedWord('din skitstövel', svWordlist)).toBe(true);
    // "skit" alone (a substring without the "stövel" tail) must not match
    // the longer listed phrase.
    expect(containsBannedWord('skit', svWordlist)).toBe(false);
  });

  it('buildKeywordPattern is case-insensitive and unicode-aware (u flag) on its own', () => {
    const pattern = buildKeywordPattern('öl');
    expect(pattern.test('ÖL')).toBe(true);
    expect(pattern.flags).toContain('i');
    expect(pattern.flags).toContain('u');
  });
});
