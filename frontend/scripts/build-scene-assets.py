"""
Builds the lock scene's images in src/assets/scene/ (see the README there).

  python3 scripts/build-scene-assets.py <references dir> src/assets/scene <preview dir>

Needs Pillow and numpy. The photographs (cover, lamp, clasp) are read from
the references folder, trimmed, resized and written as WebP. The desk's wood
is not a photograph: it is generated here from noise, so it has no source or
licence of its own. The preview dir receives JPEGs for checking by eye.
"""
import sys, os
from PIL import Image, ImageFilter, ImageChops
import numpy as np
REF, OUT, S = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(f"{S}/ref", exist_ok=True)

def clean(name, target_w=None, target_h=None, erode=1):
    im = Image.open(os.path.join(REF, name)).convert("RGBA")
    a = im.getchannel("A")
    # pull the matte in a touch and soften it: removes the pale fringe of the old background
    for _ in range(erode):
        a = a.filter(ImageFilter.MinFilter(3))
    a = a.filter(ImageFilter.GaussianBlur(0.8))
    im.putalpha(a)
    bbox = a.point(lambda v: 255 if v > 8 else 0).getbbox()
    im = im.crop(bbox)
    if target_w: im = im.resize((target_w, round(im.height * target_w / im.width)), Image.LANCZOS)
    if target_h: im = im.resize((round(im.width * target_h / im.height), target_h), Image.LANCZOS)
    return im

cover = clean("cover-clean.png", target_w=640, erode=2)
lamp = clean("lamp.png", target_h=720)
clasp = clean("clasp.png", target_w=260)
cover.save(f"{OUT}/cover.webp", quality=70, method=6)
lamp.save(f"{OUT}/lamp.webp", quality=76, method=6)
clasp.save(f"{OUT}/clasp.webp", quality=84, method=6)
print("cover", cover.size, "lamp", lamp.size, "clasp", clasp.size)

# ---- wood: generated, not photographed -------------------------------------
def wood(seed, base, dark, light, size=768):
    rng = np.random.default_rng(seed)
    def noise(w, h, sx, sy):
        g = rng.random((max(2, h // sy + 2), max(2, w // sx + 2))).astype(np.float32)
        return np.array(Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255
    w = h = size
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    # long grain running left to right, wandering a little
    warp = noise(w, h, 380, 140) * 30 + noise(w, h, 160, 40) * 7
    rings = np.sin((y + warp) / 4.2 + noise(w, h, 500, 200) * 5) * 0.5 + 0.5
    fine = noise(w, h, 220, 2) * 0.45 + noise(w, h, 90, 1) * 0.35 + noise(w, h, 300, 1) * 0.2
    pores = (noise(w, h, 30, 1) > 0.78).astype(np.float32) * noise(w, h, 8, 1)
    blotch = noise(w, h, 300, 200)
    v = 0.2 * rings + 0.55 * fine + 0.25 * blotch - 0.2 * pores
    v = (v - v.min()) / (v.max() - v.min())
    base, dark, light = (np.array(c, dtype=np.float32) for c in (base, dark, light))
    lo = dark[None, None] + (base - dark)[None, None] * np.clip(v * 2, 0, 1)[..., None]
    out = lo + (light - base)[None, None] * np.clip(v * 2 - 1, 0, 1)[..., None]
    # plank seams
    for py in (0, size // 3 + 11, 2 * size // 3 - 7):
        out[py:py + 2] *= 0.62
        out[py + 2:py + 4] *= 0.86
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    # make it tile: cross-fade the right edge into the left
    b = 64
    arr = np.array(img, dtype=np.float32)
    t = np.linspace(0, 1, b)[None, :, None]
    arr[:, -b:] = arr[:, -b:] * (1 - t) + arr[:, :b][:, ::-1][:, ::-1] * t
    return Image.fromarray(arr.astype(np.uint8))

wood(11, (74, 44, 28), (38, 21, 13), (104, 66, 42)).save(f"{OUT}/wood-dark.webp", quality=62, method=6)
wood(11, (168, 122, 82), (126, 86, 54), (198, 156, 112)).save(f"{OUT}/wood-light.webp", quality=62, method=6)

# previews
for bg, tag in (((30, 20, 14), "dark"), ((190, 150, 110), "mid")):
    canvas = Image.new("RGB", (1100, 760), bg)
    c2 = cover.resize((420, round(cover.height * 420 / cover.width)))
    canvas.paste(c2, (330, 180), c2)
    l2 = lamp.resize((round(lamp.width * 380 / lamp.height), 380))
    canvas.paste(l2, (40, 10), l2)
    k2 = clasp.resize((150, round(clasp.height * 150 / clasp.width)))
    canvas.paste(k2, (800, 400), k2)
    canvas.save(f"{S}/ref/preview-{tag}.jpg", quality=85)
Image.open(f"{OUT}/wood-dark.webp").save(f"{S}/ref/wood-dark.jpg")
Image.open(f"{OUT}/wood-light.webp").save(f"{S}/ref/wood-light.jpg")
