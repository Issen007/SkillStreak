import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImprovementSuggestionRateLimitedException } from '../common/errors/exceptions';
import { RedisService } from '../redis/redis.service';
import { CreateImprovementSuggestionDto } from './dto/create-improvement-suggestion.dto';
import {
  ImprovementSuggestion,
  ImprovementSuggestionStatus,
} from './entities/improvement-suggestion.entity';

/** What the mobile app gets back — deliberately just the id and the
 * timestamp. The success screen makes no promise of a reply (there is no
 * reply channel in this design at all), so there is nothing else worth
 * handing back. */
export interface CreateImprovementSuggestionResult {
  id: string;
  createdAt: string;
}

/**
 * docs/adr/0037-in-app-improvement-suggestions.md — the submission side.
 *
 * **Deliberately NOT consent-gated — this is intentional, do not "fix"
 * it.** There is no `assertConsentApproved` call here and there must not
 * be one. The project owner decided this explicitly on 2026-09-09, on the
 * argument BugReportsService already runs on: a suggestion goes to the
 * operator and to no peer, ever, so the thing parental consent protects —
 * a child writing into a team's shared space — is not in play. One rule
 * for both free-text-to-operator surfaces beats two rules that differ for
 * reasons nobody will remember in six months.
 *
 * That is a narrow, argued exception rather than a general loosening. The
 * consent-gated surfaces (training logs, team chat, clips) all write into
 * a team's shared space; this writes into a table only the operator reads.
 */
@Injectable()
export class ImprovementSuggestionsService {
  constructor(
    @InjectRepository(ImprovementSuggestion)
    private readonly improvementSuggestionRepository: Repository<ImprovementSuggestion>,
    private readonly redisService: RedisService,
  ) {}

  async submit(
    playerId: string,
    dto: CreateImprovementSuggestionDto,
  ): Promise<CreateImprovementSuggestionResult> {
    // Rate limit before the insert, same order as BugReportsService and
    // AccountErasureService: a request that's going to be refused should
    // never reach Postgres.
    const burstClaimed =
      await this.redisService.tryClaimImprovementSuggestionCooldown(playerId);
    if (!burstClaimed) {
      throw new ImprovementSuggestionRateLimitedException();
    }
    const dailyClaimed =
      await this.redisService.tryClaimImprovementSuggestionDailyCap(playerId);
    if (!dailyClaimed) {
      throw new ImprovementSuggestionRateLimitedException();
    }

    const repository = this.improvementSuggestionRepository;
    const saved = await repository.save(
      repository.create({
        playerId,
        // Already trimmed by the DTO's own transform — not re-trimmed here,
        // so there is exactly one place that decides what "empty" means.
        body: dto.body,
        appVersion: dto.appVersion,
        locale: dto.locale,
        // Not accepted from the client: a child has no business filing a
        // suggestion that is already `triaged`/`closed`. The column default
        // says the same thing at the database; this says it in the one
        // place a reader looks first.
        status: ImprovementSuggestionStatus.OPEN,
      }),
    );

    return { id: saved.id, createdAt: saved.createdAt.toISOString() };
  }
}
