import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../staff-auth/guards/admin-auth.guard';
import { UpsertPrCampaignDto } from './dto/upsert-pr-campaign.dto';
import { PrCampaignRow, PrCampaignsService } from './pr-campaigns.service';

/**
 * The PR campaign board. Admin-only — a trainer has no business reading
 * marketing plans, and this table holds no child data to gate beyond that.
 */
@Controller('api/v1/admin/pr-campaigns')
@UseGuards(AdminAuthGuard)
export class AdminPrCampaignsController {
  constructor(private readonly prCampaignsService: PrCampaignsService) {}

  @Get()
  list(): Promise<PrCampaignRow[]> {
    return this.prCampaignsService.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: UpsertPrCampaignDto): Promise<{ id: string }> {
    return this.prCampaignsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpsertPrCampaignDto,
  ): Promise<{ id: string }> {
    return this.prCampaignsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.prCampaignsService.remove(id);
  }
}
