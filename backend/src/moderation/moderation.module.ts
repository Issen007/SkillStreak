import { Module } from '@nestjs/common';
import { CHAT_MODERATION_CHECK } from '../team-chat/chat-moderation-check.interface';
import { KeywordChatModerationCheck } from '../team-chat/keyword-chat-moderation-check';

// docs/adr/0009-self-service-team-creation.md Decision 5 — the
// CHAT_MODERATION_CHECK DI binding, extracted out of TeamChatModule so
// TeamsModule can reuse it (TeamsService.createTeam's team-name/invite-code
// checks) without pulling in TeamChatModule's unrelated entities/imports
// (TeamChatMessage/TeamChatBlock/TeamChatMessageReport, MailModule,
// RedisModule, PlayerPrivateInfoModule). This module owns *only* the
// binding — the interface, its token, the keyword implementation, and the
// wordlist file (chat-moderation-check.interface.ts,
// keyword-chat-moderation-check.ts, swedish-filter-wordlist.json)
// deliberately stay in src/team-chat/, unmoved and unrenamed, per the ADR's
// explicit "already-shipped, already security-reviewed" reasoning.
// Swapping the keyword implementation for an LLM-backed one later
// (docs/BACKLOG.md's deferred item) is a one-line change here, picked up
// automatically by both TeamChatModule and TeamsModule.
@Module({
  providers: [
    { provide: CHAT_MODERATION_CHECK, useClass: KeywordChatModerationCheck },
  ],
  exports: [CHAT_MODERATION_CHECK],
})
export class ModerationModule {}
