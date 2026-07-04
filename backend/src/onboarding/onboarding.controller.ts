import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CreatePlayerDto } from './dto/create-player.dto';
import { OnboardingService } from './onboarding.service';

interface CreatePlayerResponse {
  playerId: string;
  teamId: string;
  screenName: string;
  avatarId: string;
  consentStatus: string;
  sessionToken: string;
}

@Controller('api/v1/players')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  // No auth — a device doesn't have a token yet at this point, per
  // docs/api/phase1-contract.md.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreatePlayerDto): Promise<CreatePlayerResponse> {
    return this.onboardingService.createPlayer(dto);
  }
}
