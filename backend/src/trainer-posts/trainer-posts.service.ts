import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { findContactDetail } from '../drills/drill-library.service';
import {
  TrainerPostForbiddenContentException,
  TrainerPostNotFoundException,
} from '../common/errors/exceptions';
import { TrainerPost, TrainerPostStatus } from './entities/trainer-post.entity';
import { CreateTrainerPostDto } from './dto/create-trainer-post.dto';

/**
 * A domain with no scheme and no `www.`, which `findContactDetail` does
 * not catch — "boka på coach.example.com" sails past it.
 *
 * The drill library can live without this because its content is curated
 * through a git diff before anyone sees it. Trainer posts are written at
 * runtime by people with a commercial interest in being findable, so the
 * bar has to be higher there.
 *
 * Anchored to a short list of real TLDs rather than `\.[a-z]{2,}`, which
 * would reject ordinary Swedish prose ("kl. 18", "t.ex. passningar") and
 * teach authors that the rule is arbitrary.
 */
const BARE_DOMAIN =
  /\b[a-z0-9][a-z0-9-]*\.(se|com|net|org|nu|io|co|uk|de|fi|no|dk|eu|info|app)\b/i;

function findBareDomain(value: string): string | null {
  return BARE_DOMAIN.test(value) ? 'a web address' : null;
}

/** What a reader sees. Never the reviewer, never a rejection reason. */
export interface TrainerPostPublicView {
  id: string;
  title: string;
  body: string;
  authorByline: string;
  locale: string;
  ageBand: string | null;
  focus: string | null;
  publishedAt: string | null;
}

/** What an author sees of their own post — adds its review state. */
export interface TrainerPostAuthorView extends TrainerPostPublicView {
  status: TrainerPostStatus;
  rejectionReason: string | null;
  createdAt: string;
}

function toPublicView(post: TrainerPost): TrainerPostPublicView {
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    authorByline: post.authorByline,
    locale: post.locale,
    ageBand: post.ageBand,
    focus: post.focus,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
  };
}

function toAuthorView(post: TrainerPost): TrainerPostAuthorView {
  return {
    ...toPublicView(post),
    status: post.status,
    rejectionReason: post.rejectionReason,
    createdAt: post.createdAt.toISOString(),
  };
}

/**
 * Trainer-published tips (owner's decision, 2026-08-13).
 *
 * The half of the "scroll feed" request that touches no child data: an
 * adult publishing their own words, reviewed by an operator before a
 * child can see it, with no transaction of any kind.
 *
 * Three controls, and it is worth being clear about which is load-bearing:
 *
 * 1. **Operator review before publish.** This is the real control. There
 *    is no automated judgement of whether a tip suits a nine-year-old and
 *    this service does not pretend to make one — a human reads every post
 *    before it appears, and who that was is recorded on the row. The same
 *    policy-not-technology posture ADR-0029 Decision 5 takes for the
 *    drill library, which is reviewed as a git diff.
 * 2. **No contact details, enforced.** Reuses the drill library's own
 *    `findContactDetail` rather than a second regex that would drift
 *    from it. This is what keeps "self-promotion" from becoming a
 *    channel: a trainer may say who they are and where they coach, and
 *    may not publish a URL, an email or a phone number to an audience of
 *    children. It also happens to enforce the owner's "free tips and
 *    self-promotion, no transactions" line, since a booking link is a
 *    URL.
 * 3. **Readers cannot reply.** There is no comment, no reaction and no
 *    message route anywhere in this feature, and adding one would be a
 *    visible change rather than a quiet one. A stranger publishing TO
 *    children is a different risk from a stranger corresponding WITH
 *    them, and only the first is on offer here.
 *
 * What this deliberately is not: a place for children's clips. Those stay
 * inside their team until a consent decision says otherwise, and nothing
 * in this file references a clip, a player or a team.
 */
@Injectable()
export class TrainerPostsService {
  private readonly logger = new Logger(TrainerPostsService.name);

  constructor(
    @InjectRepository(TrainerPost)
    private readonly postRepository: Repository<TrainerPost>,
  ) {}

  /**
   * The content rule, applied to everything an author supplies.
   *
   * Title and byline are checked as well as the body: "Book me at
   * coach.example.com" in a title would otherwise sail past a body-only
   * check, and the byline is the field most likely to be used as an
   * advert.
   */
  private assertPublishable(input: {
    title: string;
    body: string;
    authorByline: string;
  }): void {
    // Picked explicitly rather than iterating the argument, because
    // `publish` passes a whole entity and `Object.entries` would then
    // walk `id` — a UUID, whose digits the phone-number heuristic
    // matches. That made every publish fail with "the id contains what
    // looks like a phone number". Caught by a test before it shipped;
    // naming the three fields means a column added later cannot
    // reintroduce it.
    const checked: Array<[string, string]> = [
      ['title', input.title],
      ['body', input.body],
      ['authorByline', input.authorByline],
    ];
    for (const [field, value] of checked) {
      const contact = findContactDetail(value) ?? findBareDomain(value);
      if (contact) {
        throw new TrainerPostForbiddenContentException(field, contact);
      }
    }
  }

  async create(
    authorStaffAccountId: string,
    dto: CreateTrainerPostDto,
  ): Promise<TrainerPostAuthorView> {
    const input = {
      title: dto.title.trim(),
      body: dto.body.trim(),
      authorByline: dto.authorByline.trim(),
    };
    this.assertPublishable(input);

    const saved = await this.postRepository.save(
      this.postRepository.create({
        ...input,
        authorStaffAccountId,
        locale: dto.locale ?? 'sv',
        ageBand: dto.ageBand ?? null,
        focus: dto.focus ?? null,
        // Always pending. There is no argument an author can pass that
        // publishes their own post, which is the point of the enum
        // having no author-controlled transition to `published`.
        status: TrainerPostStatus.PENDING_REVIEW,
      }),
    );
    return toAuthorView(saved);
  }

  /** The feed. Published only, newest first. */
  async listPublished(limit = 50): Promise<TrainerPostPublicView[]> {
    const posts = await this.postRepository.find({
      where: { status: TrainerPostStatus.PUBLISHED },
      order: { publishedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return posts.map(toPublicView);
  }

  /** An author's own posts, in every state. */
  async listOwn(
    authorStaffAccountId: string,
  ): Promise<TrainerPostAuthorView[]> {
    const posts = await this.postRepository.find({
      where: { authorStaffAccountId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return posts.map(toAuthorView);
  }

  /**
   * What is currently live.
   *
   * Exists so `unpublish` is reachable. Without it the operator could
   * only ever see the pending queue, which made taking something down
   * an endpoint with no way to find its argument — a control that exists
   * and cannot be used is not a control.
   */
  async listPublishedForReview(): Promise<TrainerPostAuthorView[]> {
    const posts = await this.postRepository.find({
      where: { status: TrainerPostStatus.PUBLISHED },
      order: { publishedAt: 'DESC' },
      take: 200,
    });
    return posts.map(toAuthorView);
  }

  /** The operator's queue. */
  async listPendingReview(): Promise<TrainerPostAuthorView[]> {
    const posts = await this.postRepository.find({
      where: { status: TrainerPostStatus.PENDING_REVIEW },
      order: { createdAt: 'ASC' },
      take: 200,
    });
    return posts.map(toAuthorView);
  }

  async publish(
    reviewerStaffAccountId: string,
    id: string,
  ): Promise<TrainerPostAuthorView> {
    const post = await this.findPending(id);

    // Re-checked at publish, not only at create. The content rule must
    // hold for what actually reaches a child's screen, and a post can sit
    // in the queue across a change to what counts as a contact detail.
    this.assertPublishable(post);

    post.status = TrainerPostStatus.PUBLISHED;
    post.reviewedByStaffAccountId = reviewerStaffAccountId;
    post.reviewedAt = new Date();
    post.publishedAt = new Date();
    post.rejectionReason = null;
    await this.postRepository.save(post);

    this.logger.log(`Trainer post ${post.id} published after review.`);
    return toAuthorView(post);
  }

  async reject(
    reviewerStaffAccountId: string,
    id: string,
    reason: string,
  ): Promise<TrainerPostAuthorView> {
    const post = await this.findPending(id);
    post.status = TrainerPostStatus.REJECTED;
    post.reviewedByStaffAccountId = reviewerStaffAccountId;
    post.reviewedAt = new Date();
    post.rejectionReason = reason.trim();
    await this.postRepository.save(post);
    return toAuthorView(post);
  }

  /**
   * Take a published post back off the feed.
   *
   * Separate from `reject` because it answers a different question: this
   * is "we published it and should not have", and the fastest possible
   * path back is the one that matters. It returns the post to the queue
   * rather than deleting it, so the author can see what happened and the
   * review record survives.
   */
  async unpublish(
    reviewerStaffAccountId: string,
    id: string,
    reason: string,
  ): Promise<TrainerPostAuthorView> {
    const post = await this.postRepository.findOne({ where: { id } });
    if (!post || post.status !== TrainerPostStatus.PUBLISHED) {
      throw new TrainerPostNotFoundException();
    }
    post.status = TrainerPostStatus.REJECTED;
    post.reviewedByStaffAccountId = reviewerStaffAccountId;
    post.reviewedAt = new Date();
    post.rejectionReason = reason.trim();
    post.publishedAt = null;
    await this.postRepository.save(post);

    this.logger.warn(`Trainer post ${post.id} unpublished after review.`);
    return toAuthorView(post);
  }

  /** An author deleting their own post, in any state. */
  async deleteOwn(authorStaffAccountId: string, id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TrainerPostNotFoundException();
    const result = await this.postRepository.delete({
      id,
      authorStaffAccountId,
    });
    if (!result.affected) throw new TrainerPostNotFoundException();
  }

  private async findPending(id: string): Promise<TrainerPost> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TrainerPostNotFoundException();
    const post = await this.postRepository.findOne({ where: { id } });
    if (!post || post.status !== TrainerPostStatus.PENDING_REVIEW) {
      throw new TrainerPostNotFoundException();
    }
    return post;
  }
}
