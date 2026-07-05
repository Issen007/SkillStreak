import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
  // docs/api/phase1-contract.md. That also makes this the one endpoint that
  // can be spammed to mint fake accounts on a real team, so it gets a
  // tighter-than-default per-IP rate limit: 10/min is generous enough for a
  // coach registering ~15 kids in one practice session (each signup takes
  // real data-entry time), but closes off scripted abuse.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreatePlayerDto): Promise<CreatePlayerResponse> {
    return this.onboardingService.createPlayer(dto);
  }
}
