import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BugReportRateLimitedException } from '../common/errors/exceptions';
import { RedisService } from '../redis/redis.service';
import { CreateBugReportDto } from './dto/create-bug-report.dto';
import { BugReport, BugReportStatus } from './entities/bug-report.entity';

/** What the mobile app gets back — deliberately just the id and the
 * timestamp. docs/design/phase7-admin-console-flows.md §9.5's success
 * screen makes no promise of a reply (there is no reply channel in this
 * design at all), so there is nothing else worth handing back. */
export interface CreateBugReportResult {
  id: string;
  createdAt: string;
}

/**
 * docs/adr/0022-admin-control-center.md Decision 7's submission side.
 *
 * **Deliberately NOT consent-gated — this is intentional, do not "fix" it.**
 * There is no `assertConsentApproved` call here and there must not be one.
 * docs/design/phase7-admin-console-flows.md §9.1 is explicit: the entry
 * point renders for anyone with a session, *including* a player whose
 * parental consent is still `pending`, because "a child stuck in the waiting
 * state is precisely the person most likely to have something worth
 * reporting". Decision 7 specifies plain `JwtAuthGuard` for the same reason.
 * Gating this on approved consent would silence exactly the cohort whose
 * problems are hardest to reproduce.
 *
 * That is a narrow, argued exception, not a general loosening: the
 * consent-gated surfaces (training logs, team chat, clips) all *write into a
 * team's shared space*, which is what consent is protecting. A bug report
 * goes to the developer and to no peer, ever.
 */
@Injectable()
export class BugReportsService {
  constructor(
    @InjectRepository(BugReport)
    private readonly bugReportRepository: Repository<BugReport>,
    private readonly redisService: RedisService,
  ) {}

  async submit(
    playerId: string,
    dto: CreateBugReportDto,
  ): Promise<CreateBugReportResult> {
    // Rate limit before the insert, same order as AccountErasureService: a
    // request that's going to be refused should never reach Postgres.
    const burstClaimed =
      await this.redisService.tryClaimBugReportCooldown(playerId);
    if (!burstClaimed) {
      throw new BugReportRateLimitedException();
    }
    const dailyClaimed =
      await this.redisService.tryClaimBugReportDailyCap(playerId);
    if (!dailyClaimed) {
      throw new BugReportRateLimitedException();
    }

    const repository = this.bugReportRepository;
    const saved = await repository.save(
      repository.create({
        playerId,
        category: dto.category,
        screen: dto.screen,
        // `description`/`osVersion` are optional on the wire and NOT NULL-able
        // in the column, so absent becomes an explicit null rather than
        // `undefined` (which TypeORM would omit from the INSERT entirely).
        description: dto.description ?? null,
        appVersion: dto.appVersion,
        platform: dto.platform,
        osVersion: dto.osVersion ?? null,
        locale: dto.locale,
        // Not accepted from the client: a reporter has no business filing a
        // report that's already `triaged`/`closed`. The column default says
        // the same thing at the database, this says it in the one place a
        // reader looks first.
        status: BugReportStatus.OPEN,
      }),
    );

    return { id: saved.id, createdAt: saved.createdAt.toISOString() };
  }
}
