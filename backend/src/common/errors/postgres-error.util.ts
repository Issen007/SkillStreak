const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Checks whether a caught error is a Postgres unique-violation (23505) for a
 * *specific* named constraint/index, not just "some 23505 happened" — so a
 * future unique constraint added elsewhere in the same transaction can't be
 * silently mislabeled as this one. Extracted from what used to be two
 * separate, identically-shaped copies (`onboarding.service.ts`'s
 * `isScreenNameUniqueViolation`, `weekly-goal.service.ts`'s
 * `isActiveGoalUniqueViolation`) during the Phase 2.5 documentation/reuse
 * pass — same "catch, check code + constraint name, throw a domain
 * exception" shape belongs in one place, per CLAUDE.md's boundary-validation
 * discipline. Any future save-then-catch-23505 write path (e.g. a Phase 3
 * upload with its own uniqueness rule) should reuse this rather than
 * re-deriving it.
 */
export function isPostgresUniqueViolation(
  error: unknown,
  constraintName: string,
): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return (
    pgError.code === POSTGRES_UNIQUE_VIOLATION &&
    pgError.constraint === constraintName
  );
}
