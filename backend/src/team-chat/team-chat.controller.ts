import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BlockChatPlayerDto } from './dto/block-chat-player.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ListChatMessagesQueryDto } from './dto/list-chat-messages-query.dto';
import { ReportChatMessageDto } from './dto/report-chat-message.dto';
import {
  ChatBlockResponse,
  ChatMessageListItem,
  ChatMessageResponse,
  ChatReportResponse,
  ChatUnblockResponse,
  TeamChatService,
} from './team-chat.service';

// docs/api/phase2.6b-contract.md's five endpoints, verbatim. No captain
// gate anywhere here — chat is one shared channel every player (including
// the captain) participates in equally (ADR-0007 Decision 5). Every method
// delegates its own team-membership/consent check to TeamChatService (which
// in turn calls PlayersService's shared methods), same pattern as every
// other Phase 2 team-scoped controller in this app.
@Controller('api/v1/teams/:teamId/chat')
export class TeamChatController {
  constructor(private readonly teamChatService: TeamChatService) {}

  @UseGuards(JwtAuthGuard)
  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  async postMessage(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
    @Body() dto: CreateChatMessageDto,
  ): Promise<ChatMessageResponse> {
    return this.teamChatService.postMessage(teamId, playerId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('messages')
  async listMessages(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
    @Query() query: ListChatMessagesQueryDto,
  ): Promise<{ messages: ChatMessageListItem[] }> {
    const messages = await this.teamChatService.listMessages(
      teamId,
      playerId,
      query.after,
      query.limit,
    );
    return { messages };
  }

  @UseGuards(JwtAuthGuard)
  @Post('messages/:messageId/report')
  @HttpCode(HttpStatus.CREATED)
  async reportMessage(
    @Param('teamId') teamId: string,
    @Param('messageId') messageId: string,
    @CurrentPlayerId() playerId: string,
    @Body() dto: ReportChatMessageDto,
  ): Promise<ChatReportResponse> {
    return this.teamChatService.reportMessage(teamId, playerId, messageId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('blocks')
  @HttpCode(HttpStatus.OK)
  async blockPlayer(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
    @Body() dto: BlockChatPlayerDto,
  ): Promise<ChatBlockResponse> {
    return this.teamChatService.blockPlayer(teamId, playerId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('blocks/:blockedPlayerId')
  @HttpCode(HttpStatus.OK)
  async unblockPlayer(
    @Param('teamId') teamId: string,
    @Param('blockedPlayerId') blockedPlayerId: string,
    @CurrentPlayerId() playerId: string,
  ): Promise<ChatUnblockResponse> {
    return this.teamChatService.unblockPlayer(
      teamId,
      playerId,
      blockedPlayerId,
    );
  }
}
