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

  // --- Supplementary neutrals (Phase 1) --------------------------------
  // Not fixed by style-guide.md's token table, but needed for real screens
  // (borders, muted secondary text, waiting/paused banner fills). Kept
  // separate from the six named tokens above so that table stays the
  // single source of truth for the "protected" brand colors; these are
  // just plumbing to render the phase1-mockup.html reference faithfully.
  /** Muted secondary text (labels, helper copy) on paper/white. */
  textMuted: '#6B6B85',
  /** Slightly darker muted body text used in onboarding form copy. */
  textBody: '#47455C',
  /** Default hairline border on paper/white cards and inputs. */
  border: '#E3DED2',
  /** "Waiting for consent" banner fill + border (pending/not_requested). */
  pendingBg: '#FFF4E8',
  pendingBorder: '#FFD9A8',
  /** "Paused" banner fill + border (revoked consent). */
  pausedBg: '#F2EFF8',
  pausedBorder: '#D8D0EC',
  /** Disabled CTA fill + text (e.g. locked "Jag har tränat" button). */
  disabledBg: '#DAD6CB',
  disabledText: '#8F8C9E',
  /** Selected-avatar highlight fill, paired with `flame` border. */
  flameTint: '#FFEFE7',
  /** Inline validation/error copy (e.g. "invite code not found"). Not
   * `flame` — style-guide.md's contrast rule reserves flame for fills
   * only, never as a text color on paper/white. */
  error: '#C1432F',
  /** A darker gold-family tone usable as *text* on white (e.g. the team
   * pool's "1 280 / 5 000" figure) — distinct from `gold` itself, which
   * stays fill-only per the contrast rule. */
  goldText: '#B37B00',
  /** Fas 2.7 — VM-Guld-tabellen's (Screen LB2) own-team row highlight fill
   * + border, matching docs/design/phase2.6-2.7-mockup.html's `.lb-row.me`
   * exactly. A light gold tint, distinct from the saturated `gold` fill
   * token, so a highlighted row reads as "this one" without competing with
   * an actual gold-filled element on the same screen. */
  goldRowTint: '#FFF7E0',
  goldRowBorder: '#FFD873',
  /** Self-service team creation (2026-07-09 update) — the non-alarming
   * "💡 tip" row fill + border used at Screen O1c's permanence warning,
   * matching `docs/design/phase1-mockup.html`'s `.tip-row` exactly.
   * Deliberately its own warm-neutral token, not reused from
   * `pendingBg`/`pendingBorder` (those are semantically "waiting for
   * consent", a different concept). */
  tipBg: '#FFF8E8',
  tipBorder: '#FFE7A8',
} as const;
