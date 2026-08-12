import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentStaffAccountId } from '../pt/current-staff-account-id.decorator';
import { CurrentStaffRole } from '../pt/current-staff-role.decorator';
import { StaffAccountRole } from '../staff-auth/entities/staff-account.entity';
import { PtAuthGuard } from '../staff-auth/guards/pt-auth.guard';
import { DrillAccessService } from './drill-access.service';
import { DrillGroupsService, DrillGroupView } from './drill-groups.service';
import { AddDrillToGroupsDto } from './dto/add-drill-to-groups.dto';
import { UpsertDrillGroupDto } from './dto/upsert-drill-group.dto';

/**
 * A trainer's own groups over the drill library.
 *
 * Same gate as the library itself, and every route is scoped to the
 * caller's own `staffAccountId` in the service — there is no route here
 * that names another account, and no way to ask what groups anyone else
 * keeps.
 */
@Controller('api/v1/drill-groups')
@UseGuards(PtAuthGuard)
export class DrillGroupsController {
  constructor(
    private readonly drillGroupsService: DrillGroupsService,
    private readonly drillAccessService: DrillAccessService,
  ) {}

  @Get()
  async list(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
  ): Promise<DrillGroupView[]> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    return this.drillGroupsService.list(staffAccountId);
  }

  @Post()
  async create(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Body() dto: UpsertDrillGroupDto,
  ): Promise<DrillGroupView> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    return this.drillGroupsService.create(staffAccountId, dto);
  }

  /**
   * Set which groups a drill belongs to. Returns the full group list so
   * the console re-renders from server state rather than guessing what
   * the write did.
   */
  @Put('assignments/drill')
  async setGroupsForDrill(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Body() dto: AddDrillToGroupsDto,
  ): Promise<DrillGroupView[]> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    return this.drillGroupsService.setGroupsForDrill(
      staffAccountId,
      dto.slug,
      dto.groupIds,
    );
  }

  @Put(':id')
  async update(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Param('id') id: string,
    @Body() dto: UpsertDrillGroupDto,
  ): Promise<DrillGroupView> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    return this.drillGroupsService.update(staffAccountId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentStaffAccountId() staffAccountId: string,
    @CurrentStaffRole() role: StaffAccountRole | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.drillAccessService.assertMayRead(staffAccountId, role);
    await this.drillGroupsService.remove(staffAccountId, id);
  }
}
