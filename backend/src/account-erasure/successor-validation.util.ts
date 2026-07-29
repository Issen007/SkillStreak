import { EntityManager, In } from 'typeorm';
import { Player } from '../players/entities/player.entity';
import {
  AccountErasureRequest,
  AccountErasureStatus,
} from './entities/account-erasure-request.entity';

/**
 * docs/adr/0013-account-erasure.md Decision 4 — a named successor is
 * re-validated ("still on the team, not itself mid-erasure") at TWO
 * separate moments that both need the identical check: confirm time
 * (AccountErasureService.confirmErasure) and execution time
 * (AccountErasureSweepService, immediately before the deferred captain
 * flip). Extracted here rather than duplicated, same reasoning as
 * postgres-error.util.ts's extraction — one shared check, not two copies
 * that could quietly drift apart.
 *
 * Deliberately takes a plain `EntityManager` (not an injected repository)
 * so both call sites can run it inside whatever transaction/manager they
 * already hold — `manager.getRepository(X)` works against any entity
 * already known to the DataSource, no per-module `forFeature` registration
 * required for this kind of ad hoc read.
 */
export async function isSuccessorStillValid(
  manager: EntityManager,
  teamId: string,
  requesterId: string,
  successorPlayerId: string,
): Promise<boolean> {
  if (successorPlayerId === requesterId) return false;

  const target = await manager
    .getRepository(Player)
    .findOne({ where: { id: successorPlayerId } });
  if (!target || target.teamId !== teamId) return false;

  const activeErasureCount = await manager
    .getRepository(AccountErasureRequest)
    .count({
      where: {
        playerId: successorPlayerId,
        status: In([
          AccountErasureStatus.REQUESTED,
          AccountErasureStatus.GRACE_PERIOD,
        ]),
      },
    });
  return activeErasureCount === 0;
}
