import { In, Repository } from 'typeorm';
import { Player } from '../players/entities/player.entity';
import { Team } from '../teams/entities/team.entity';

/** Screen name + team name for the players on one page of an admin queue,
 * keyed by player id. */
export type ReporterIndex = Map<
  string,
  { screenName: string; teamName: string }
>;

/**
 * Resolves "who wrote this" for a page of an admin triage queue — and
 * nothing else about them.
 *
 * Extracted from AdminBugReportsService when ADR-0037 added a second
 * queue over the same shape of row. It is shared rather than copied
 * because what it leaves out is a security property, not a formatting
 * choice, and two copies is two places for the omission to stop holding:
 *
 * - **No `real_name`, no `parent_contact`.** docs/design/phase7-admin-
 *   console-flows.md §6.3 and §13: reporter identity in the console is
 *   screen name + team name, full stop. Both of those values live in the
 *   ADR-0002-addendum-isolated `player_private_info` table, encrypted at
 *   rest, and nothing here takes a repository for it — the same "don't
 *   give the module the ability in the first place" technique
 *   UsageMetricsModule uses.
 * - **Two narrow reads instead of a TypeORM relation.** `select` naming
 *   exactly three player columns and exactly two team columns is what
 *   stops this path widening into "the whole Player row" the next time
 *   someone adds a column.
 *
 * Both returned strings are **untrusted**: §6.2 verified directly that
 * `screenName`/`teamName` have no charset validation anywhere in
 * `backend/src`, so both are stored-XSS carriers into a page holding the
 * admin session. The console must render them with
 * `textContent`/`html-escape.util.ts`, never `innerHTML` — including a
 * list row's `title=` attribute.
 */
export async function resolveReporterIndex(options: {
  playerRepository: Repository<Player>;
  teamRepository: Repository<Team>;
  playerIds: string[];
}): Promise<ReporterIndex> {
  const { playerRepository, teamRepository } = options;
  const index: ReporterIndex = new Map();
  const playerIds = [...new Set(options.playerIds)];
  if (playerIds.length === 0) return index;

  const players = await playerRepository.find({
    where: { id: In(playerIds) },
    select: { id: true, screenName: true, teamId: true },
  });
  if (players.length === 0) return index;

  const teamIds = [...new Set(players.map((player) => player.teamId))];
  const teams = await teamRepository.find({
    where: { id: In(teamIds) },
    select: { id: true, name: true },
  });
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]));

  for (const player of players) {
    index.set(player.id, {
      screenName: player.screenName,
      // Team name is included because reproduction (and, for a
      // suggestion, knowing which team's shape prompted it) genuinely
      // depends on it — §6.3. `''` is the degenerate "team row vanished"
      // case, not a normal one.
      teamName: teamNameById.get(player.teamId) ?? '',
    });
  }
  return index;
}
