// Color tokens from docs/design/style-guide.md (v1, Phase 0.5).
//
// Contrast rule to keep in mind: `flame` and `gold` are for fills
// (buttons, meters, badges, icons) only — never as text color on
// `paper`/`white`, both fail WCAG AA at normal text sizes.
export const colors = {
  /** Individual streak motif — "mine". Fills only, not text on light bg. */
  flame: '#FF6B35',
  /** Team "VM-Guld" motif — "ours". Fills only, not text on light bg. */
  gold: '#FFB800',
  /** Body/heading text on light backgrounds; also a "night court" fill. */
  ink: '#1B1B3A',
  /** Default screen background. */
  paper: '#FAFAF7',
  /** Confirmation states only (e.g. "logged today"). */
  success: '#3DAA6B',
  /** Text/icons on top of saturated flame/gold/ink fills. */
  white: '#FFFFFF',
} as const;
