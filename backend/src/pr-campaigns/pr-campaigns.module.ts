import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { AdminPrCampaignsController } from './admin-pr-campaigns.controller';
import { PrCampaign } from './entities/pr-campaign.entity';
import { PrCampaignsService } from './pr-campaigns.service';

/**
 * PR campaigns and their attribution — the execution record for the copy
 * in docs/CAMPAIGNS.md. Adult marketing data only; see the entity for the
 * separation this keeps from anything about a player or a team.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PrCampaign]), StaffAuthModule],
  controllers: [AdminPrCampaignsController],
  providers: [PrCampaignsService],
})
export class PrCampaignsModule {}
