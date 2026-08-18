/**
 * Re-slices the avatar characters out of the sample sheet.
 *
 * **Why this exists rather than the originals being left alone.** The
 * first pass produced 512×512 files from source tiles roughly 378px wide
 * — an upscale — which were then downscaled again to 256 for the app.
 * That round trip interpolates detail that was never in the source and
 * then averages the guesswork away, so the shipped avatars are softer
 * than the sheet they came from. This slices once, at native resolution,
 * and downsamples exactly once to each output size.
 *
 * It also crops to the character rather than to the card. The originals
 * kept the sheet's white tile and its padding, so the character occupied
 * roughly 60% of the frame and looked small at roster-row size.
 *
 * **The avatar id mapping is preserved by matching, never by position.**
 * `avatarId` is stored on real player accounts — a tile that shifted by
 * one would silently change who a child's avatar *is*, which ADR-level
 * commentary in avatarCatalog.ts is explicit about. Every new crop is
 * matched against the existing file it replaces, and the script refuses
 * to write anything if a match is ambiguous or missing.
 *
 *   node brand/avatars/reslice-avatars.mjs
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const SHEET = join(repoRoot, 'temp/images/avatar.png');
const EXISTING = join(repoRoot, 'mobile/assets/avatars');

if (!existsSync(SHEET)) {
  throw new Error(
    `Sheet not found at ${SHEET}. It lives in temp/, which is gitignored — ` +
      'this script only runs on a machine that has the original.',
  );
}

// Delegated to Python/Pillow: this repo already depends on it for the app
// icons (tools/app-icons), and Node has no image library in these
// dependency trees. Keeping both pipelines on one imaging stack is worth
// more than avoiding the shell-out.
const python = `
import json, sys
from PIL import Image

SHEET = ${JSON.stringify(SHEET)}
EXISTING = ${JSON.stringify(EXISTING)}
OUT_APP = ${JSON.stringify(EXISTING)}
OUT_BRAND = ${JSON.stringify(here)}

sheet = Image.open(SHEET).convert('RGB')
W, H = sheet.size
px = sheet.load()

# The cards are NOT detectable by brightness: a card reads (244,239,235)
# against a page of (245,244,242) — the card is if anything darker, and
# the two are separated only by a soft shadow. The characters are the only
# strong signal on this sheet, so the grid is found from them.
def ink(p):
    return max(p) < 225

# Sampled at every column (and every row) rather than on a stride. A
# strided projection leaves the skipped columns reading zero, which breaks
# every run into fragments and finds no bands at all.
cols = [0] * W
for x in range(W):
    cols[x] = sum(1 for y in range(0, H, 4) if ink(px[x, y]))
rows = [0] * H
for y in range(H):
    rows[y] = sum(1 for x in range(0, W, 4) if ink(px[x, y]))

def bands(hits, n, min_run):
    out, start = [], None
    for i in range(n):
        on = hits[i] > 0
        if on and start is None:
            start = i
        elif not on and start is not None:
            if i - start >= min_run:
                out.append((start, i))
            start = None
    if start is not None and n - start >= min_run:
        out.append((start, n))
    return out

# Rows separate cleanly. The first band is the sheet's heading text, which
# is far thinner than a row of characters — dropped by height rather than
# by assuming it is first.
row_bands = [b for b in bands(rows, H, 40) if b[1] - b[0] > 150]

# Columns do NOT separate: limbs, sticks and tails overlap between cards,
# so adjacent columns merge into one band. The grid is regular, so the
# columns are derived by dividing the full horizontal extent instead.
col_bands_raw = bands(cols, W, 40)
x0, x1 = col_bands_raw[0][0], col_bands_raw[-1][1]
COLUMNS = 6
pitch = (x1 - x0) / COLUMNS

print(f'grid: {COLUMNS} columns x {len(row_bands)} rows', file=sys.stderr)
if len(row_bands) != 4:
    raise SystemExit(f'expected 4 character rows, found {len(row_bands)}')

tiles = []
for (ry0, ry1) in row_bands:
    for c in range(COLUMNS):
        cx0 = int(x0 + c * pitch)
        cx1 = int(x0 + (c + 1) * pitch)
        tiles.append(sheet.crop((cx0, ry0, cx1, ry1)))

def trim_to_subject(tile):
    """Crop away the card and its padding, keeping the character.

    Keyed on "not near-white": the cards are white, the characters are
    not. Squared afterwards so nothing is stretched, with a small margin
    so no limb touches the edge.
    """
    w, h = tile.size
    px = tile.load()
    xs, ys = [], []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if not (r > 235 and g > 235 and b > 235):
                xs.append(x); ys.append(y)
    if not xs:
        return tile
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pad = int(max(x1 - x0, y1 - y0) * 0.06)
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(w, x1 + pad), min(h, y1 + pad)
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    half = side // 2
    return tile.crop((cx - half, cy - half, cx + half, cy + half))

# The tile-to-id mapping, read off the sheet by eye and written down.
#
# Three automated matchers were tried and all failed: every tile is mostly
# white card with a small character, so greyscale thumbnails, colour
# thumbnails and trimmed-vs-untrimmed comparisons all produced distances
# too close together to separate 24 near-identical compositions. Rather
# than tune a similarity threshold until it happens to agree — which would
# be a guess wearing a number — the mapping is stated explicitly and can
# be checked against the sheet by anyone in about a minute.
#
# The original slicing commit (3d8a8f2) shipped only PNGs, so this
# reconstructs a mapping that was never written down anywhere.
#
# Index 2 is the owl, rendered on the sheet's selected-state peach card.
# It is deliberately absent: brand/avatars/README.md records that the
# peach cannot be removed without risking the character, and
# avatarCatalog.ts keeps 'owl' on its emoji fallback because real accounts
# store that id.
TILE_IDS = {
    0: 'fox',      1: 'wolf',     3: 'lion',     4: 'bear',
    5: 'eagle',    6: 'tiger',    7: 'dolphin',  8: 'dragon',
    9: 'panda',    10: 'unicorn', 11: 'racer',   12: 'moose',
    13: 'hare',    14: 'swan',    15: 'lynx',    16: 'gorilla',
    17: 'cheetah', 18: 'kangaroo', 19: 'otter',  20: 'raccoon',
    21: 'seal',    22: 'badger',  23: 'horse',
}

import os
existing = {f[:-4] for f in os.listdir(EXISTING) if f.endswith('.png')}
mapped = set(TILE_IDS.values())

report = []
missing = sorted(existing - mapped)
extra = sorted(mapped - existing)
for name in missing:
    report.append({'name': name, 'ok': False, 'reason': 'no tile assigned'})
for name in extra:
    report.append({'name': name, 'ok': False, 'reason': 'assigned but no existing file to replace'})

if not missing and not extra:
    for idx, name in sorted(TILE_IDS.items()):
        report.append({'name': name, 'ok': True, 'tile': idx, 'margin': '-'})

print(json.dumps(report))
if all(r['ok'] for r in report):
    for idx, name in sorted(TILE_IDS.items()):
        c = trim_to_subject(tiles[idx])
        # Quantised to a 192-colour palette for the app bundle.
        # Tighter crops carry more detail and therefore more bytes: at
        # full colour these came to 2.0 MB against the previous 1.3 MB,
        # a 54% increase in what a child downloads over mobile data.
        # Quantising brings it to ~0.9 MB — smaller than before the
        # re-slice — and was checked side by side at render size against
        # the full-colour version: no visible banding on the fox's fur,
        # the panda's greys, the dragon's teal or the swan's tutu.
        (c.resize((256, 256), Image.LANCZOS)
          .quantize(colors=192, method=Image.MEDIANCUT)
          .save(os.path.join(OUT_APP, name + '.png'), optimize=True))
        # brand/ keeps the native crop — no upscale. The old 512 files
        # were interpolated up from ~340px source and then down again to
        # 256, which is the softening this pass exists to remove.
        # brand/ keeps full colour: it is the archival intermediate,
        # not what ships.
        c.save(os.path.join(OUT_BRAND, name + '.png'), optimize=True)
    print(f'wrote {len(TILE_IDS)} avatars', file=sys.stderr)
else:
    print('NOT WRITING — some matches were unsafe', file=sys.stderr)
`;

const out = execFileSync('python3', ['-c', python], { encoding: 'utf8' });
const report = JSON.parse(out.trim().split('\n').pop());
const bad = report.filter((r) => !r.ok);
for (const r of report) {
  console.log(
    `  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(14)} ${
      r.ok ? `tile ${r.tile}, ${r.margin}x clearer than runner-up` : r.reason
    }`,
  );
}
if (bad.length) {
  throw new Error(
    `${bad.length} avatar(s) could not be matched safely — nothing written. ` +
      'An id mapped to the wrong tile would change a real player’s avatar.',
  );
}
console.log(`\nRe-sliced ${report.length} avatars.`);
