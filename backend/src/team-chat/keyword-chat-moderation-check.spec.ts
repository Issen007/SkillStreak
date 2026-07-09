import { KeywordChatModerationCheck } from './keyword-chat-moderation-check';

// Integration-with-the-real-file sanity check — the pure matching logic
// itself is exercised exhaustively in keyword-match.util.spec.ts; this file
// only confirms the real swedish-filter-wordlist.json loads and the
// Promise-returning interface contract holds (ADR-0007 Decision 2: this is
// deliberately async-shaped even though today's check is synchronous under
// the hood, so an eventual network-backed classifier is a drop-in).
describe('KeywordChatModerationCheck', () => {
  const check = new KeywordChatModerationCheck();

  it('allows ordinary content', async () => {
    await expect(check.check('Bra jobbat idag allihopa! 💪')).resolves.toEqual({
      allowed: true,
    });
  });

  it('rejects content containing a real wordlist entry', async () => {
    await expect(check.check('din jävla idiot')).resolves.toEqual({
      allowed: false,
    });
  });

  it('returns a Promise (interface contract for a future async classifier)', () => {
    const result = check.check('hej');
    expect(result).toBeInstanceOf(Promise);
  });
});
