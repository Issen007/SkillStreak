# Brand assets

## Icon

Source: `temp/images/fireicon2.png` — the internally-voted favourite,
1024×1024 RGBA with transparent corners and a black rounded plate.

`brand/icon/` holds every size the two stores and the web actually ask
for, generated from that source with Lanczos downscaling.

```
ios/        icon-1024 (App Store) + every device size down to 29
android/    play-512, launcher densities 48-192,
            adaptive-foreground-432 + adaptive-background-432
web/        pwa-512, pwa-192, apple-touch-180, favicon 16/32/48, favicon.ico
sticker/    1024 and 512
```

### Two honest limits on this set

**1. Nothing here is higher resolution than the source, and nothing can
be.** Upscaling a 1024px raster does not add detail — it invents it, and
it looks like it. What matters in practice is that **every standard target
is at or below 1024**: the App Store icon is exactly 1024, Play's listing
icon is 512, and adaptive icons are 432. So the set is complete for app
and web use without needing anything the source doesn't have.

Above 1024 — large stickers, print, a banner — needs either true vector
artwork or a re-render from whatever produced the original. Ask for a
2048px or 4096px original before committing to anything physical.

**2. The mark does not hold up below about 48px.** At 32px the flame still
reads, but the `S` nearly vanishes: it is a thin serif letterform on a
busy gradient inside a black plate. The favicons are generated and usable,
but a favicon is a 16-32px object and this one is carrying detail it
cannot show at that size.

Worth a small design decision rather than a silent compromise — either a
simplified favicon variant (flame silhouette only, no `S`), or a heavier
`S` with more contrast against the flame. Both are cheap; shipping the
current one at 16px is the option that quietly looks worst.

### The adaptive icon's safe zone

Android masks adaptive icons to whatever shape the launcher wants — circle,
squircle, rounded square — and only the centre 72dp of the 108dp canvas is
guaranteed visible. `adaptive-foreground-432.png` therefore scales the
artwork to that safe zone rather than filling the square, so the flame's
tip and the plate's corners survive every mask. The background layer is
flat black, sampled from the source's own plate.

### Regenerating

The generation is a short Pillow script; there is no SVG source and no
rasterizer installed on this machine (`cairosvg`/`rsvg`/ImageMagick are all
absent, and pip is PEP 668-locked). If the icon is ever redrawn as vector,
that SVG becomes the source of truth and this set should be re-exported
from it instead — at which point the 1024 ceiling and the small-size
legibility problem both go away.
