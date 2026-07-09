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
// letters (repeats collapsed out of the *entry* itself — spaces stripped,
// since we want the same "any separator allowed" treatment whether or not
// the source entry itself contains a literal space, e.g. a multi-word
// phrase) to appear, each repeated one-or-more times (absorbs repeated-char
// evasion) and separated by zero-or-more non-letter characters (absorbs
// inserted punctuation/space evasion). A negative lookaround on both ends
// requires that the match not be directly adjacent to another letter, so a
// banned word embedded with no separator inside an unrelated longer word
// (e.g. "ort" inside "koordinator") is never flagged — that's the
// word-boundary-awareness half of the requirement.
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

/**
 * Builds the case-insensitive, evasion-resistant regex for a single
 * wordlist entry. Exported so tests can inspect matching behavior
 * per-word, not just through the full wordlist.
 */
export function buildKeywordPattern(word: string): RegExp {
  const letters = Array.from(word.toLowerCase().replace(/\s+/g, ''));
  const body = letters
    .map((ch) => `${escapeRegExpChar(ch)}+`)
    .join(NON_LETTER_RUN);
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
