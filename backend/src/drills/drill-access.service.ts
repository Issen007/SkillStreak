import { Injectable } from '@nestjs/common';
import { DrillLibraryForbiddenException } from '../common/errors/exceptions';
import { PtTeamLinksService } from '../pt/pt-team-links.service';
import { StaffAccountRole } from '../staff-auth/entities/staff-account.entity';

/**
 * "May this staff account use the drill library?" — ADR-0029 Decision 4,
 * in one place.
 *
 * Extracted when groups arrived and needed the same answer. PtTeamLinks-
 * Service.hasAnyActiveLink already carries a note that this project keeps
 * growing independent answers to "does this PT hold an active link"; a
 * second copy-paste of the admin-or-link branch is how the next one
 * starts, and how one of them later drifts.
 */
@Injectable()
export class DrillAccessService {
  constructor(private readonly ptTeamLinksService: PtTeamLinksService) {}

  /**
   * Re-checked on every request rather than once per session, so a revoked
   * team link closes this surface at the same moment it closes every other
   * one. The library is not sensitive, but "access that outlives its
   * reason" is the shape of bug this project keeps finding, and it costs
   * one indexed count to not have it here.
   */
  async assertMayRead(
    staffAccountId: string,
    role: StaffAccountRole | undefined,
  ): Promise<void> {
    // The role claim decides what to SHOW, never what to allow: PtAuthGuard
    // has already established that this caller is staff, is not revoked,
    // and holds one of the two roles. This branch only chooses which of two
    // permitted populations the caller is in.
    //
    // The `or is admin` branch was missed on the library's first build,
    // which made it a broken tab for the project owner, whose normal state
    // is an admin holding no team link. It failed closed, so it was never a
    // security problem, only a wrong one.
    if (role === StaffAccountRole.ADMIN) return;
    if (await this.ptTeamLinksService.hasAnyActiveLink(staffAccountId)) return;
    throw new DrillLibraryForbiddenException();
  }
}
