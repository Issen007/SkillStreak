import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlayersModule } from '../players/players.module';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';

@Module({
  imports: [AuthModule, PlayersModule],
  controllers: [SessionController],
  providers: [SessionService],
})
export class SessionModule {}
