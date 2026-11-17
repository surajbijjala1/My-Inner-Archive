"""
Builds everything the entrance needs from the intro videos (src/assets/intro,
see the README there).

  python3 scripts/build-intro-assets.py <videos dir> src/assets/intro <preview dir> [--encode]

--encode re-encodes each source video into src/assets/intro (H.264, CRF 22,
AAC 128k, faststart). Without it, the video already there is used as it is
(or the source is copied in if there is none).

Needs Pillow, numpy and imageio-ffmpeg (a bundled ffmpeg).

For each video named in SCENES it writes:
  <name>.mp4          the video itself (see --encode)
  <name>-poster.webp  its first frame: shown the instant the video is asked for
  <name>-desk.webp    its LAST frame with the book taken off the desk, on a
                      canvas that carries the desk on past the frame's edges
  <name>-cover.webp   the book cut out of the last frame, its clasp removed
  <name>-clasp.webp   the clasp cut out of the last frame
and one manifest.json with where each piece sits, in frame pixels.

desk + cover + clasp, laid back where they came from, ARE the last frame, so
the live lock scene and the video's end are the same picture.

Adding a 9:16 video: put `dark-portrait.mp4` / `light-portrait.mp4` in the
videos folder, add an entry to SCENES with its measurements (book corners,
wreath centre, clasp box, all in that video's own pixels) and run this again.
No app code changes: the app picks `-portrait` files up when they exist.
"""
import json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import imageio_ffmpeg

SRC, OUT, PREVIEW = sys.argv[1], sys.argv[2], sys.argv[3]
ENCODE = "--encode" in sys.argv
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)

# Measured by eye on each video's last frame (frame pixels).
SCENES = {
    "dark": {
        "video": "dark-mode.mp4",
        # the book's four corners, clockwise from top-left, and their rounding
        "book": [(424.5, 58), (844, 41.5), (867.5, 630), (428, 642.5)],
        "round": 9,
        # centre of the wreath; the medallion's radius; the wreath's outer radius
        "wreath": (645.5, 332.5), "medallion": 53, "outer": 118,
        # the clasp, traced: rounded boxes (x0, y0, x1, y1, r), discs (x, y, r), polygons
        "clasp": {
            "boxes": [(767, 290, 798, 388, 14), (812, 284, 846, 391, 13), (794, 315, 816, 365, 2), (842, 288, 873, 392, 4)],
            "discs": [(745, 340, 11)],
            "polys": [[(747, 345), (769, 341), (771, 364), (755, 357)]],
        },
        # the cover's ornament is mirrored about this line (to mend the leather under the clasp)
        "axis": 644,
        # bare desk either side of the book (x0, y0, x1, y1), to lay where the book was
        "bare": [(40, 80, 420, 720), (880, 0, 1150, 720)],
        # things lying at the frame's edge (lamp foot, a sheet of paper, a box): they
        # are not carried past the frame, where they would repeat as mirror images
        "clutter": [(160, 0, 480, 84), (0, 380, 48, 585), (1130, 0, 1280, 220)],
        "falloff": 0.22,
    },
    "light": {
        "video": "light-mode.mp4",
        "book": [(435, 79.5), (840.5, 79), (848.5, 631), (424, 639)],
        "round": 9,
        "wreath": (642.5, 342.5), "medallion": 57, "outer": 124,
        "clasp": {
            "boxes": [(759, 312, 792, 403, 15), (803, 312, 837, 406, 14), (788, 337, 808, 383, 2)],
            "discs": [(751, 357, 11)],
            "polys": [[(754, 361), (763, 351), (766, 378), (757, 369)], [(833, 315), (857, 318), (866, 329), (866, 405), (833, 405)]],
        },
        "axis": 640,
        "bare": [(70, 25, 400, 720), (870, 125, 1180, 720)],
        "clutter": [(180, 0, 470, 56), (0, 0, 64, 135), (0, 225, 66, 610), (1170, 0, 1280, 140)],
        "falloff": 0.42,
    },
}

# The desk is carried this far past the frame (fractions of the frame's size),
# for windows the 16:9 frame cannot cover with the whole book in view.
PAD_X, PAD_Y = 0.16, 0.52


def grab(video, where, path):
    args = [FFMPEG, "-v", "error", "-y"]
    args += ["-sseof", "-0.25"] if where == "last" else []
    args += ["-i", video]
    args += ["-update", "1"] if where == "last" else ["-frames:v", "1"]
    subprocess.run(args + [path], check=True)
    return Image.open(path).convert("RGB")


def box(a, r, axis):
    """Box blur of radius r along one axis, edges held."""
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a, sigma):
    """Gaussian blur of a float array (three box blurs)."""
    r = max(1, int(round(sigma * 0.98)))
    a = a.astype(np.float32)
    for _ in range(3):
        a = box(box(a, r, 0), r, 1)
    return a


def fill_blur(img, known, sigma):
    """Blur that only listens to known pixels (normalised convolution)."""
    w = blur(known.astype(np.float32), sigma)
    return blur(img * known[..., None], sigma) / np.maximum(w, 1e-4)[..., None]


def rounded_polygon(size, pts, radius, scale=3):
    """A soft-edged mask of a polygon with rounded corners."""
    W, H = size
    m = Image.new("L", (W * scale, H * scale), 0)
    ImageDraw.Draw(m).polygon([(x * scale, y * scale) for x, y in pts], fill=255)
    # blurring and cutting at half rounds the corners and leaves straight edges where they were
    m = m.filter(ImageFilter.GaussianBlur(radius * scale * 0.6)).point(lambda v: 255 if v > 127 else 0)
    m = m.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    return np.asarray(m, dtype=np.float32) / 255


def fill_light(img, known):
    """The smooth light of an image, carried across what is unknown (coarse to fine)."""
    k = known.astype(np.float32)
    out = np.broadcast_to((img * k[..., None]).sum(axis=(0, 1)) / max(k.sum(), 1), img.shape).astype(np.float32)
    for sigma in (150, 60, 24, 9):
        w = blur(k, sigma)
        v = blur(img * k[..., None], sigma) / np.maximum(w, 1e-4)[..., None]
        a = np.clip(w * 3, 0, 1)[..., None]
        out = out * (1 - a) + v * a
    return out


def clasp_matte(size, g, scale=4):
    """The clasp's outline, as traced."""
    W, H = size
    m = Image.new("L", (W * scale, H * scale), 0)
    d = ImageDraw.Draw(m)
    c = g["clasp"]
    for x0, y0, x1, y1, r in c["boxes"]:
        d.rounded_rectangle([x0 * scale, y0 * scale, x1 * scale, y1 * scale], radius=r * scale, fill=255)
    for x, y, r in c["discs"]:
        d.ellipse([(x - r) * scale, (y - r) * scale, (x + r) * scale, (y + r) * scale], fill=255)
    for poly in c["polys"]:
        d.polygon([(x * scale, y * scale) for x, y in poly], fill=255)
    m = m.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.7))
    return np.asarray(m, dtype=np.float32) / 255


def lay_desk(frame, hole, g):
    """
    Bare desk laid over whatever `hole` covers: grain from the bare stretches
    either side of the book, lit by the light around the gap.
    """
    H, W = frame.shape[:2]
    f = frame.astype(np.float32)
    light = fill_light(f, hole < 0.02)
    grain = f / np.maximum(blur(f, 24), 1)
    yy, xx = np.mgrid[0:H, 0:W]

    def from_box(box):
        bx0, by0, bx1, by1 = box
        w, h = bx1 - bx0, by1 - by0
        # walk the box back and forth, so the grain never jumps
        px, py = (xx - bx0) % (2 * w), (yy - by0) % (2 * h)
        sx = bx0 + np.where(px < w, px, 2 * w - 1 - px)
        sy = by0 + np.where(py < h, py, 2 * h - 1 - py)
        return grain[sy, sx]

    mid = W // 2
    t = np.clip((xx - (mid - 40)) / 80, 0, 1)[..., None]
    laid = (from_box(g["bare"][0]) * (1 - t) + from_box(g["bare"][1]) * t) * light
    a = np.clip(blur(hole, 2) * 2, 0, 1)[..., None]
    return np.clip(f * (1 - a) + laid * a, 0, 255)


def grow_desk(bare, g):
    """
    The bare desk on a larger canvas. Past the frame's edges the desk is the
    frame's own, turned over at the edge (so the join is exact) with the odd
    things at its edges taken off first, dimming with distance like light
    falling off.
    """
    H, W = bare.shape[:2]
    px, py = int(W * PAD_X), int(H * PAD_Y)
    clutter = np.zeros((H, W), np.float32)
    for x0, y0, x1, y1 in g["clutter"]:
        clutter[y0:y1, x0:x1] = 1
    clear = lay_desk(bare, blur(clutter, 3), g)
    big = np.pad(clear, ((py, py), (px, px), (0, 0)), mode="reflect")
    big[py:py + H, px:px + W] = bare
    CH, CW = big.shape[:2]
    yy, xx = np.mgrid[0:CH, 0:CW]
    dx = np.maximum(np.maximum(px - xx, xx - (px + W - 1)), 0) / px
    dy = np.maximum(np.maximum(py - yy, yy - (py + H - 1)), 0) / py
    dist = np.clip(np.hypot(dx, dy), 0, 1)
    # nothing past the frame is sharper than the light is strong
    soft = blur(big, 3)
    t = np.clip(dist * 1.5, 0, 1)[..., None]
    big = big * (1 - t * 0.6) + soft * (t * 0.6)
    big *= (1 - (1 - g["falloff"]) * dist ** 0.85)[..., None]
    return np.clip(big, 0, 255).astype(np.uint8), (px, py)


def mend_under_clasp(frame, clasp, g):
    """The leather under the clasp: the cover's mirror image, relit to match its surroundings."""
    H, W = frame.shape[:2]
    f = frame.astype(np.float32)
    hole = np.asarray(Image.fromarray((clasp * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)), dtype=np.float32) / 255
    xs = np.arange(W)
    mx = np.clip(np.round(2 * g["axis"] - xs).astype(int), 0, W - 1)
    mirror = f[:, mx]
    here = fill_light(f, hole < 0.02)
    there = blur(mirror, 9)
    relit = mirror * (here / np.maximum(there, 1))
    a = np.clip(blur(hole, 1.6) * 1.6, 0, 1)[..., None]
    return np.clip(f * (1 - a) + relit * a, 0, 255).astype(np.uint8)


def webp(arr, path, quality, **kw):
    Image.fromarray(arr).save(path, "WEBP", quality=quality, method=6, **kw)
    return os.path.getsize(path)


manifest = {}
sizes = {}
for name, g in SCENES.items():
    source = os.path.join(SRC, g["video"])
    if not os.path.exists(source):
        continue
    # The video that ships. Its frames are cut from it, not from the source,
    # so the lock scene matches what is actually played.
    video = os.path.join(OUT, f"{name}.mp4")
    if ENCODE:
        # x264 at CRF 22 measured SSIM 0.984 / PSNR 44 dB against the source,
        # with no difference visible at 2x: under half the size.
        subprocess.run([
            FFMPEG, "-v", "error", "-y", "-i", source,
            "-c:v", "libx264", "-preset", "veryslow", "-crf", "22", "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", video,
        ], check=True)
    elif not os.path.exists(video):
        shutil.copyfile(source, video)
    first = grab(video, "first", os.path.join(PREVIEW, f"{name}-first.png"))
    last = grab(video, "last", os.path.join(PREVIEW, f"{name}-last.png"))
    frame = np.asarray(last)
    H, W = frame.shape[:2]

    book = rounded_polygon((W, H), g["book"], g["round"])
    clasp = clasp_matte((W, H), g)
    book = np.maximum(book, clasp)  # the strap reaches past the board's edge

    # desk: the book and its clasp lifted off
    lift = np.asarray(Image.fromarray((book * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)), dtype=np.float32) / 255
    desk, (px, py) = grow_desk(lay_desk(frame, lift, g), g)

    # cover: the book, with the leather mended where the clasp was
    mended = mend_under_clasp(frame, clasp, g)
    board = rounded_polygon((W, H), g["book"], g["round"])
    ys, xs = np.where(board > 0.01)
    bx0, by0, bx1, by1 = xs.min() - 1, ys.min() - 1, xs.max() + 2, ys.max() + 2
    cover = np.dstack([mended, (board * 255).astype(np.uint8)])[by0:by1, bx0:bx1]

    ys, xs = np.where(clasp > 0.01)
    cx0, cy0, cx1, cy1 = xs.min() - 1, ys.min() - 1, xs.max() + 2, ys.max() + 2
    clasp_img = np.dstack([frame, (clasp * 255).astype(np.uint8)])[cy0:cy1, cx0:cx1]

    sizes[name] = {
        "poster": webp(np.asarray(first), os.path.join(OUT, f"{name}-poster.webp"), 80),
        "desk": webp(desk, os.path.join(OUT, f"{name}-desk.webp"), 84),
        "cover": webp(cover, os.path.join(OUT, f"{name}-cover.webp"), 90, exact=False),
        "clasp": webp(clasp_img, os.path.join(OUT, f"{name}-clasp.webp"), 92),
        "video": os.path.getsize(video),
    }


    # proof: the three pieces laid back down against the real last frame
    comp = desk[py:py + H, px:px + W].astype(np.float32)
    for piece, (ox, oy) in ((cover, (bx0, by0)), (clasp_img, (cx0, cy0))):
        a = piece[..., 3:4].astype(np.float32) / 255
        h, w = piece.shape[:2]
        comp[oy:oy + h, ox:ox + w] = comp[oy:oy + h, ox:ox + w] * (1 - a) + piece[..., :3] * a
    diff = np.abs(comp - frame.astype(np.float32)).max(axis=2)
    print(f"{name}: composite vs last frame  mean {diff.mean():.3f}  p99 {np.percentile(diff, 99):.1f}  max {diff.max():.0f}  (0-255, before webp)")
    Image.fromarray(comp.astype(np.uint8)).save(os.path.join(PREVIEW, f"{name}-composite.png"))
    Image.fromarray(desk).save(os.path.join(PREVIEW, f"{name}-desk.jpg"), quality=85)
    Image.fromarray(mended).save(os.path.join(PREVIEW, f"{name}-mended.png"))
    Image.fromarray(clasp_img).save(os.path.join(PREVIEW, f"{name}-clasp.png"))

    bw, bh = int(bx1 - bx0), int(by1 - by0)
    manifest[name] = {
        "frame": [W, H],
        "pad": [px, py],
        "book": [int(bx0), int(by0), bw, bh],
        "wreath": [g["wreath"][0], g["wreath"][1]],
        "medallion": g["medallion"],
        "outer": g["outer"],
        "clasp": [int(cx0), int(cy0), int(cx1 - cx0), int(cy1 - cy0)],
    }

with open(os.path.join(OUT, "manifest.json"), "w") as fh:
    json.dump(manifest, fh, indent=2)
    fh.write("\n")
for name, s in sizes.items():
    print(name, {k: f"{v / 1024:.0f} KB" for k, v in s.items()})
