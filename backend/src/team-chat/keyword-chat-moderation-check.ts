import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import {
  ChatModerationCheck,
  ChatModerationResult,
} from './chat-moderation-check.interface';
import { containsBannedWord } from './keyword-match.util';

const WORDLIST_FILENAME = 'swedish-filter-wordlist.json';

/**
 * Loaded once per process (not per call) — the list is small, static, seeded
 * data (per ADR-0007 Decision 2: "a plain, reviewable data file... not a
 * database table"), not something that changes within a running process.
 * Read via fs (not a TS `import ... from '*.json'`) + nest-cli.json's
 * `assets` entry so this works identically under ts-node (tests) and the
 * compiled dist/ build, without depending on resolveJsonModule/module-
 * resolution quirks between the two.
 */
function loadWordlist(): string[] {
  const raw = readFileSync(join(__dirname, WORDLIST_FILENAME), 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry) => typeof entry === 'string')
  ) {
    throw new Error(`${WORDLIST_FILENAME} must be a JSON array of strings.`);
  }
  return parsed;
}

// docs/adr/0007-team-chat.md Decision 2 — the Fas 2.6b implementation of
// ChatModerationCheck, bound to CHAT_MODERATION_CHECK in TeamChatModule.
// TeamChatService only ever depends on the interface, never this class
// directly, so swapping in an LLM-backed implementation later
// (docs/BACKLOG.md's deferred item) is a provider-binding change, not a
// rewrite of the send path.
@Injectable()
export class KeywordChatModerationCheck implements ChatModerationCheck {
  private readonly wordlist: string[] = loadWordlist();

  // Returns via Promise.resolve (not `async`/`await`) — the interface is
  // Promise-returning on purpose (see its own comment) even though today's
  // keyword check is synchronous under the hood; this satisfies that
  // contract without an `async` function that never actually awaits
  // anything.
  check(content: string): Promise<ChatModerationResult> {
    const allowed = !containsBannedWord(content, this.wordlist);
    return Promise.resolve({ allowed });
  }
}
