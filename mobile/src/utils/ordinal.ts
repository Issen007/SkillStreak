/** Swedish ordinal-suffix rule (Fas 2.7, Screen LB1/LB2): 1:a, 2:a, 3:e,
 * 4:e, ..., 11:e, 12:e, 13:e, 21:a, 22:a, 23:e, ... — a genuine grammar
 * rule, not a fixed suffix, per docs/design/phase2.6-2.7-flows.md's
 * explicit i18n flag. Kept as its own small, isolated, testable function
 * (input: an integer rank, output: the correctly-suffixed string) rather
 * than an inline template string, both so the rule is actually correct
 * across every realistic team count and so a future locale can supply its
 * own ordinal-formatting function instead of this one being baked into a
 * layout string, per CLAUDE.md's i18n instruction. */
export function swedishOrdinal(rank: number): string {
  const lastTwoDigits = rank % 100;
  const lastDigit = rank % 10;

  // 11-13 are always "e", overriding the last-digit rule below (matches
  // real Swedish usage: "11:e", not "11:a").
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return `${rank}:e`;
  }

  if (lastDigit === 1 || lastDigit === 2) {
    return `${rank}:a`;
  }

  return `${rank}:e`;
}
