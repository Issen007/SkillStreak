# Avatar art

23 characters sliced from `temp/images/avatar.png` (the project owner's
sample sheet), backgrounds normalised to white.

**Re-sliced 2026-08-18 by `reslice-avatars.mjs` in this directory.** The
first pass wrote 512×512 files from source tiles roughly 340px wide — an
upscale — which the app then downscaled again to 256. That round trip
invented detail and then averaged it away. These are now cropped once at
native resolution and downsampled exactly once, and cropped to the
character rather than to the card, so the subject fills materially more
of the frame (panda 34% → 51%, hare 25% → 38%).

Sizes: this directory keeps the native crop (~340px, full colour, the
archival intermediate). `mobile/assets/avatars/` gets 256×256 quantised
to 192 colours, which made the shipped bundle *smaller* than before the
re-slice (1.30 MB → 0.93 MB) despite carrying more detail.

## What these are

Sports-playing animal characters, one per tile of the original 6×4 sheet.
The grid was detected by colour-saturation clustering rather than
hand-measured, so the crops are centred on each character rather than on
an assumed pitch.

## Why 23 and not 24

The owl tile was rendered in the sheet's *selected* state — a peach
highlight card instead of the white one every other tile has. Removing
that background cleanly is not safely automatable: the peach is close
enough to the owl's own tan plumage that a colour-range replace risks
eating the character. Shipping 23 consistent avatars beats shipping 24
where one is visibly different or damaged.

If the owl matters, the fix is a fresh render of that one tile in the
normal state — not pixel surgery on this one.

## Compatibility warning — read before wiring these in

`AVATAR_CATALOG` currently ships 12 ids, and **players already have one of
them stored on their account**:

```
fox wolf owl lion bear eagle tiger shark dragon panda unicorn robot
```

Three have no matching art here: **owl** (excluded, above), **shark** (the
sheet has a dolphin, which is not the same animal) and **robot** (the sheet
has a human racing driver). Mapping `shark → dolphin.png` or
`robot → racer.png` would silently change what an existing player's avatar
*is*, which is not a rendering detail — it is their identity in the app.

So the catalog must keep those three ids working. The intended shape is an
optional `image` per entry, with the existing `emoji` staying as the
fallback for ids that have no art, plus the 14 genuinely new characters
added as new choices:

```
dolphin racer moose hare swan lynx gorilla cheetah
kangaroo otter raccoon seal badger horse
```

That takes the catalog from 12 to 26 options, breaks nobody, and leaves
owl/shark/robot on emoji until art exists for them.

## Remaining work to actually use these

`AVATAR_CATALOG` is referenced in 17 files across 34 call sites, all
following the same shape:

```ts
const emoji = AVATAR_CATALOG.find((a) => a.avatarId === id)?.emoji ?? '🙂';
// ...later
<Text style={styles.x}>{emoji}</Text>
```

A `<Text>` cannot render an image, so every one of those sites needs to
become a shared `<Avatar avatarId={...} size={...} />` that renders the
PNG when present and falls back to the emoji when not. That is a
mechanical but wide change, and doing it partially would leave the app
showing photos on some screens and emoji on others for the same player —
worse than either alone. It should land as one change.
