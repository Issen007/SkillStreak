import { CaptainConsentRequiredException } from '../common/errors/exceptions';
import { SessionService } from './session.service';

// SessionController's routes are both unconditionally disabled (503, see
// SessionReissueDisabledException's comment) — SessionService.triggerReissue
// itself is never reachable over HTTP today, so this is the only test
// coverage exercising docs/ACTION_PLAN.md's Phase 2.9 acting-captain
// consent gate for this particular call site (it's the same
// PlayersService.assertIsCaptainOfTeam every other captain-gated service
// method reuses — see players.service.spec.ts for the check's own tests).
describe("SessionService.triggerReissue — acting-captain's own consent gate", () => {
  it('propagates CaptainConsentRequiredException from assertIsCaptainOfTeam without ever generating a reissue code', async () => {
    const targetPlayer = { id: 'target-1', teamId: 'team-1' };
    const playersService = {
      findByIdOrThrow: jest.fn().mockResolvedValue(targetPlayer),
      assertIsCaptainOfTeam: jest
        .fn()
        .mockRejectedValue(new CaptainConsentRequiredException()),
      findByIdForUpdate: jest.fn(),
      setSessionReissueCode: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn((cb: (manager: unknown) => unknown) =>
        cb(undefined),
      ),
    };

    const service = new SessionService(
      dataSource as never,
      playersService as never,
      undefined as never,
    );

    await expect(
      service.triggerReissue('captain-1', 'target-1'),
    ).rejects.toBeInstanceOf(CaptainConsentRequiredException);

    expect(playersService.assertIsCaptainOfTeam).toHaveBeenCalledWith(
      'captain-1',
      'team-1',
    );
    expect(playersService.findByIdForUpdate).not.toHaveBeenCalled();
    expect(playersService.setSessionReissueCode).not.toHaveBeenCalled();
  });
});
