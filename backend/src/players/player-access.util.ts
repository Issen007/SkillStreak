import {
  ConsentRequiredException,
  TeamJoinApprovalRequiredException,
} from '../common/errors/exceptions';
import { ParentalConsentStatus } from './player-consent-status.enum';
import { TeamJoinStatus } from './team-join-status.enum';

/**
 * The two gates that decide whether a signed-in player may see or touch
 * anything belonging to their team.
 *
 * **Why these live here rather than beside their callers.** Until
 * 2026-09-24 this pair was copied privately into three services
 * (video-clips, team-chat, training-logs) and exported from none of
 * them. The public feed — added later, and the only surface where a
 * child's clip leaves the team bubble — was written without them, and
 * could not have reused them without a copy-paste. It checked the
 * viewer's team against the rollout allow-list and nothing else, so an
 * account whose parent had approved nothing and whose captain had
 * approved nothing could read other children's video.
 *
 * That is the 2026-08-17 chat-embed incident's exact shape, repeated on
 * a wider surface, and three private copies is how it happened. One
 * exported definition is the fix for the class, not just the instance.
 *
 * Both gates are independent and both must pass. Parental consent is the
 * legal gate (CLAUDE.md: "parental approval flow — required before any
 * account can upload video/media"); team-join approval is the captain's,
 * and is what makes "their own **verified** team" mean something.
 */
export function assertConsentApproved(status: ParentalConsentStatus): void {
  if (status !== ParentalConsentStatus.APPROVED) {
    throw new ConsentRequiredException();
  }
}

export function assertTeamJoinApproved(status: TeamJoinStatus): void {
  if (status !== TeamJoinStatus.APPROVED) {
    throw new TeamJoinApprovalRequiredException();
  }
}

/**
 * True when a viewer may be shown team-scoped content — the same two
 * gates as a boolean, for read paths that degrade to an empty list
 * rather than throwing. `team-chat`'s clip-embed gate already worked
 * this way; this is that idea, named once.
 */
export function maySeeTeamContent(player: {
  parentalConsentStatus: ParentalConsentStatus;
  teamJoinStatus: TeamJoinStatus;
}): boolean {
  return (
    player.parentalConsentStatus === ParentalConsentStatus.APPROVED &&
    player.teamJoinStatus === TeamJoinStatus.APPROVED
  );
}
