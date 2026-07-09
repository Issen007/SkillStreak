import { Inject, Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  InviteCodeNotFoundException,
  TeamNameRejectedByFilterException,
} from '../common/errors/exceptions';
import type { ChatModerationCheck } from '../team-chat/chat-moderation-check.interface';
import { CHAT_MODERATION_CHECK } from '../team-chat/chat-moderation-check.interface';
import { Team } from './entities/team.entity';

export interface CreateTeamInput {
  name: string;
  inviteCode: string;
}

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @Inject(CHAT_MODERATION_CHECK)
    private readonly chatModerationCheck: ChatModerationCheck,
  ) {}

  async findByInviteCode(
    inviteCode: string,
    manager?: EntityManager,
  ): Promise<Team | null> {
    const repository = manager
      ? manager.getRepository(Team)
      : this.teamRepository;
    return repository.findOne({ where: { inviteCode } });
  }

  async findByInviteCodeOrThrow(
    inviteCode: string,
    manager?: EntityManager,
  ): Promise<Team> {
    const team = await this.findByInviteCode(inviteCode, manager);
    if (!team) {
      throw new InviteCodeNotFoundException();
    }
    return team;
  }

  async findById(
    teamId: string,
    manager?: EntityManager,
  ): Promise<Team | null> {
    const repository = manager
      ? manager.getRepository(Team)
      : this.teamRepository;
    return repository.findOne({ where: { id: teamId } });
  }

  /**
   * The single entry point for creating a `Team` row anywhere in this
   * codebase (docs/adr/0009-self-service-team-creation.md Decision 2) — so
   * "create a team" and "team name/invite code were checked" can't be
   * structurally separated by a future caller who forgets to check first,
   * the same "boundary enforced by code shape, not caller discipline"
   * reasoning docs/adr/0002's addendum already applies to
   * PlayerPrivateInfoModule. Checks both `name` and `inviteCode` against
   * the shared ChatModerationCheck (ADR-0009 Decision 5, and — per
   * docs/ACTION_PLAN.md's Phase 2.9 section — the confirmed decision to
   * also check the invite code, not just the name, since it's now
   * potentially child-chosen and permanently repeated aloud to recruit
   * teammates). The response doesn't need to distinguish which field
   * failed, so both checks throw the same exception. Always takes a
   * manager: this is only ever called from inside
   * OnboardingService.createPlayer's transaction today (see that ADR's
   * Decision 1 on why team creation isn't its own endpoint/transaction).
   */
  async createTeam(
    manager: EntityManager,
    input: CreateTeamInput,
  ): Promise<Team> {
    const [nameResult, inviteCodeResult] = await Promise.all([
      this.chatModerationCheck.check(input.name),
      this.chatModerationCheck.check(input.inviteCode),
    ]);
    if (!nameResult.allowed || !inviteCodeResult.allowed) {
      throw new TeamNameRejectedByFilterException();
    }

    const repository = manager.getRepository(Team);
    const team = repository.create({
      name: input.name,
      inviteCode: input.inviteCode,
    });
    return repository.save(team);
  }
}
