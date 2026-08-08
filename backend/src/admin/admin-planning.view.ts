import { PlanningDocSection } from './admin-planning-docs.service';

export interface AdminPlanningResponse {
  sections: PlanningDocSection[];
  /**
   * The OLDEST `syncedAt` across the sections actually present, so §7.6's
   * staleness banner reflects the stalest thing on screen rather than the
   * freshest. Null when nothing is mounted at all — which the console
   * renders as "not configured", distinct from "configured but old".
   */
  syncedAt: string | null;
}

/**
 * Shapes ADR-0022 Decision 10's planning responses. Kept as a pure mapper
 * beside the controller — same posture as admin-usage-metrics.view.ts —
 * so what leaves the API is decided in one readable place rather than
 * inline in a route handler.
 */
export function toPlanningResponse(
  sections: PlanningDocSection[],
): AdminPlanningResponse {
  const timestamps = sections
    .map((section) => section.syncedAt)
    .filter((value): value is string => value !== null);

  return {
    sections,
    syncedAt:
      timestamps.length === 0
        ? null
        : timestamps.reduce((oldest, value) =>
            value < oldest ? value : oldest,
          ),
  };
}
