import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentStaffAccountId } from '../pt/current-staff-account-id.decorator';
import { CurrentStaffRole } from '../pt/current-staff-role.decorator';
import { StaffAccountRole } from '../staff-auth/entities/staff-account.entity';
import { PtTeamLinksService } from '../pt/pt-team-links.service';
import { PtAuthGuard } from '../staff-auth/guards/pt-auth.guard';
import { DrillLibraryForbiddenException } from '../common/errors/exceptions';
import {
  Drill,
  DrillLibraryService,
  DrillSummary,
} from './drill-library.service';

/**
 * The coach drill library's read surface (ADR-0029 Decisions 2 and 4).
 *
 * Behind `PtAuthGuard` — which admits `admin` alongside `pt` — **plus** at
 * least one active `PtTeamLink`. Not "any signed-in staff account": an SSO
 * sign-in costs nothing and proves nothing, and opening this to any Google
 * account would hand an anonymous population a readable list of the real
 * names of adults who coach children's teams. Small, but not worth
 * creating for free.
 *
 * Nothing here is a query about a person. The responses carry Markdown and
 * its front matter — no teamId, no playerId, no roster, no counts, and no
 * way to ask which teams an author works with. An author name is a string
 * in a file.
 */
@Controller('api/v1/drills')
@UseGuards(PtAuthGuard)
export class DrillsController {
  constructor(
    private readonly drillLibraryService: DrillLibraryService,
    private readonly ptTeamLinksService: PtTeamLinksService,
  ) {}

  @Get()
  async list(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Query('ageBand') ageBand?: string,
    @Query('focus') focus?: string,
    @Query('locale') locale?: string,
  ): Promise<DrillSummary[]> {
    await this.assertMayRead(staffAccountId, role);
    return this.drillLibraryService.list({ ageBand, focus, locale });
  }

  @Get(':slug')
  async findOne(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Param('slug') slug: string,
  ): Promise<Drill> {
    await this.assertMayRead(staffAccountId, role);
    const drill = this.drillLibraryService.findBySlug(slug);
    if (!drill) throw new NotFoundException('No such drill.');
    return drill;
  }

  /**
   * Re-checked on every request rather than once per session, so a
   * revoked team link closes this surface at the same moment it closes
   * every other one. The library is not sensitive, but "access that
   * outlives its reason" is the shape of bug this project keeps finding,
   * and it costs one indexed count to not have it here.
   */
  private async assertMayRead(
    staffAccountId: string,
    role: StaffAccountRole | undefined,
  ): Promise<void> {
    // ADR-0029 Decision 4's `or is admin` branch, missed on the first
    // build — which made this a broken tab for the project owner, whose
    // normal state is an admin holding no team link. It failed closed, so
    // it was never a security problem, only a wrong one.
    //
    // The role claim decides what to SHOW, never what to allow: PtAuthGuard
    // has already established that this caller is staff, is not revoked,
    // and holds one of the two roles. This branch only chooses which of two
    // permitted populations the caller is in.
    if (role === StaffAccountRole.ADMIN) return;
    if (await this.ptTeamLinksService.hasAnyActiveLink(staffAccountId)) return;
    throw new DrillLibraryForbiddenException();
  }
}
