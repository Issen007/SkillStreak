import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateImprovementSuggestionDto } from './dto/create-improvement-suggestion.dto';
import {
  CreateImprovementSuggestionResult,
  ImprovementSuggestionsService,
} from './improvement-suggestions.service';

/**
 * docs/adr/0037-in-app-improvement-suggestions.md — an ordinary
 * authenticated player action, reusing `CurrentPlayerId` exactly like
 * every other player-scoped write in this app. No new auth mechanism.
 *
 * **`JwtAuthGuard` only, and deliberately no consent gate** — see
 * ImprovementSuggestionsService's class docstring for the argument and
 * who made the call.
 *
 * The admin side lives in `admin/` behind `AdminAuthGuard` and shares no
 * route prefix, no guard, and no DTO with this controller.
 */
@Controller('api/v1/improvement-suggestions')
export class ImprovementSuggestionsController {
  constructor(
    private readonly improvementSuggestionsService: ImprovementSuggestionsService,
  ) {}

  // 201, not 200 — this creates a new row, same resource-creation posture
  // as POST /bug-reports.
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  submit(
    @CurrentPlayerId() playerId: string,
    @Body() dto: CreateImprovementSuggestionDto,
  ): Promise<CreateImprovementSuggestionResult> {
    // `playerId` comes from the session, never from the body — the DTO has
    // no field for it at all.
    return this.improvementSuggestionsService.submit(playerId, dto);
  }
}
