"""Turn Higgsfield style frames into registered, keyed flash frames.

Each raw frame (work/<brand>_styles_raw/sNN.png, dark mark on a light background)
becomes assets/<brand>/flash/sNN.png: transparent background, single brand ink colour,
and the mark's bounding box scaled and centred onto the reference knot's box, so every
flash sits exactly where the clean knot sits (no jitter between flashes).
Procedural variants (hairline, outline, dots) are cut from the official thread layer.

usage: python3 tools/style_frames.py mehad
"""
import glob, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize

brand = sys.argv[1]
A = f"assets/{brand}/"
cfg = json.load(open(A + "flash_config.json"))
INK = np.array(cfg["ink"], float)
N = 1024
os.makedirs(A + "flash", exist_ok=True)

# reference mark: official thread alpha, normalised into the 1024 canvas
ref = np.array(Image.open(A + cfg["reference_layer"]))[..., 3] / 255.0
ys, xs = np.where(ref > .5)
ref = ref[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
k = cfg["mark_width"] / ref.shape[1]
ref = np.array(Image.fromarray((ref * 255).astype(np.uint8)).resize(
    (round(ref.shape[1] * k), round(ref.shape[0] * k)), Image.LANCZOS)) / 255.0
def place(alpha):
    can = np.zeros((N, N)); h, w = alpha.shape
    y0, x0 = (N - h) // 2, (N - w) // 2; can[y0:y0 + h, x0:x0 + w] = alpha; return can
REF = place(ref)
ys, xs = np.where(REF > .5); RBOX = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
json.dump({"canvas": N, "box": [int(v) for v in RBOX]}, open(A + "flash/registration.json", "w"))

def save(name, alpha):
    o = np.zeros((N, N, 4), np.uint8); o[..., :3] = INK; o[..., 3] = np.clip(alpha * 255, 0, 255)
    Image.fromarray(o).save(A + f"flash/{name}.png")

def key(path):
    rgb = np.array(Image.open(path).convert("RGB")).astype(float) / 255
    lum = rgb @ [.2126, .7152, .0722]
    # smooth background estimate: quadratic surface fitted to the bright pixels
    yy, xx = np.mgrid[0:lum.shape[0], 0:lum.shape[1]] / lum.shape[0]
    bright = lum >= np.percentile(lum, 40) - 1e-6
    B = np.stack([np.ones_like(xx), xx, yy, xx * xx, yy * yy, xx * yy], -1)
    coef, *_ = np.linalg.lstsq(B[bright], lum[bright], rcond=None)
    bg = B @ coef
    ink = np.percentile(lum[lum <= np.percentile(lum, 3)], 50)
    a = np.clip((bg - lum) / np.maximum(bg - ink, .05), 0, 1)
    a = np.clip((a - .10) / .86, 0, 1) ** .85          # clean paper noise, keep soft edges
    return a

def register(a):
    lab, n = ndi.label(a > .35)
    if n > 1:                                         # drop specks far from the mark
        sizes = ndi.sum(np.ones_like(a), lab, range(1, n + 1))
        keep = np.isin(lab, 1 + np.where(sizes > sizes.max() * .02)[0])
        a = a * ndi.binary_dilation(keep, iterations=6)
    ys, xs = np.where(a > .35)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    s = (RBOX[2] - RBOX[0]) / (x1 - x0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (RBOX[0] + RBOX[2]) / 2, (RBOX[1] + RBOX[3]) / 2
    im = Image.fromarray((a * 255).astype(np.uint8))
    # affine: output (u,v) -> input ((u-rx)/s+cx, (v-ry)/s+cy)
    out = im.transform((N, N), Image.AFFINE, (1 / s, 0, cx - rx / s, 0, 1 / s, cy - ry / s), Image.BICUBIC)
    return np.array(out) / 255.0

for p in sorted(glob.glob(f"work/{brand}_styles_raw/s*.png")):
    name = os.path.basename(p)[:-4]
    save(name, register(key(p))); print("keyed", name)

# procedural variants from the official mark
sk = skeletonize(REF > .5)
w = 2 * ndi.distance_transform_edt(REF > .5).max()
hair = ndi.gaussian_filter(ndi.binary_dilation(sk, iterations=2).astype(float), .8)
save("p_hair", np.clip(hair * 1.4, 0, 1))
outline = ndi.binary_dilation(REF > .5, iterations=5) & ~ndi.binary_erosion(REF > .5, iterations=int(w * .5) - 3)
save("p_outline", ndi.gaussian_filter(outline.astype(float), .7))
pts = np.argwhere(sk); taken = np.zeros(len(pts), bool); dots = np.zeros((N, N))
yy, xx = np.mgrid[0:N, 0:N]; chosen = []
for i in np.argsort(pts[:, 1] * N + pts[:, 0]):
    if all(np.hypot(*(pts[i] - c)) > w * 1.25 for c in chosen): chosen.append(pts[i])
for cy, cx in chosen:
    r = w * .42; dots = np.maximum(dots, np.clip(r + .5 - np.hypot(yy - cy, xx - cx), 0, 1))
save("p_dots", dots)
save("p_clean", REF)
print("procedural: hair outline dots clean; stroke width", round(w, 1))
