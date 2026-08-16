"""Regenerate the app icons from temp/images/newlogo2.png.

Geometry is copied from the assets being replaced rather than chosen:
the existing android foreground occupies (171,171)-(853,853) of a 1024
canvas — 682px, 66.6%, the adaptive-icon safe zone — so the new one
lands in exactly the same place and nothing about the launcher icon's
composition changes except the artwork.
"""

from PIL import Image

SRC = "docs/brand/newlogo2.png"
OUT = "mobile/assets/"

# Adaptive-icon safe zone, measured from the file being replaced.
SAFE_ORIGIN, SAFE_SIZE, CANVAS = 171, 682, 1024

logo = Image.open(SRC).convert("RGBA")


def resized(size):
    return logo.resize((size, size), Image.LANCZOS)


# 1. iOS + general icon. Flattened onto black: App Store Connect rejects
#    any icon carrying an alpha channel, and the source has transparent
#    corners. Black rather than white because the logo's own background
#    is black, so iOS's squircle mask cannot cut a visible seam wherever
#    its corner radius differs from the artwork's.
icon = Image.new("RGB", (CANVAS, CANVAS), (0, 0, 0))
icon.paste(resized(CANVAS), (0, 0), resized(CANVAS))
icon.save(OUT + "icon.png")

# 2. Android adaptive foreground: transparent canvas, logo in the safe
#    zone. The launcher's mask crops the margin, never the flame.
fg = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
fg.paste(resized(SAFE_SIZE), (SAFE_ORIGIN, SAFE_ORIGIN))
fg.save(OUT + "android-icon-foreground.png")

# 3. Themed (monochrome) icon: Android tints this by its alpha channel,
#    so the alpha must be the flame silhouette alone. Keyed on "not
#    near-black", which selects the flame and its white outline and
#    drops the black backing square — the previous file made the whole
#    rounded square opaque, so a themed launcher tinted a solid block
#    instead of the flame.
small = resized(SAFE_SIZE)
px = small.load()
mask = Image.new("L", (SAFE_SIZE, SAFE_SIZE), 0)
mp = mask.load()
for y in range(SAFE_SIZE):
    for x in range(SAFE_SIZE):
        r, g, b, a = px[x, y]
        if a > 128 and max(r, g, b) > 40:
            mp[x, y] = 255
# The artwork's rounded-rect border is anti-aliased to near-white, so
# the "not near-black" key traces a broken outline along it. These are
# short segments rather than lone pixels, so a median filter leaves them
# — drop by connected-component area instead. The flame is one large
# blob plus its detached spark; nothing legitimate is near the cutoff.
import numpy as np  # noqa: E402
from scipy import ndimage  # noqa: E402

arr = np.array(mask) > 0
labels, n = ndimage.label(arr)
areas = ndimage.sum(arr, labels, range(1, n + 1))
keep = np.zeros_like(arr)
for i, area in enumerate(areas, start=1):
    if area >= 500:
        keep |= labels == i
print(f"monochrome: {n} components, kept {int((areas >= 500).sum())}")
mask = Image.fromarray((keep * 255).astype("uint8"), mode="L")

mono = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
white = Image.new("RGBA", (SAFE_SIZE, SAFE_SIZE), (255, 255, 255, 255))
mono.paste(white, (SAFE_ORIGIN, SAFE_ORIGIN), mask)
mono.save(OUT + "android-icon-monochrome.png")

# 4. Web favicon. Keeps the rounded corners transparent — a browser tab
#    composites onto its own background, and the previous file's opaque
#    white corners showed as white notches on a dark theme.
resized(196).save(OUT + "favicon.png")

for name in (
    "icon.png",
    "android-icon-foreground.png",
    "android-icon-monochrome.png",
    "favicon.png",
):
    im = Image.open(OUT + name)
    print(f"{name:32} {im.size} mode={im.mode} bbox={im.convert('RGBA').split()[3].getbbox()}")
