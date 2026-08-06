# Clip library layout — dense grid + modal player

Scope: a **layout-only** revision of Screen V2 (the "Klipp"/Shorts tab feed,
`docs/design/phase3-flows.md`), raised by the project owner 2026-08-05
(`docs/BACKLOG.md` "Clip library layout" entry): replace the current
one-clip-per-row vertical feed with a dense thumbnail grid, moving playback
into a tap-to-open modal/full-screen player. No backend change, no new
privacy surface — every consent gate, report/delete/block flow, and
closed-team-bubble rule from `phase3-flows.md` carries over unchanged, just
re-plumbed to a different visual container. Written for
**frontend-developer** to implement directly against
`mobile/src/clips/ClipsScreen.tsx` and
`mobile/src/clips/components/ClipCard.tsx` — not a rewrite of either.

**Read first:** `mobile/src/clips/components/ClipCard.tsx` (today's one
card = one full clip), `mobile/src/clips/ClipsScreen.tsx` (owns all the
state this grid/modal split needs to keep working — `revealedClipId`,
`reportTarget`, `deleteTarget`, `blockTarget`, `hasMore`/pagination),
`mobile/src/chat/components/PausedClipThumbnail.tsx` (the existing "no
thumbnail asset exists — just render an unplayed `VideoView` at frame 0"
technique, already proven at two other call sites), and the `aspectRatio:
9/16` fix in `ClipCard.videoArea` / `V5CaptionChallenge.previewWrap`
(2026-08-04) that this design must extend, not re-diverge from.

---

## 1. Grid — Screen V2 (revised), "Klippgalleriet"

**Replaces** the current `styles.list` vertical card stack
(`ClipsScreen.tsx` lines ~409–424) with a 3-column, flex-wrap grid of
compact thumbnails. Same data source, same pagination button, same empty/
loading/error states — only the `clips.map(...)` body and its container
style change.

**Column count: fixed 3, on phone width *and* the 480px-capped web
column** (`AppRoot.tsx`'s `webColumn.maxWidth: 480`). Considered 4 for
extra density, rejected for a first pass: at typical phone widths a
4-column cell drops under ~90pt wide, which starts to feel like scanning
icons rather than recognizable video frames for a 9–13-year-old audience;
3 already delivers the "see most of the screen at once" goal (see the row
math below) without that legibility cost. Not responsive/breakpointed —
3 stays fixed down to the narrowest realistic device width (iPhone SE-class,
320pt) and up through the 480px web cap; do the math below, it never gets
uncomfortably small.

**Exact values** (reuses `ClipsScreen`'s existing `content` container,
`paddingHorizontal: 20` — unchanged):

- Grid container: `flexDirection: 'row'`, `flexWrap: 'wrap'`, `gap: 8`
  (RN's `gap` shorthand covers both row and column spacing — no separate
  `rowGap`/`columnGap` needed).
- Cell width: `(availableWidth - 2*8) / 3`, where `availableWidth =
  screenWidth - 40` (the existing 20+20 horizontal padding). Concretely:
  - 320pt-wide phone → cell ≈ 88pt wide × 156pt tall.
  - 375pt (iPhone mini/SE) → cell ≈ 106pt × 188pt.
  - 428pt (Pro Max) → cell ≈ 124pt × 220pt.
  - 480px web cap → cell ≈ 141pt × 251pt.
  All comfortably clear the ~44pt minimum tap target — the whole cell is
  the tap target, not a small icon inside it.
- Cell aspect ratio: **`aspectRatio: 9/16`**, same token as
  `ClipCard.videoArea` — never a fixed height. This is the one rule this
  whole task exists to protect: don't reintroduce a cropped/mismatched box
  at a smaller size.
- Cell corner radius: `10` (scaled down from the card's `14`/`18` — a
  smaller shape reads better with a proportionally smaller radius).
- Cell background: `colors.ink` (matches `ClipCard.videoArea` — the frame
  behind a still-loading or transparent video source).

**Expected outcome, worth stating explicitly since it's the whole point of
the ask:** on a ~700pt-tall visible content area, a 188pt-tall row + 8pt
gap ≈ 196pt/row → **~3 rows × 3 columns = 9 clips visible without
scrolling**, versus roughly 1 (and a sliver of a second) full-width card
today.

### What's on the cell itself (design point 3 and 5)

**Static poster frame only — no autoplay preview in the grid, for this
pass.** Reuse `PausedClipThumbnail` (`mobile/src/chat/components/
PausedClipThumbnail.tsx`) verbatim inside the cell's aspect-ratio wrapper —
it already does exactly "mount a `VideoView`, never call `.play()`, so it
renders frame 0, muted" for CH6's picker grid and CH1's compose chip; this
is the third call site of the identical technique, not a new one.

Checked per the task's instruction: `ClipCard` **does not autoplay in the
feed today either** — it mounts paused (`isPlaying` starts `false`) and
requires an explicit tap. So "no autoplay in the grid" isn't a new
restriction, it's the same existing posture extended to more
simultaneously-visible cells. Don't add autoplay-on-visible-cell (TikTok-
grid-style) in this pass: going from ~2 concurrently-mounted video decoders
(today's feed) to potentially 9+ visible grid cells autoplaying at once is
a real battery/data cost on a phone, and it cuts against this app's
deliberate "calm, not addictive" posture (CLAUDE.md: no infinite-scroll-
style attention hooks). **Flag as a possible follow-up only**, and if
pursued later, cap it to the single cell nearest screen-center (not every
visible cell) rather than reproducing TikTok's full autoplay-grid behavior.

Because the grid cell carries no visible text (deliberately — see below),
add a **permanent, always-on centered play icon** (▶, `rgba(255,255,255,
0.85)`, ~20pt, `pointerEvents: 'none'`) so a frozen frame still reads as
"tap to watch a video" rather than a plain photo. This differs from
`ClipCard`'s play icon, which only shows conditionally while paused —
here it's unconditional, since a grid cell is never "playing."

**Metadata — mostly moves to the modal, not the grid cell:**

- **No like/reaction count exists anywhere in this codebase today**
  (`ClipFeedItem`/`ClipCard` carry no such field) — nothing to relocate on
  that front, just noting it since the task asked to check.
- **Screen name + timestamp + caption: drop from the cell entirely**,
  shown in the modal only. A 106–141pt-wide cell can't fit a screen name
  without truncation, and truncation behavior varies badly across this
  app's 8 locales' different string lengths (i18n concern the task called
  out) — better to show no text than inconsistently-cut text.
- **Uploader avatar: keep, as an icon-only corner badge, not
  name+avatar.** Small circle (22pt), same `avatarCircle`/emoji treatment
  as `ClipCard`'s header but smaller, bottom-left corner (`bottom: 6, left:
  6`), with a 1.5pt white ring so it stays legible against an arbitrary
  video frame behind it (unlike the card's header row, which sits on a
  solid white background). Non-interactive on the cell itself — tapping
  anywhere on the cell opens the modal; the existing "tap avatar → CH4 'Om
  {screenName}' sheet" interaction moves into the modal, same as the card's
  zone-1 rule (never rendered as tappable on your own clip).
- **Challenge chip ("🎯 Utmanar {name}"): keep, as an icon-only corner
  badge**, not the full-text pill — same reasoning as above (no room for
  text, i18n string-length risk). Small circular badge, top-left (`top: 6,
  left: 6`), `rgba(0,0,0,0.45)` fill (matches the existing mute-button
  treatment), just the 🎯 emoji, shown whenever `clip.taggedPlayerId` is
  non-null. Full "Utmanar {screenName}" text moves to the modal.
- **Report/delete tap-to-reveal action: modal only.** There's no room for
  a third tap zone in a ~106pt cell, and the whole point of the grid is
  fast browsing — burying a destructive action behind a tiny corner tap
  target would be an accessibility regression, not a win.

---

## 2. Tap-to-open — a new full-screen modal player

**New component**, `mobile/src/clips/components/ClipPlayerModal.tsx` — not
a reuse of `ClipCard` (its white-card chrome, border, and three-zone
header don't apply full-screen on a dark background), but it **does reuse
the exact `aspectRatio: 9/16` video-container treatment** and inherits the
same props/handlers `ClipsScreen` already threads through `ClipCard`
today: `clip`, `isOwn`, `revealed`, `onTapAvatar`, `onTapMeta`,
`onTapReport`, `onTapDelete`. No new state model needed in `ClipsScreen`
beyond one addition: `activeClip: ClipFeedItem | null` (same "`null` =
closed" convention `reportTarget`/`deleteTarget`/`blockTarget` already
use), set on grid-cell tap, cleared on close.

**Structure, top to bottom:**

1. Full-screen `Modal` (`transparent={false}`, `animationType="fade"`,
   `onRequestClose={onClose}` — same RN `Modal` primitive
   `ClipDeleteSheet`/`BlockSheet` already use, just full-screen instead of
   a bottom sheet). Background `colors.ink` — the app's existing "night
   court" dark token (style-guide.md already names this exact use), not a
   new near-black value.
2. **Close button** — top-right, `top: 16 + safe-area-inset, right: 16`,
   40×40 circle, `rgba(0,0,0,0.5)` fill, white "✕" (~18pt), `hitSlop: 8`
   on all sides. **Primary close affordance.**
3. **Video container**, centered: same `aspectRatio: 9/16` box as the
   grid/card, `width: '100%'`, `maxWidth: min(480, screenWidth)`,
   `maxHeight: '100%'`, letterboxed on whichever dimension is the binding
   constraint. Tap = play/pause (same zone-2 rule as `ClipCard`), speaker
   icon in the corner = mute toggle (same control, same default-muted
   rule).
4. **Meta block below the video** (not overlaid on it) — deliberately: the
   existing V2 flow doc's "the video area is the one zone reserved purely
   for watching" rule holds here too, and overlaying text on an arbitrary
   video frame risks illegibility that a fixed dark strip below doesn't.
   Same content/handlers as `ClipCard`'s header row + chip + metaZone +
   actionRow, restyled for the dark background (light text instead of ink-
   on-white): avatar+screen name (tappable → CH4, unless own clip),
   challenge chip with full text, caption, relative timestamp, and the
   tap-to-reveal "⋯" → report (teammate) / delete (own) row. If this block
   plus a long caption exceeds the screen, it scrolls independently — the
   video itself stays put, non-scrolling.

**Close interaction — primary + fallback, no swipe:**

- **Primary: the X button** (above).
- **Fallback: tap outside** the video/meta content, on visible backdrop —
  same `Pressable` backdrop pattern `ClipDeleteSheet`/`BlockSheet` already
  use (`onPress={onClose}`). Works best on web/wide screens where there's
  real backdrop area; on a phone where the 9:16 video nearly fills the
  screen height there's little backdrop to tap, which is fine — the X and
  the OS back gesture (below) remain reliable.
- **Implicit third path: OS back button/gesture** on Android via
  `Modal`'s existing `onRequestClose` — already this app's convention on
  every other sheet, extended here for free.
- **Swipe-down-to-dismiss: explicitly out of scope for this pass.** Not
  ruled out for good — TikTok-style swipe-dismiss is a nice touch — but
  nothing in this codebase uses gesture-driven animation yet (no
  `react-native-gesture-handler`/`react-native-reanimated` dependency
  today), and the X + tap-outside + back-gesture trio already fully covers
  "close the video." Note as a fast-follow, and if built, prefer RN core's
  built-in `PanResponder` over adding a new gesture library, to avoid
  growing this app's dependency footprint for one interaction.

**Swipe to next/previous clip: also out of scope for this pass**, per the
task's own framing of it as nice-to-have. The grid is one tap away behind
the modal, so "close, tap the next thumbnail" is an acceptable v1 flow;
revisit only if real usage shows people specifically wanting continuous
playback.

**Web-specific judgment call, flag for frontend-developer to verify:**
RN Web's `Modal` typically portals its content to the document body, i.e.
*outside* `AppRoot.tsx`'s `webColumn` `maxWidth: 480` wrapper. Left
unhandled, that means the modal's dark backdrop legitimately filling the
full (possibly much wider) browser viewport is fine — lightboxes commonly
do this — but the **video + meta block inside it must still be explicitly
capped** (`maxWidth: 480, alignSelf: 'center'`) so the actual player stays
inside the same visual column as the rest of the app, rather than
stretching edge-to-edge on a wide desktop window. This is exactly the kind
of environment-specific inconsistency CLAUDE.md's "Environment parity"
section warns about — verify it live on web, don't assume the native
behavior (which has no such portal quirk) generalizes.

### States inside the modal

- **Opening → autoplay, muted.** Judgment call, stated explicitly since it
  differs from the grid/feed's no-autoplay posture: tapping a thumbnail is
  already an explicit "play this" gesture (unlike passively scrolling past
  a feed card), so requiring a second redundant tap to start playback once
  the modal is open would be friction, not a safeguard. Still muted by
  default, per the app-wide rule — same speaker-icon toggle as everywhere
  else.
- **Loading** (before the player reports playing): show a spinner
  centered over the video container, `ActivityIndicator color={colors.
  white}` — **not** `colors.ink` (the color `LoadingOrRetry` defaults to
  elsewhere in this app, which assumes a light `paper` background; this
  screen is dark).
- **Playback error** (clip's `playbackUrl` fails — e.g. moderation removed
  it between the grid's fetch and the tap, or a presigned URL expired):
  replace the video container's contents with a small inline state, not
  the full-page `LoadingOrRetry` component (wrong background/weight for a
  small dark box): a muted warning glyph, `v2.playerError` copy (below),
  and a retry action reusing the existing `v2.retry` string. If retry also
  fails or the clip is genuinely gone, offer the close button as the exit
  — no dead-end trap.
- **Closing**: `fade` out (matches the open transition), clears
  `activeClip`.

---

## 3. Copy — new Swedish/English strings needed

Everything else reuses existing `clips.json` keys unchanged (`v2.retry`,
`clipCard.challengeChip`/`report`/`delete`, `v9`/`v10`/`v11`, etc. — the
report/delete/block sheets themselves don't change at all, just what
triggers them). New keys, added under a new `clipPlayerModal` namespace in
`mobile/src/i18n/locales/*/clips.json` (English is the source string set
per this repo's i18n convention; Swedish is the primary product-facing
locale per CLAUDE.md — both below, the other 6 locales get the same
best-effort-AI-then-native-review treatment the rest of the file already
uses):

| Key | Swedish | English |
|---|---|---|
| `clipPlayerModal.close` (accessibility label on the X button — not visible text) | "Stäng" | "Close" |
| `clipPlayerModal.playError` | "Kunde inte spela videon." | "Couldn't play the video." |
| `clipGridCell.a11yLabel` (accessibility label on each cell, since the visible cell carries no text — `{{screenName}}`, `{{timeAgo}}` interpolated) | "Shorts från {{screenName}}, {{timeAgo}}" | "Shorts from {{screenName}}, {{timeAgo}}" |

No new empty/loading/error copy needed for the grid itself — `v2.
emptyHeading`/`emptySub`/`uploadButton`, `v2.loadError`/`retry`, and the
initial `LoadingOrRetry` spinner all carry over unchanged; only their
container changes from a card list to a grid.

---

## 4. Component boundaries — what's new vs. reused

| Component | Status |
|---|---|
| `mobile/src/clips/components/ClipCard.tsx` | **Unchanged.** No longer used by `ClipsScreen`'s main list, but keep it — it's still the right shape if a full-width card view is ever wanted elsewhere (e.g. a future "clip of the day" spot), and deleting it is out of scope for a layout change. |
| `mobile/src/clips/components/ClipGridCell.tsx` (new) | Wraps `PausedClipThumbnail` in the `aspectRatio: 9/16` cell styling above, plus the two corner badges and the permanent play icon. Takes `clip`, `onPress`. |
| `mobile/src/clips/components/ClipGrid.tsx` (new, or inline in `ClipsScreen` — either is fine, mild preference for extraction since `ClipsScreen.tsx` is already ~570 lines) | Flex-wrap layout of `ClipGridCell`s + the existing "Visa fler klipp" button below it. Replaces the `clips.map(...)` block at `ClipsScreen.tsx` lines ~409–424. |
| `mobile/src/clips/components/ClipPlayerModal.tsx` (new) | Full-screen modal player, described in §2. Owns its own `muted`/`isPlaying`/player-error local state, same pattern as `ClipCard` today. |
| `ClipsScreen.tsx` | Add `activeClip: ClipFeedItem \| null` state; grid cell `onPress` sets it, modal's `onClose` clears it; wire the existing `revealedClipId`/`onTapMeta`/`onTapReport`/`onTapDelete`/`onTapAvatar` handlers into the modal instead of the card — the handlers themselves don't change. |

**Small worthwhile refactor, not mandatory:** the `aspectRatio: 9/16`
constant is currently duplicated (with near-identical comments) in
`ClipCard.videoArea` and `V5CaptionChallenge.previewWrap`; this change
adds two more call sites (`ClipGridCell`, `ClipPlayerModal`). Worth
pulling into a single exported constant (e.g. `CLIP_ASPECT_RATIO = 9 / 16`
in a shared `mobile/src/clips/` constants file) so a future change to this
value only needs to happen once — flagging for frontend-developer's
judgment, not blocking this change on it.

---

## 5. Explicit interaction/state checklist (for implementation + QA)

- [ ] Empty grid (no clips yet) — unchanged `v2.emptyHeading`/`emptySub`/
      upload button, no grid rendered.
- [ ] Initial loading — unchanged `LoadingOrRetry` spinner, no grid
      rendered.
- [ ] Load error — unchanged `v2.loadError` + retry, no grid rendered.
- [ ] Populated grid, 3 columns, `aspectRatio: 9/16` cells, no cropping at
      any of: 320pt phone, 428pt phone, 480px web cap.
- [ ] Grid cell: static poster frame (muted, unplayed `VideoView` via
      `PausedClipThumbnail`), permanent play icon, avatar corner badge,
      challenge corner badge only when `taggedPlayerId` is set.
- [ ] Tap cell → modal opens, autoplays muted.
- [ ] Modal: tap video → pause/resume. Tap speaker → mute/unmute.
- [ ] Modal: tap avatar (teammate only) → CH4 "Om {screenName}" sheet,
      modal stays open behind it (same layering `ClipCard` uses today).
- [ ] Modal: tap "⋯"/meta zone → reveals report (teammate) or delete
      (own), never both.
- [ ] Modal: report submitted → same V9/V10 flow, clip removed from the
      grid's local list on success (existing `handleReportSubmit` logic,
      unchanged), modal closes.
- [ ] Modal: delete confirmed → same V11 flow, clip removed from the
      grid's local list (existing `handleDeleteConfirm` logic, unchanged),
      modal closes.
- [ ] Modal: playback error → inline error state + retry, not a dead end.
- [ ] Modal close via X, via tap-outside, via Android back — all three
      land back on the grid in its prior scroll position.
- [ ] "Visa fler klipp" pagination — unchanged behavior, button now sits
      below the grid instead of below the card stack.
- [ ] Web: modal backdrop may fill the full browser viewport, but the
      video/meta content inside stays capped to the same 480px column as
      the rest of the app (verify live — RN Web `Modal` portal behavior,
      see §2's judgment call).
