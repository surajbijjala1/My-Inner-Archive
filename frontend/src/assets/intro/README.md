# Intro videos and the lock scene

Everything here is built by `frontend/scripts/build-intro-assets.py` from the
intro videos the owner supplied (`Videos/dark-mode.mp4`, `Videos/light-mode.mp4`
at the repository root, not tracked). Licence: the owner's own videos.

| File | What it is | Size |
| --- | --- | --- |
| `dark.mp4`, `light.mp4` | The intro videos, re-encoded: H.264 High, CRF 22, AAC 128k, faststart. 1280x720, 24 fps, 10 s. Source 7.2 / 6.9 MB; measured against it, SSIM 0.984 / PSNR 44 dB, no difference visible at 2x. | 3.2 / 3.1 MB |
| `*-poster.webp` | The video's first frame: shown the moment the video is asked for. | 103 / 113 KB |
| `*-desk.webp` | The video's last frame with the book lifted off, carried on past the frame's edges (mirrored at the edge, dimming away) for windows the 16:9 frame does not cover. The lock scene and the app lie on it. | 88 / 122 KB |
| `*-cover.webp` | The book cut out of the last frame (rounded corners kept), with the leather under the clasp mended from the cover's mirror image. | 67 / 64 KB |
| `*-clasp.webp` | The clasp and its strap, cut out of the last frame. | 5 / 5 KB |
| `manifest.json` | Where each piece sits in the frame (frame pixels): the book, the wreath's centre and radii, the clasp, and how far the desk carries on. | |

Laid back where they came from, desk + cover + clasp reproduce the video's
last frame (mean difference about 0.25 of 255 before compression, under 2
after, against the encoded video). That is what makes the hand-over from the
video to the live lock scene invisible.

The videos are not in the cold-start path: the entry page needs none of
this. The desk, cover and clasp are fetched after first paint; the video
starts fetching 0.4 s after the entry page appears.

## Adding the upright (9:16) videos

1. Put them in `Videos/` (any names) and add an entry for each to `SCENES`
   in the build script, named `dark-portrait` and `light-portrait`, with
   their own measurements (book corners, wreath centre and radii, clasp
   outline, the mirror line, bare desk and clutter boxes) in that video's
   pixels.
2. Run `python3 scripts/build-intro-assets.py ../Videos src/assets/intro <preview dir> --encode`.

No app code changes: `src/scene/introAssets.ts` picks up `*-portrait` files
when they exist and uses them on an upright screen, falling back to the
16:9 set.
