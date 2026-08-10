// Pure, DB-free — mirrors common/time/stockholm-date.util.ts's shape (see
// CLAUDE.md's "keep individual-streak/pure logic separate" spirit and
// common/streak/'s existing precedent). Computes which season a given
// calendar date ('YYYY-MM-DD', already resolved to Europe/Stockholm by the
// caller — see stockholmDateString) falls into.
//
// **A season is a full calendar year, Jan 1 - Dec 31** (project owner,
// 2026-08-10: "the points to earn will stay for the entire year, 1 of Jan
// will everything be reset again to 0p").
//
// This replaces the original half-year grid ("Vår"/"Höst", ADR-0009
// Decision 6). The reasoning for a *fixed* grid over a floating "today + N
// days" window is unchanged and still load-bearing: every team's season
// must align to the same calendar boundaries regardless of when the team
// was created, or ADR-0008's cross-team leaderboard would be comparing
// pots covering different spans. Only the grid's size changed.
//
// Existing "Vår"/"Höst" pots are deliberately left alone — see the
// migration's own comment. Nothing here rewrites history.
export interface Season {
  label: string;
  startDate: string;
  endDate: string;
}

export function computeSeason(dateString: string): Season {
  const year = Number(dateString.slice(0, 4));
  return {
    label: `${year}`,
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}
