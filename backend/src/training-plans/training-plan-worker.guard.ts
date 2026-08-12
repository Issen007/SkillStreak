import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { TrainingPlanWorkerUnauthorizedException } from '../common/errors/exceptions';

/**
 * The generator's credential, and **deliberately not the tagging one**.
 *
 * ADR-0028 Decision 10 and the video design doc both argue this: the two
 * workloads have different risk profiles, and one shared token would mean
 * enabling the plan generator silently enables clip analysis, with a leak
 * of either being a leak of both. Two names, two secrets, two
 * independently-flippable features.
 *
 * The risk profiles really are different, and in this one's favour: this
 * endpoint hands out an adult's typed prompt and a set of adult-authored
 * drills. No frame of any child's video passes through it. That is why a
 * leak here costs compute and an adult's text, rather than media.
 *
 * Same posture otherwise: absent means off, constant-time comparison, a
 * length floor, and one indistinguishable rejection for every cause.
 */
@Injectable()
export class TrainingPlanWorkerGuard implements CanActivate {
  private readonly logger = new Logger(TrainingPlanWorkerGuard.name);
  static readonly MIN_TOKEN_LENGTH = 32;

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = (
      this.configService.get<string>('TRAINING_PLAN_WORKER_TOKEN') ?? ''
    ).trim();

    if (!expected) throw new TrainingPlanWorkerUnauthorizedException();

    if (expected.length < TrainingPlanWorkerGuard.MIN_TOKEN_LENGTH) {
      this.logger.error(
        'TRAINING_PLAN_WORKER_TOKEN is shorter than ' +
          `${TrainingPlanWorkerGuard.MIN_TOKEN_LENGTH} characters. ` +
          'Refusing every request.',
      );
      throw new TrainingPlanWorkerUnauthorizedException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, presented] = (request.headers.authorization ?? '').split(
      ' ',
    );
    if (scheme?.toLowerCase() !== 'bearer' || !presented) {
      throw new TrainingPlanWorkerUnauthorizedException();
    }

    const digest = (value: string): Buffer =>
      createHash('sha256').update(value, 'utf8').digest();
    if (!timingSafeEqual(digest(presented), digest(expected))) {
      throw new TrainingPlanWorkerUnauthorizedException();
    }
    return true;
  }
}
