# Brand assets

## Icon

Source: `temp/images/newlogo.png` — **2048×2048** RGBA, a flame with the
`S` formed by its own internal shading and a white outline, on a black
rounded plate.

(This replaced `fireicon2.png`, which was the first pick. That one was
1024×1024 and carried the `S` as a separate thin serif letterform, which
disappeared below ~48px. The current mark reads noticeably better small,
because the legibility comes from the silhouette rather than from a
letter drawn on top of it.)

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

**1. Nothing here is higher resolution than the 2048 source.** Upscaling
a raster invents detail rather than adding it. At 2048 that ceiling is
comfortably above every target: the App Store icon is 1024, Play's listing
icon 512, adaptive icons 432 — and stickers up to 2048 are now covered
natively, which the previous 1024 source could not do.

Print larger than 2048 still wants true vector artwork.

**2. Small sizes are usable but tight.** At 32px the flame silhouette
reads clearly and the `S` survives as a light swirl. It is legible rather
than crisp — normal for a detailed mark at favicon size, and much better
than the previous icon managed.

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
