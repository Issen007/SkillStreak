# SkillStreak — Style Guide (v1, Phase 0.5)

A small, opinionated starting point — not a full design system. Revisit once
real screens in Phase 1 put pressure on it.

## Colors

| Token | Hex | Use |
|---|---|---|
| `flame` (primary) | `#FF6B35` | The individual streak motif — streak counter, "days in a row" flame icon, primary CTA button background ("Jag har tränat"). |
| `gold` (secondary) | `#FFB800` | The team "VM-Guld" motif — team pool meter fill, badges, anything shared/team-level. Keeps individual (flame) and team (gold) progress visually distinct at a glance. |
| `ink` (text/dark) | `#1B1B3A` | Body text, headings, icons on light backgrounds. Deep navy rather than pure black — softer, and doubles as a "night court" background for hero/splash sections. |
| `paper` (background) | `#FAFAF7` | Default screen background. Warm off-white, not clinical white — easier on the eyes for a screen kids look at daily. |
| `success` | `#3DAA6B` | Confirmation states only (e.g. "logged today") — used sparingly so it doesn't compete with flame/gold. |
| `white` | `#FFFFFF` | Text/icons on top of saturated flame/gold/ink backgrounds. |

### Contrast rules (WCAG AA)

- **Never set `flame` or `gold` as text color on `paper`/`white`** — both fail
  AA at normal text sizes (too light). They're for *fills* (buttons, meters,
  badges, icons), not body text.
- Body/heading text is always `ink` on `paper`/`white`, or `white` on
  `flame`/`gold`/`ink` fills — both combinations pass AA comfortably.
- Buttons: solid `flame` or `gold` fill with `white` text, not the reverse.

## Fonts

- **Headings:** [Baloo 2](https://fonts.google.com/specimen/Baloo+2) — a
  rounded, friendly display font that reads as playful without being
  childish-cartoonish; available via `@expo-google-fonts/baloo-2`.
- **Body:** [Nunito](https://fonts.google.com/specimen/Nunito) — high
  legibility at small sizes, rounded terminals that pair naturally with
  Baloo 2, available via `@expo-google-fonts/nunito`.
- Both are variable/weighted families — use Baloo 2 SemiBold+ for headings
  and Nunito Regular/Bold for body/labels.

## Usage notes

- **Streak (individual) vs. team pool** should always be visually
  distinguishable by color, not just label: flame-colored elements are
  "mine", gold-colored elements are "ours". Don't reuse gold for individual
  streak UI or vice versa — that's the one rule worth protecting as the app
  grows past Phase 0.5.
- Keep touch targets large and copy short — this is a phone screen used by
  9-13 year-olds, often mid-training, not a desktop dashboard.
- Product copy is Swedish per CLAUDE.md; this guide's tokens/values are
  language-independent.
