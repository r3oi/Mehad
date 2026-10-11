"""Split the official Mehad lockup (assets/mehad/lockup_source.webp) into animation layers.

Every layer is cut from the official file's own pixels (no redraw):
  wordmark_ar.png  Arabic «مهاد»           wordmark_en.png  MEHAD
  icon_square.png  teal rounded square    icon_thread.png  white thread
  icon_fill_{olive,navy,sand}.png         the three fills, extended under the thread
The final frame of the animation is the source lockup itself.
"""
import json, sys
import numpy as np
from PIL import Image

SRC = "assets/mehad/lockup_source.webp"
OUT = "assets/mehad/"
im = np.array(Image.open(SRC).convert("RGBA")).astype(float)
rgb, a = im[..., :3], im[..., 3] / 255
H, W = a.shape
PAL = {"teal": (40, 162, 153), "navy": (67, 84, 106), "sand": (188, 157, 106), "olive": (109, 168, 125)}
WHITE = np.array([255, 255, 255.0])

ICON_X0 = 1200                      # columns ≥ this belong to the icon
AR_Y1, EN_Y0 = 380, 400             # wordmark rows: Arabic above, MEHAD below

def save(name, rgba, box=None):
    Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8)).save(OUT + name)

def solid(color, alpha):
    o = np.zeros((H, W, 4)); o[..., :3] = color; o[..., 3] = alpha * 255; return o

# --- wordmark: navy ink, alpha straight from the file -------------------------
word = np.zeros((H, W)); word[:, :ICON_X0] = a[:, :ICON_X0]
ar = word.copy(); ar[AR_Y1:] = 0
en = word.copy(); en[:EN_Y0] = 0
save("wordmark_ar.png", solid(PAL["navy"], ar))
save("wordmark_en.png", solid(PAL["navy"], en))

# --- icon: unmix every pixel as white·w + C·(1-w) for C in the palette -------
icon = np.zeros((H, W), bool); icon[:, ICON_X0:] = True
best_res = np.full((H, W), 1e9); best_w = np.zeros((H, W)); best_c = np.full((H, W), -1)
names = ["teal", "navy", "sand", "olive"]
for k, n in enumerate(names):
    C = np.array(PAL[n], float); d = WHITE - C
    w = np.clip(((rgb - C) @ d) / (d @ d), 0, 1)
    res = np.linalg.norm(rgb - (C + w[..., None] * d), axis=-1)
    m = res < best_res
    best_res[m], best_w[m], best_c[m] = res[m], w[m], k
best_w[~icon] = 0
sq_alpha = np.where(icon, a, 0)
save("icon_square.png", solid(PAL["teal"], sq_alpha))
save("icon_thread.png", solid((255, 255, 255), best_w * sq_alpha))
from scipy import ndimage as ndi
for k, n in enumerate(names[1:], start=1):
    f = (best_c == k) & icon & (best_w < .995)
    core = (best_c == k) & icon & (best_w < .5) & (a > .5)  # the counter itself, not edge pixels
    lab, cnt = ndi.label(core)
    big = lab == 1 + int(np.argmax(np.bincount(lab.ravel())[1:]))
    f &= ndi.binary_dilation(big, iterations=4)           # keep the anti-aliased rim under the thread
    save(f"icon_fill_{n}.png", solid(PAL[n], f.astype(float) * sq_alpha))

# --- verify: recomposite and compare with the source --------------------------
def over(dst, src):
    sa = src[..., 3:4] / 255; da = dst[..., 3:4] / 255; oa = sa + da * (1 - sa)
    oc = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    return np.concatenate([oc, oa * 255], -1)
layers = ["icon_square", "icon_fill_olive", "icon_fill_navy", "icon_fill_sand", "icon_thread", "wordmark_ar", "wordmark_en"]
acc = np.zeros((H, W, 4))
for n in layers: acc = over(acc, np.array(Image.open(OUT + n + ".png")).astype(float))
bg = np.array([247, 244, 238.0])
flat = lambda x: x[..., :3] * x[..., 3:4] / 255 + bg * (1 - x[..., 3:4] / 255)
err = np.abs(flat(acc) - flat(im))
print("recomposite error: mean %.3f  p99.9 %.1f  max %.1f" % (err.mean(), np.percentile(err, 99.9), err.max()))

# icon geometry for the engine
ys, xs = np.where(sq_alpha > .5)
geo = {"size": [W, H], "icon": [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)]}
for n, m in [("ar", ar), ("en", en)]:
    ys, xs = np.where(m > .5); geo[n] = [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)]
for k, n in enumerate(names[1:], start=1):
    ys, xs = np.where((best_c == k) & icon & (sq_alpha > .5) & (best_w < .5)); geo["fill_" + n] = [float(xs.mean()), float(ys.mean())]
json.dump(geo, open(OUT + "geometry.json", "w"), indent=1); print(geo)
