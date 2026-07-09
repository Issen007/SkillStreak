// Pure, DB-free matching logic behind KeywordChatModerationCheck — kept
// separate from the Nest-wired class (same "pure function the class calls"
// split this codebase already uses for common/streak, common/time) so the
// matching behavior itself is unit-testable without constructing a
// provider/reading the wordlist file.
//
// docs/adr/0007-team-chat.md Decision 2's expectations: case-insensitive,
// word-boundary-aware (an innocent word that merely *contains* a banned
// substring must not be flagged), and resistant to the two most-trivial
// evasions kids will try on day one — repeating a letter ("fittaaaa") and
// inserting punctuation/spaces between letters ("f.i.t.t.a", "f i t t a").
//
// Design: for each banned entry, build a regex that requires each of its
// letters to appear, each repeated one-or-more times (absorbs repeated-char
// evasion) and separated by zero-or-more non-letter characters (absorbs
// inserted punctuation/space evasion *within* a single word). A negative
// lookaround on both ends requires that the match not be directly adjacent
// to another letter, so a banned word embedded with no separator inside an
// unrelated longer word (e.g. "ort" inside "koordinator") is never flagged
// — that's the word-boundary-awareness half of the requirement.
//
// Multi-word entries (e.g. "fan ta dig") are matched word-by-word, joined
// by a *mandatory real whitespace* separator (`\s+`), not the same flexible
// NON_LETTER_RUN used within a word. This was a confirmed code-critic
// finding, not the original design: flattening a whole phrase into one
// letter-stream (as this function used to do, stripping the entry's own
// spaces first) made "fan ta dig" indistinguishable from the extremely
// common, benign idiom "Fan, ta dig samman!" ("come on, pull yourself
// together!") — the two differ only by a comma between the first two
// words, and a matcher tolerant enough to catch "fan,ta,dig" as evasion of
// the phrase is *necessarily* also tolerant enough to match the innocent
// idiom, since they're the same edit distance from the canonical phrase.
// Requiring genuine whitespace between a multi-word entry's own words fixes
// the false positive (a comma where a space belongs breaks the match) while
// keeping full repeated-letter/inserted-punctuation absorption *inside*
// each word unchanged. Accepted trade-off, not a further gap introduced
// silently: a multi-word entry can now be evaded by using non-whitespace
// punctuation in place of the spaces between its words (e.g. "fan,ta,dig")
// — a more deliberate evasion than the repeated-letter/inserted-punctuation
// tricks this filter is designed to catch on a kid's first attempt, and
// squarely inside the ADR's already-stated "catches words, not patterns"
// limitation the deferred LLM-moderation item exists to close later.
//
// Every letter class here uses Unicode's `\p{L}` (via the `u` flag) rather
// than a hardcoded a-z range, so Swedish's å/ä/ö (real letters, not
// accented variants to strip) are treated as ordinary word characters
// without special-casing them.
const LETTER = '\\p{L}';
const NON_LETTER_RUN = `[^${LETTER}]*`;

function escapeRegExpChar(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSubWordPattern(subWord: string): string {
  const letters = Array.from(subWord);
  return letters.map((ch) => `${escapeRegExpChar(ch)}+`).join(NON_LETTER_RUN);
}

/**
 * Builds the case-insensitive, evasion-resistant regex for a single
 * wordlist entry. Exported so tests can inspect matching behavior
 * per-word, not just through the full wordlist.
 */
export function buildKeywordPattern(word: string): RegExp {
  const subWords = word
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const body = subWords.map(buildSubWordPattern).join('\\s+');
  return new RegExp(`(?<!${LETTER})${body}(?!${LETTER})`, 'iu');
}

/** True if `content` matches any entry in `wordlist` (case-insensitive,
 * word-boundary-aware, evasion-resistant — see this file's header). */
export function containsBannedWord(
  content: string,
  wordlist: readonly string[],
): boolean {
  return wordlist.some((word) => buildKeywordPattern(word).test(content));
}
