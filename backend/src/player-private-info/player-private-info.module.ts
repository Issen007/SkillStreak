import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParentalConsentRecord } from './entities/parental-consent-record.entity';
import { PlayerPrivateInfo } from './entities/player-private-info.entity';
import { PlayerPrivateInfoService } from './player-private-info.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlayerPrivateInfo, ParentalConsentRecord]),
  ],
  providers: [PlayerPrivateInfoService],
  exports: [PlayerPrivateInfoService],
})
export class PlayerPrivateInfoModule {}
