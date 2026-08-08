import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';

/**
 * The four keys `admin-planning-docs` carries, per ADR-0022 Decision 10 as
 * amended 2026-08-07. These are a closed set on purpose: the reader below
 * never takes a caller-supplied filename, never lists the directory, and
 * never joins anything a request could influence, so there is no traversal
 * surface to defend in the first place.
 */
export const PLANNING_DOC_FILES = {
  roadmapPlan: 'action-plan-next-up.md',
  roadmapProject: 'project-roadmap.md',
  ideas: 'backlog.md',
  securityIssues: 'security-issues.md',
} as const;

export type PlanningDocKey = keyof typeof PLANNING_DOC_FILES;

export interface PlanningDocSection {
  /** Which curated file this half came from, for §7.2's source label. */
  source: PlanningDocKey;
  /** Raw markdown. Rendering — including any escaping — is the caller's. */
  content: string;
  /**
   * The file's mtime. §13 asked for this so §7.6 can warn when a
   * hand-applied ConfigMap has gone stale; null when the file is absent.
   */
  syncedAt: string | null;
  /** False when the key isn't mounted — an empty section, not an error. */
  available: boolean;
}

// A curated slice, not a whole document. ACTION_PLAN.md alone was 272 KB
// when Decision 10 was amended, against a 1 MiB ConfigMap cap that
// `kubectl apply`'s last-applied-configuration annotation effectively
// halves. This ceiling exists so an over-large paste fails here, in a
// logged and visible way, rather than at the project owner's manual
// `kubectl apply` step where nothing is watching.
const MAX_DOC_BYTES = 256 * 1024;

/**
 * Reads ADR-0022 Decision 10's planning content from the
 * `admin-planning-docs` ConfigMap volume.
 *
 * **The mount path must stay disjoint from every statically-served
 * directory in this app** — never an ancestor, never a descendant. That is
 * the security-reviewer's required 2026-08-02 fix, and it is structural:
 * if the volume ever sits inside a static root, these files become
 * downloadable by an unauthenticated GET that never passes AdminAuthGuard
 * or the step-up check at all. This service is the only code permitted to
 * read that directory, and it is reachable only from the three gated
 * controller endpoints.
 */
@Injectable()
export class AdminPlanningDocsService {
  private readonly logger = new Logger(AdminPlanningDocsService.name);

  constructor(private readonly configService: ConfigService) {}

  async read(key: PlanningDocKey): Promise<PlanningDocSection> {
    const dir = this.docsDir();
    if (!dir) {
      return { source: key, content: '', syncedAt: null, available: false };
    }

    const path = join(dir, PLANNING_DOC_FILES[key]);
    try {
      const stats = await stat(path);
      if (stats.size > MAX_DOC_BYTES) {
        // Surfaced as an unavailable section rather than a 500: one
        // oversized file must not take the whole view down, and the
        // operator needs to see which key is the problem.
        this.logger.warn(
          `Planning doc "${PLANNING_DOC_FILES[key]}" is ${stats.size} bytes, over the ${MAX_DOC_BYTES}-byte limit — ship a curated slice, not the whole file. Serving it as unavailable.`,
        );
        return { source: key, content: '', syncedAt: null, available: false };
      }
      const content = await readFile(path, 'utf8');
      return {
        source: key,
        content,
        syncedAt: stats.mtime.toISOString(),
        available: true,
      };
    } catch {
      // An absent key is the normal state on a cluster where the ConfigMap
      // hasn't been applied yet — not an error, and deliberately not
      // distinguished from an unreadable one in the response.
      return { source: key, content: '', syncedAt: null, available: false };
    }
  }

  /**
   * Absent config means the whole pillar reports itself unavailable rather
   * than crashing the app on boot — same posture as the Fas 5 usage-report
   * knobs, and for the same reason: an unset optional operational path
   * must never crash-loop the API.
   */
  private docsDir(): string | null {
    const raw = this.configService.get<string>('ADMIN_PLANNING_DOCS_DIR');
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  }
}
