import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

// Everything here is a cache/accelerator over Postgres, per
// docs/adr/0002-data-model.md — safe to lose, rebuildable (see
// src/scripts/rebuild-redis-cache.ts), never the only copy of anything.
// Written *after* the Postgres transaction commits (see
// TrainingLogsService), never instead of it.
const DAY_KEY_TTL_SECONDS = 60 * 60 * 36; // a little over a day, covers the boundary

function loggedTodayKey(playerId: string, dateString: string): string {
  return `player:${playerId}:logged:${dateString}`;
}

function teamPoolGaugeKey(teamSeasonPotId: string): string {
  return `team-pool:${teamSeasonPotId}:points_total`;
}

function teamStreakLeaderboardKey(teamId: string): string {
  return `leaderboard:team:${teamId}:streak`;
}

function consentReminderCooldownKey(playerId: string): string {
  return `consent-reminder:${playerId}:cooldown`;
}

function sessionReissueCooldownKey(playerId: string): string {
  return `session-reissue:${playerId}:cooldown`;
}

function sessionReissueDailyCapKey(playerId: string): string {
  return `session-reissue:${playerId}:daily-cap`;
}

function contactChangeCooldownKey(playerId: string): string {
  return `contact-change:${playerId}:cooldown`;
}

function contactChangeDailyCapKey(playerId: string): string {
  return `contact-change:${playerId}:daily-cap`;
}

function chatSendRateLimitKey(playerId: string): string {
  return `chat-send:${playerId}:window`;
}

function chatReportCooldownKey(playerId: string): string {
  return `chat-report:${playerId}:cooldown`;
}

function chatReportNotifyCooldownKey(reportedPlayerId: string): string {
  return `chat-report-notify:${reportedPlayerId}:cooldown`;
}

function clipCompleteRateLimitKey(playerId: string): string {
  return `ratelimit:clip-complete:${playerId}`;
}

// Admission control for the expensive half of completeUpload, keyed by
// clip rather than by player: the cost being bounded is per-object work
// (a full download into heap plus an ffmpeg run), and two completes on
// the SAME clip are the case that multiplies it.
function clipProcessingLockKey(clipId: string): string {
  return `lock:clip-processing:${clipId}`;
}

function clipUploadRateLimitKey(playerId: string): string {
  return `clip-upload:${playerId}:window`;
}

function clipReportCooldownKey(playerId: string): string {
  return `clip-report:${playerId}:cooldown`;
}

function clipReportNotifyCooldownKey(uploaderPlayerId: string): string {
  return `clip-report-notify:${uploaderPlayerId}:cooldown`;
}

function erasureRequestCooldownKey(playerId: string): string {
  return `erasure-request:${playerId}:cooldown`;
}

function erasureRequestDailyCapKey(playerId: string): string {
  return `erasure-request:${playerId}:daily-cap`;
}

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A2 — the
// not-yet-redeemed PT team-invite code. Deliberately NOT a 4th new
// Postgres table (the ADR's own "New tables" Consequences list names only
// PtTeamLink/PtPlayerConsent) — this is exactly the "fast-moving, safe to
// lose, single-use, short-TTL" state CLAUDE.md already assigns to Redis.
// The stored value is the JSON-encoded { teamId, invitedByPlayerId } pair
// needed to create the PtTeamLink row once a `pt`-role StaffAccount
// redeems it.
function ptTeamLinkInviteKey(code: string): string {
  return `pt-team-link-invite:${code}`;
}

function ptConsentRequestCooldownKey(ptStaffAccountId: string): string {
  return `pt-consent-request:${ptStaffAccountId}:cooldown`;
}

// docs/adr/0022-admin-control-center.md Decision 7 — "rate-limited (reuse
// the existing @Throttle/Redis-cooldown pattern, e.g. a per-player daily
// cap)". Same two-key burst+daily shape as erasure-request above, which
// docs/design/phase7-admin-console-flows.md §13 names as the precedent to
// match (down to the `bug_report_rate_limited` error code mirroring
// `erasure_rate_limited`).
function bugReportCooldownKey(playerId: string): string {
  return `bug-report:${playerId}:cooldown`;
}

function bugReportDailyCapKey(playerId: string): string {
  return `bug-report:${playerId}:daily-cap`;
}

function ptConsentRequestDailyCapKey(ptStaffAccountId: string): string {
  return `pt-consent-request:${ptStaffAccountId}:daily-cap`;
}

// k8s/README.md's now-resolved "Migration race with multiple api
// replicas" note — once the API runs 2+ replicas, every `@Cron`-decorated
// scheduled job (ClipRetentionService's two sweeps,
// AccountErasureSweepService's sweep) would otherwise fire redundantly on
// every replica on the same tick. Unlike the migration-run case (a
// blocking Postgres advisory lock — see
// backend/src/scripts/migrate-with-lock.ts), a scheduled job just needs a
// non-blocking try-lock: whichever replica's `@nestjs/schedule` timer
// fires first claims this key, everyone else skips the tick entirely
// rather than waiting to run redundantly right after.
function scheduledJobRunKey(jobName: string): string {
  return `scheduled-job-run:${jobName}`;
}

// docs/api/phase2-contract.md endpoint 3: "rate-limited per player" — a
// per-IP @Throttle() (as used elsewhere in this codebase) doesn't express
// that on its own, since a captain's IP isn't the thing being limited, the
// *target player* is. A per-second-chance-of-collision cooldown lock is
// exactly the kind of fast-moving, safe-to-lose state Redis already owns
// in this app (ADR-0002) — it's a UX rate limit, not the security boundary
// (that's the captain check + the mailed token itself).
const CONSENT_REMINDER_COOLDOWN_SECONDS = 5 * 60;

// docs/adr/0004-coach-auth-and-session-reissue.md's 2026-07-27 addendum —
// same per-player cooldown-lock shape/reasoning as the consent reminder
// above, bounding both trigger surfaces (captain-triggered and the new
// self-service lookup) against inbox-spam harassment of the same family,
// not a security boundary in itself (that's redemption being bound to
// parent_contact, not bearer possession of the code). This alone only
// bounds *burst* rate (one claim per 5 minutes) — see the daily cap below
// for why that's not sufficient on its own.
const SESSION_REISSUE_COOLDOWN_SECONDS = 5 * 60;

// security-reviewer finding (2026-07-27, before this shipped): the 5-minute
// cooldown above still allows up to ~288 forced session-invalidations +
// parent_contact emails per day for one player, since `reissue-request` is
// unauthenticated and needs no secret (team invite codes are meant to be
// shared, screen names are visible to any teammate via the roster) — the
// exact same "sustained volume, not just burst" gap this codebase already
// found and fixed for consent-reminder resends (that finding recommended
// "a daily cap per target (e.g. 3/day)", applied here verbatim, same
// reasoning as chatReportNotifyCooldown/clipReportNotifyCooldown's 24h
// caps). Bounds the *whole* reissue action (token_version bump + email),
// not just the notification, since forced logout itself is the harm here,
// not only the email.
const SESSION_REISSUE_DAILY_CAP_WINDOW_SECONDS = 60 * 60 * 24;
const SESSION_REISSUE_DAILY_CAP_MAX_PER_WINDOW = 3;

// docs/adr/0012-profile-page-and-contact-email-change.md — same two-layer
// shape as session reissue directly above (burst cooldown + daily cap),
// applied preemptively rather than waiting for a repeat security-reviewer
// finding, now that the pattern is established. Smaller attack surface
// than session reissue's (the caller must already hold a valid session
// for the target account — no unauthenticated trigger), but the same
// "real family's inbox" harm applies regardless of how a session was
// obtained.
const CONTACT_CHANGE_COOLDOWN_SECONDS = 5 * 60;
const CONTACT_CHANGE_DAILY_CAP_WINDOW_SECONDS = 60 * 60 * 24;
const CONTACT_CHANGE_DAILY_CAP_MAX_PER_WINDOW = 3;

// docs/api/phase2.6b-contract.md endpoint 1: "a burst allowance rather than
// a strict per-message gate... exact window backend-developer's call."
// Judgment call made here: a fixed-window counter (not a single lock) so
// normal back-and-forth conversation isn't gated to one message at a time —
// 20 messages/minute is generous for real chat while still bounding a
// flood/spam script to a small multiple of normal use.
const CHAT_SEND_RATE_LIMIT_WINDOW_SECONDS = 60;
const CHAT_SEND_RATE_LIMIT_MAX_PER_WINDOW = 20;

// docs/adr/0007-team-chat.md Decision 3: "a per-reporter cooldown... so
// mass-reporting can't be used as a harassment tool against the target in
// its own right" — same single-lock shape as the consent-reminder
// cooldown, not a burst counter (there's no legitimate reason to file many
// reports in quick succession, unlike chat messages).
const CHAT_REPORT_COOLDOWN_SECONDS = 30;

// docs/adr/0007-team-chat.md Decision 3: "at most one email per reported
// player per rolling 24 hours, aggregating multiple reports in that window
// into a single email" — deliberately the daily-cap shape the Phase 2.5
// security review asked for, not the old 5-minute-burst-only cooldown.
const CHAT_REPORT_NOTIFY_COOLDOWN_SECONDS = 60 * 60 * 24;

// docs/api/phase3-contract.md endpoint 1: "a per-player upload-frequency
// rate limit... recommend something generous like a handful per day, this
// is a slow, deliberate action, not chat." A fixed-window daily counter,
// same shape as the chat-send allowance but a much longer window/lower cap
// — uploading a clip is a deliberate, multi-step action (pick/record ->
// caption -> two HTTP round trips + a real file PUT), nothing like chat's
// "one tap per thought" cadence.
const CLIP_UPLOAD_RATE_LIMIT_WINDOW_SECONDS = 60 * 60 * 24;
const CLIP_UPLOAD_RATE_LIMIT_MAX_PER_WINDOW = 10;

// Attempts at POST .../clips/:clipId/complete carrying metadata, per player
// per hour. Security-reviewer finding, 2026-08-09: `complete` reaches the
// same caption moderation filter `upload-url` does, but `upload-url`
// deliberately claims its 10/day allowance BEFORE the filter runs, "so
// repeated filter-probing on the caption still costs the uploader's quota,
// not free". Without a limit of its own, `complete` was a free, unmetered
// oracle over the wordlist at the generic 300/min/IP backstop.
//
// 30/hour is generous for the real flow (one complete per upload, plus a
// couple of retries) and useless for enumeration.
const CLIP_COMPLETE_RATE_LIMIT_MAX_PER_WINDOW = 30;

/**
 * How long one clip's processing claim is held (security review finding
 * 2). Generous on purpose: expiry releases the lock, so too short admits
 * the concurrent work the lock exists to prevent, while too long only
 * refuses a retry the caller can repeat.
 */
const CLIP_PROCESSING_LOCK_TTL_SECONDS = 300;
const CLIP_COMPLETE_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

// docs/adr/0010-video-storage-and-serving.md Decision 4 — same per-reporter
// cooldown shape/reasoning as ADR-0007 Decision 3's chat report cooldown:
// bounds mass-reporting as a harassment tool against the *uploader* (a
// report here auto-hides the clip, so this cooldown matters even more than
// chat's non-hiding equivalent).
const CLIP_REPORT_COOLDOWN_SECONDS = 30;

// Same "at most one email per rolling 24 hours, aggregating multiple
// reports in that window" shape as ADR-0007 Decision 3 / the Phase 2.5
// fix — ADR-0010 Decision 4 explicitly reuses this mechanism for the
// uploader's parent + coach notification.
const CLIP_REPORT_NOTIFY_COOLDOWN_SECONDS = 60 * 60 * 24;

// docs/adr/0013-account-erasure.md Decision 3 — same two-layer shape
// (burst cooldown + daily cap) as session-reissue/contact-change: "the
// realistic abuse surface is a compromised session spamming a family's
// inbox with a scary email," identical reasoning to those precedents, not
// a new threat model.
const ERASURE_REQUEST_COOLDOWN_SECONDS = 5 * 60;
const ERASURE_REQUEST_DAILY_CAP_WINDOW_SECONDS = 60 * 60 * 24;
const ERASURE_REQUEST_DAILY_CAP_MAX_PER_WINDOW = 3;

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A2 — "short TTL,
// e.g. 24 hours, single-use", the same shape as Team.invite_code/the
// session-reissue code this ADR names as its direct precedent.
const PT_TEAM_LINK_INVITE_TTL_SECONDS = 24 * 60 * 60;

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A3 — "rate-limited
// (burst + daily cap per PT, reusing RedisService's existing
// tryClaim.../session-reissue-shaped pattern) — the realistic abuse
// surface is a bad-faith or compromised PT account mass-requesting many
// families' inboxes." Same two-layer shape/reasoning as
// session-reissue/contact-change/erasure-request above, applied here
// preemptively (named explicitly by the ADR) rather than found live.
const PT_CONSENT_REQUEST_COOLDOWN_SECONDS = 5 * 60;
const PT_CONSENT_REQUEST_DAILY_CAP_WINDOW_SECONDS = 60 * 60 * 24;
const PT_CONSENT_REQUEST_DAILY_CAP_MAX_PER_WINDOW = 10;

// docs/adr/0022-admin-control-center.md Decision 7's per-player bug-report
// limit. Same two-layer shape as erasure/session-reissue/PT-consent above,
// but deliberately looser at the burst layer and tighter at the daily one,
// because the threat model is genuinely different: nothing here emails a
// family or touches another account, so the abuse surface is only "a
// compromised or bored session filling the operator's triage queue with
// junk rows."
//
// 60 seconds, not 5 minutes, for the burst lock: a child who hits two
// different broken things in one sitting is a completely normal, useful
// reporter, and a 5-minute lockout would suppress the second report
// entirely (Decision 7's own reasoning for keeping the form easy — an
// under-reported bug is the failure mode that actually costs this project
// something). 5/day is the sustained ceiling docs/design/phase7-admin-
// console-flows.md §9.4's copy already assumes ("Du har skickat några
// rapporter idag redan. Testa igen imorgon.").
const BUG_REPORT_COOLDOWN_SECONDS = 60;
const BUG_REPORT_DAILY_CAP_WINDOW_SECONDS = 60 * 60 * 24;
const BUG_REPORT_DAILY_CAP_MAX_PER_WINDOW = 5;

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** Fast "did they already log today" marker for the hot path. */
  async markLoggedToday(playerId: string, dateString: string): Promise<void> {
    await this.client.set(
      loggedTodayKey(playerId, dateString),
      '1',
      'EX',
      DAY_KEY_TTL_SECONDS,
    );
  }

  async hasLoggedToday(playerId: string, dateString: string): Promise<boolean> {
    const value = await this.client.get(loggedTodayKey(playerId, dateString));
    return value === '1';
  }

  /** Live gauge cache of TeamSeasonPot.points_total for instant meter reads. */
  async setTeamPoolGauge(
    teamSeasonPotId: string,
    pointsTotal: number,
  ): Promise<void> {
    await this.client.set(
      teamPoolGaugeKey(teamSeasonPotId),
      String(pointsTotal),
    );
  }

  async getTeamPoolGauge(teamSeasonPotId: string): Promise<number | null> {
    const value = await this.client.get(teamPoolGaugeKey(teamSeasonPotId));
    return value === null ? null : Number(value);
  }

  /**
   * Per-team individual streak leaderboard (sorted set), keyed by team so a
   * query is always naturally team-scoped, per ADR-0002. Uses ZADD (an
   * absolute score set), not ZINCRBY, because currentStreakCount is already
   * the absolute value we want reflected, not a delta.
   */
  async updateLeaderboard(
    teamId: string,
    playerId: string,
    currentStreakCount: number,
  ): Promise<void> {
    await this.client.zadd(
      teamStreakLeaderboardKey(teamId),
      currentStreakCount,
      playerId,
    );
  }

  async getLeaderboard(
    teamId: string,
    limit = 10,
  ): Promise<Array<{ playerId: string; streakCount: number }>> {
    const raw = await this.client.zrevrange(
      teamStreakLeaderboardKey(teamId),
      0,
      limit - 1,
      'WITHSCORES',
    );
    const result: Array<{ playerId: string; streakCount: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ playerId: raw[i], streakCount: Number(raw[i + 1]) });
    }
    return result;
  }

  /**
   * Atomically claims the per-player consent-reminder cooldown lock (a
   * `SET ... NX EX` — set-if-not-exists with a TTL). Returns `true` if this
   * call claimed the lock (i.e. it's fine to send), `false` if another
   * reminder was already sent within the cooldown window. `ttlSeconds` is
   * a parameter (not baked into the key helper) purely so tests can use a
   * short window without waiting out the real 5-minute default.
   */
  async tryClaimConsentReminderCooldown(
    playerId: string,
    ttlSeconds: number = CONSENT_REMINDER_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      consentReminderCooldownKey(playerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Same lock shape as tryClaimConsentReminderCooldown, for
   * SessionService's reissue-email send (ADR-0004's 2026-07-27
   * addendum). Bounds burst rate only — see tryClaimSessionReissueDailyCap
   * for sustained-volume protection. */
  async tryClaimSessionReissueCooldown(
    playerId: string,
    ttlSeconds: number = SESSION_REISSUE_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      sessionReissueCooldownKey(playerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Same fixed-window shape as tryClaimClipUploadAllowance — a
   * security-reviewer finding on the 2026-07-27 addendum's first cut,
   * fixed before shipping: the burst cooldown above alone still allows
   * ~288 forced session-invalidations + parent_contact emails per day for
   * one player, since the endpoint that triggers this needs no secret. */
  async tryClaimSessionReissueDailyCap(
    playerId: string,
    maxPerWindow: number = SESSION_REISSUE_DAILY_CAP_MAX_PER_WINDOW,
    windowSeconds: number = SESSION_REISSUE_DAILY_CAP_WINDOW_SECONDS,
  ): Promise<boolean> {
    const key = sessionReissueDailyCapKey(playerId);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= maxPerWindow;
  }

  /** Same lock shape as tryClaimSessionReissueCooldown, for
   * ProfileService's contact-change-request (ADR-0012). */
  async tryClaimContactChangeCooldown(
    playerId: string,
    ttlSeconds: number = CONTACT_CHANGE_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      contactChangeCooldownKey(playerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Same fixed-window shape as tryClaimSessionReissueDailyCap, for the
   * same "burst cooldown alone isn't enough" reasoning (ADR-0012). */
  async tryClaimContactChangeDailyCap(
    playerId: string,
    maxPerWindow: number = CONTACT_CHANGE_DAILY_CAP_MAX_PER_WINDOW,
    windowSeconds: number = CONTACT_CHANGE_DAILY_CAP_WINDOW_SECONDS,
  ): Promise<boolean> {
    const key = contactChangeDailyCapKey(playerId);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= maxPerWindow;
  }

  /**
   * Fixed-window burst allowance for chat sends (docs/api/phase2.6b-
   * contract.md endpoint 1) — an atomic INCR, with EXPIRE set only on the
   * first increment of a fresh window (count === 1), so the TTL always
   * covers exactly one window from its first use rather than being reset
   * (and thus never expiring) by every subsequent message. Returns `true`
   * if this send is within the allowance (i.e. fine to proceed), `false`
   * once the window's cap is exceeded. `maxPerWindow`/`windowSeconds` are
   * parameters (not baked in) purely so tests can use a small window
   * without waiting out the real one, same reasoning as the consent-
   * reminder cooldown's `ttlSeconds` parameter.
   */
  async tryClaimChatSendAllowance(
    playerId: string,
    maxPerWindow: number = CHAT_SEND_RATE_LIMIT_MAX_PER_WINDOW,
    windowSeconds: number = CHAT_SEND_RATE_LIMIT_WINDOW_SECONDS,
  ): Promise<boolean> {
    const key = chatSendRateLimitKey(playerId);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= maxPerWindow;
  }

  /** Per-reporter send-side cooldown (docs/adr/0007-team-chat.md Decision
   * 3) — bounds mass-reporting as a harassment tool in its own right. */
  async tryClaimChatReportCooldown(
    playerId: string,
    ttlSeconds: number = CHAT_REPORT_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      chatReportCooldownKey(playerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Per-reported-player, 24h notification cooldown (docs/adr/0007-team-
   * chat.md Decision 3) — gates whether the best-effort parent/coach email
   * actually sends, never whether the report itself is persisted. */
  async tryClaimChatReportNotifyCooldown(
    reportedPlayerId: string,
    ttlSeconds: number = CHAT_REPORT_NOTIFY_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      chatReportNotifyCooldownKey(reportedPlayerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Fixed-window daily burst allowance for clip uploads (docs/api/phase3-
   * contract.md endpoint 1) — same INCR+EXPIRE-on-first-increment shape as
   * tryClaimChatSendAllowance, just a daily window instead of a minute. */
  async tryClaimClipUploadAllowance(
    playerId: string,
    maxPerWindow: number = CLIP_UPLOAD_RATE_LIMIT_MAX_PER_WINDOW,
    windowSeconds: number = CLIP_UPLOAD_RATE_LIMIT_WINDOW_SECONDS,
  ): Promise<boolean> {
    const key = clipUploadRateLimitKey(playerId);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= maxPerWindow;
  }

  /** Per-player hourly allowance for metadata-carrying `complete` calls —
   * see CLIP_COMPLETE_RATE_LIMIT_MAX_PER_WINDOW for why this exists
   * separately from the upload allowance. Same INCR+EXPIRE shape. */
  async tryClaimClipCompleteAllowance(
    playerId: string,
    maxPerWindow: number = CLIP_COMPLETE_RATE_LIMIT_MAX_PER_WINDOW,
    windowSeconds: number = CLIP_COMPLETE_RATE_LIMIT_WINDOW_SECONDS,
  ): Promise<boolean> {
    const key = clipCompleteRateLimitKey(playerId);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= maxPerWindow;
  }

  /**
   * Exclusive claim on processing one clip. SET NX, so the first caller
   * wins and every concurrent one is refused rather than queued.
   *
   * Security review 2026-08-17, finding 2: `completeUpload` checked the
   * row was `pending_upload` and only flipped the status *after*
   * downloading the object, writing it to disk, running ffprobe and
   * ffmpeg, and uploading the result. Nothing in between excluded a
   * second caller, so N concurrent completes on one pending clip each
   * buffered the whole file into the API pod's heap and each spawned
   * ffmpeg. At the 75 MB ceiling on a two-replica deployment that is an
   * OOM, not a slowdown.
   *
   * The TTL must outlast a legitimate slow completion, since expiry
   * releases the lock: a clip that takes longer than this would admit a
   * second worker. Sized well above the observed worst case rather than
   * tightly, because the cost of holding it slightly too long (one
   * retry refused) is far smaller than releasing it too early.
   */
  async tryClaimClipProcessing(
    clipId: string,
    ttlSeconds: number = CLIP_PROCESSING_LOCK_TTL_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      clipProcessingLockKey(clipId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /**
   * Releases the processing claim early.
   *
   * Called on both success and failure: a failed complete leaves the row
   * `pending_upload` so the client may legitimately retry, and making
   * them wait out the TTL would turn one transient ffmpeg error into
   * minutes of refused retries.
   */
  async releaseClipProcessing(clipId: string): Promise<void> {
    await this.client.del(clipProcessingLockKey(clipId));
  }

  /** Per-reporter cooldown for clip reports (ADR-0010 Decision 4). */
  async tryClaimClipReportCooldown(
    playerId: string,
    ttlSeconds: number = CLIP_REPORT_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      clipReportCooldownKey(playerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Per-uploader, 24h notification cooldown (ADR-0010 Decision 4) — gates
   * whether the best-effort parent/coach email actually sends, never
   * whether the report itself is persisted or the clip is hidden. */
  async tryClaimClipReportNotifyCooldown(
    uploaderPlayerId: string,
    ttlSeconds: number = CLIP_REPORT_NOTIFY_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      clipReportNotifyCooldownKey(uploaderPlayerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Same lock shape as tryClaimSessionReissueCooldown/
   * tryClaimContactChangeCooldown, for AccountErasureService's
   * request-erasure endpoint (ADR-0013 Decision 3). Bounds burst rate
   * only — see tryClaimErasureRequestDailyCap for sustained-volume
   * protection. */
  async tryClaimErasureRequestCooldown(
    playerId: string,
    ttlSeconds: number = ERASURE_REQUEST_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      erasureRequestCooldownKey(playerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Same fixed-window shape as tryClaimContactChangeDailyCap/
   * tryClaimSessionReissueDailyCap — the burst cooldown above alone still
   * allows a couple hundred forced-erasure-email sends per day. */
  async tryClaimErasureRequestDailyCap(
    playerId: string,
    maxPerWindow: number = ERASURE_REQUEST_DAILY_CAP_MAX_PER_WINDOW,
    windowSeconds: number = ERASURE_REQUEST_DAILY_CAP_WINDOW_SECONDS,
  ): Promise<boolean> {
    const key = erasureRequestDailyCapKey(playerId);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= maxPerWindow;
  }

  /**
   * docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A2 — stores the
   * not-yet-redeemed PT team-invite code's payload, 24h TTL, keyed by the
   * code itself (already a high-entropy, single-use human code — see
   * generateHumanCode). `NX` here is a defensive belt-and-braces check
   * only (a fresh random code colliding with a still-live one is
   * astronomically unlikely, same reasoning as every other
   * generateHumanCode call site in this app); a collision fails loudly
   * rather than silently overwriting someone else's still-valid invite.
   */
  async storePtTeamLinkInviteCode(
    code: string,
    payload: { teamId: string; invitedByPlayerId: string },
    ttlSeconds: number = PT_TEAM_LINK_INVITE_TTL_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      ptTeamLinkInviteKey(code),
      JSON.stringify(payload),
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /**
   * Atomic get-and-delete (Redis GETDEL, ioredis 5.11+/Redis 7+ — see
   * docker-compose.yml/k8s/redis-deployment.yaml's `redis:7-alpine`) so a
   * code can only ever be redeemed once, even under concurrent redemption
   * attempts — no separate "check then delete" race window. Returns
   * `null` for "no such code" and "already redeemed/expired" alike,
   * deliberately not distinguished (same generic-error posture as every
   * other mailed/shared-code lookup in this app).
   */
  async redeemPtTeamLinkInviteCode(
    code: string,
  ): Promise<{ teamId: string; invitedByPlayerId: string } | null> {
    const raw = await this.client.getdel(ptTeamLinkInviteKey(code));
    if (!raw) return null;
    return JSON.parse(raw) as { teamId: string; invitedByPlayerId: string };
  }

  /** Same lock shape as tryClaimErasureRequestCooldown, for
   * PtConsentService's consent-request endpoint (ADR-0023 Decision A3).
   * Bounds burst rate only — see tryClaimPtConsentRequestDailyCap for
   * sustained-volume protection. */
  async tryClaimPtConsentRequestCooldown(
    ptStaffAccountId: string,
    ttlSeconds: number = PT_CONSENT_REQUEST_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      ptConsentRequestCooldownKey(ptStaffAccountId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Same fixed-window shape as tryClaimErasureRequestDailyCap — the burst
   * cooldown above alone still allows a couple hundred forced-consent-
   * request-email sends per day for one PT account. */
  async tryClaimPtConsentRequestDailyCap(
    ptStaffAccountId: string,
    maxPerWindow: number = PT_CONSENT_REQUEST_DAILY_CAP_MAX_PER_WINDOW,
    windowSeconds: number = PT_CONSENT_REQUEST_DAILY_CAP_WINDOW_SECONDS,
  ): Promise<boolean> {
    const key = ptConsentRequestDailyCapKey(ptStaffAccountId);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= maxPerWindow;
  }

  /** Same lock shape as tryClaimErasureRequestCooldown, for
   * BugReportsService's submission endpoint (ADR-0022 Decision 7). Bounds
   * burst rate only — see tryClaimBugReportDailyCap for sustained-volume
   * protection. Lives in Redis, not in-process memory, for the same reason
   * every other limiter in this file does: with k8s/api-deployment.yaml
   * running multiple replicas, a per-pod counter would multiply the real
   * ceiling by the replica count. */
  async tryClaimBugReportCooldown(
    playerId: string,
    ttlSeconds: number = BUG_REPORT_COOLDOWN_SECONDS,
  ): Promise<boolean> {
    const result = await this.client.set(
      bugReportCooldownKey(playerId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /** Same fixed-window shape as tryClaimErasureRequestDailyCap — the burst
   * cooldown above alone would still allow ~1,440 rows per player per day
   * into the operator's triage queue. */
  async tryClaimBugReportDailyCap(
    playerId: string,
    maxPerWindow: number = BUG_REPORT_DAILY_CAP_MAX_PER_WINDOW,
    windowSeconds: number = BUG_REPORT_DAILY_CAP_WINDOW_SECONDS,
  ): Promise<boolean> {
    const key = bugReportDailyCapKey(playerId);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= maxPerWindow;
  }

  /**
   * Non-blocking try-lock for a cross-pod `@Cron` tick (see
   * scheduledJobRunKey's comment above) — the same `SET key value EX
   * ttlSeconds NX` shape as every other tryClaim.../storePtTeamLinkInviteCode
   * call in this file, just generic over an arbitrary `jobName` instead of
   * a per-entity id. Returns `true` if THIS call won the claim (i.e. this
   * replica should run the job this tick), `false` if another replica
   * already claimed it — the caller should skip the run entirely, not wait
   * or retry, since the job that "lost" the race has nothing useful left
   * to do once the winner runs it. `ttlSeconds` should comfortably outlast
   * how long the job could plausibly take (so a slow run never gets
   * duplicated by the next tick) while staying short enough that a pod
   * crashing mid-run doesn't wedge the *next* tick's claim for long — see
   * each call site for the specific value chosen and why.
   */
  async tryClaimScheduledJobRun(
    jobName: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.client.set(
      scheduledJobRunKey(jobName),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /**
   * docs/adr/0013-account-erasure.md Decision 6 — sorted-set entries don't
   * expire on their own, so a deleted player's streak would otherwise show
   * teammates a frozen "ghost" score indefinitely. Every other Redis key
   * touching this player (rate-limit/cooldown claims) is deliberately left
   * alone — harmless, they expire on their own short TTLs regardless.
   */
  async removeFromLeaderboard(teamId: string, playerId: string): Promise<void> {
    await this.client.zrem(teamStreakLeaderboardKey(teamId), playerId);
  }

  /**
   * Backs `RedisThrottlerStorage` (`common/throttler/`), which plugs into
   * `@nestjs/throttler` as its `ThrottlerStorage` in place of the library's
   * default in-memory Map. Same fixed-window INCR+EXPIRE-on-first-hit shape
   * as the chat-send/clip-upload allowances above, just keyed generically
   * (the throttler library owns key construction) and returning the raw
   * count/remaining-TTL pair that `ThrottlerStorageRecord` needs, rather
   * than a boolean, since the guard itself decides pass/block from these.
   * Not a Lua script/atomic transaction, same as this file's other counters
   * — a rare race only ever loses a fraction of a request from the ceiling
   * on a single window, never breaks the block itself.
   */
  async throttlerIncrement(
    key: string,
    ttlMilliseconds: number,
  ): Promise<{ totalHits: number; ttlMillisecondsRemaining: number }> {
    const totalHits = await this.client.incr(key);
    if (totalHits === 1) {
      await this.client.pexpire(key, ttlMilliseconds);
    }
    const ttlMillisecondsRemaining = await this.client.pttl(key);
    return {
      totalHits,
      // A key can in principle have no TTL (e.g. NX SET raced with a
      // concurrent expiry) — fall back to the full window rather than a
      // negative/absent value confusing the caller's "seconds remaining".
      ttlMillisecondsRemaining:
        ttlMillisecondsRemaining > 0
          ? ttlMillisecondsRemaining
          : ttlMilliseconds,
    };
  }

  /**
   * Deletes a scheduled `@Cron` job's non-blocking try-lock (see
   * tryClaimScheduledJobRun/scheduledJobRunKey above), so the next
   * tryClaimScheduledJobRun call for that job succeeds immediately instead
   * of waiting out its TTL. Test-only in practice today —
   * phase4.2-account-erasure.e2e-spec.ts's `beforeEach` calls this between
   * `it()` blocks that call AccountErasureSweepService.sweep() directly and
   * repeatedly within the same process/Redis connection, where the real
   * SCHEDULED_JOB_LOCK_TTL_SECONDS (5 minutes) would otherwise make every
   * sweep() after the first in that file silently no-op for the rest of the
   * run. Deliberately a single key DEL, not a full flushdb, so it doesn't
   * disturb other Redis state (rate limits, leaderboards, idempotency keys)
   * the same test file's other assertions may depend on.
   */
  async deleteScheduledJobRunLock(jobName: string): Promise<void> {
    await this.client.del(scheduledJobRunKey(jobName));
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }
}
