/** Clips are recorded portrait (9:16, per docs/design/phase3-flows.md).
 * Shared across every "show a clip's video/thumbnail at its native shape"
 * call site added since the grid+modal rework
 * (docs/design/clip-library-grid.md §4's "small worthwhile refactor" note)
 * — `ClipGridCell` and `ClipPlayerModal` both use this, so a future change
 * to the ratio only needs to happen in one place.
 *
 * `ClipCard.videoArea` and `V5CaptionChallenge.previewWrap` predate this
 * constant and still inline the same `9 / 16` literal with their own
 * near-identical comments — left as-is (the design doc calls the
 * extraction "worth doing... not blocking this change on it," and this
 * task was separately told to leave `ClipCard` unmodified) rather than
 * touching components outside this change's scope.
 */
export const CLIP_ASPECT_RATIO = 9 / 16;
