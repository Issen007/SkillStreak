import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConsentService } from './consent.service';

interface ConsentReminderResponse {
  message: string;
  sentAt: string;
}

// Distinct from ConsentController: that controller is the unauthenticated,
// parent-facing HTML link (docs/api/phase1-contract.md step 6). This one
// is the authenticated, captain-facing JSON action from
// docs/api/phase2-contract.md endpoint 3 — same ConsentService, different
// caller/shape, so it gets its own controller rather than mixing auth
// styles on one class.
@Controller('api/v1/players')
export class ConsentReminderController {
  constructor(private readonly consentService: ConsentService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':playerId/consent-reminder')
  @HttpCode(HttpStatus.OK)
  async sendReminder(
    @CurrentPlayerId() requesterId: string,
    @Param('playerId') playerId: string,
  ): Promise<ConsentReminderResponse> {
    const { sentAt } = await this.consentService.sendReminder(
      requesterId,
      playerId,
    );
    return { message: 'Reminder sent.', sentAt: sentAt.toISOString() };
  }
}
