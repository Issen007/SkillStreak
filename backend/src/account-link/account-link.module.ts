import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Player } from '../players/entities/player.entity';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { AccountLinkService } from './account-link.service';
import {
  AccountLinkController,
  StaffAccountLinkController,
} from './account-link.controller';
import { AccountLink } from './entities/account-link.entity';
import { AccountLinkChallenge } from './entities/account-link-challenge.entity';

/**
 * ADR-0031. The one module in this app that touches both authentication
 * systems, which is why it is its own module rather than an addition to
 * either: putting it inside `staff-auth` would invite a guard there to
 * read the link, and putting it inside `players` would do the same from
 * the other side. Decision 3 forbids both.
 *
 * `Player` is registered narrowly and read only for `birth_year`, to
 * enforce the 13+ rule server-side.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AccountLink, AccountLinkChallenge, Player]),
    AuthModule,
    StaffAuthModule,
  ],
  controllers: [AccountLinkController, StaffAccountLinkController],
  providers: [AccountLinkService],
  exports: [AccountLinkService],
})
export class AccountLinkModule {}
