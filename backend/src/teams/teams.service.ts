import { Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { InviteCodeNotFoundException } from '../common/errors/exceptions';
import { Team } from './entities/team.entity';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
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
}
