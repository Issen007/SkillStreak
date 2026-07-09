// docs/adr/0007-team-chat.md Decision 2 — a synchronous-shaped-as-async
// check on send, behind a one-method interface, so a future async/LLM
// classifier (docs/BACKLOG.md's deferred "Team Chat — LLM-based
// Moderation" item) can replace or augment today's keyword implementation
// without changing TeamChatService.postMessage's pipeline shape at all —
// only the provider binding for CHAT_MODERATION_CHECK changes.
export interface ChatModerationResult {
  allowed: boolean;
}

export interface ChatModerationCheck {
  check(content: string): Promise<ChatModerationResult>;
}

export const CHAT_MODERATION_CHECK = Symbol('CHAT_MODERATION_CHECK');
