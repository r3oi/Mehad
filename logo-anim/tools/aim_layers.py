"""Split the official AIM mark (assets/aim/logo_source.webp) into animation layers.

The mark is two opaque circles with a vertical gradient, a deeper lens where they
overlap, and A·I·M knocked out (transparent) — the letters always show the background.
  mint_col.png  the circles' vertical gradient (1px wide, one row per source row)
  deep_col.png  the overlap's deeper vertical gradient
  letters.png   the knock-out shapes, straight from the file's alpha
Circles are fitted to the file and colours per row from its own pixels, so the circles
can slide and overlap anywhere and still paint the file's exact colours.
The animation ends on the source file itself.
"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi, optimize

A = "assets/aim/"
im = np.array(Image.open(A + "logo_source.webp").convert("RGBA")).astype(float)
rgb, a = im[..., :3], im[..., 3] / 255
H, W = a.shape
yy, xx = np.mgrid[0:H, 0:W].astype(float)

# fit the two circles to the outer silhouette (letters filled first)
sil = ndi.binary_fill_holes(a > .5)
edge = sil ^ ndi.binary_erosion(sil)
ey, ex = np.where(edge)
def fit(sel):
    x, y = ex[sel], ey[sel]
    f = lambda p: np.hypot(x - p[0], y - p[1]) - p[2]
    return optimize.least_squares(f, [x.mean(), H / 2, H / 2]).x
C1 = fit(ex < W * .42); C2 = fit(ex > W * .58)
print("circles", np.round(C1, 2), np.round(C2, 2))
d1 = np.hypot(xx - C1[0], yy - C1[1]); d2 = np.hypot(xx - C2[0], yy - C2[1])
a1 = np.clip(C1[2] - d1 + .5, 0, 1); a2 = np.clip(C2[2] - d2 + .5, 0, 1)
union, lens_a = np.maximum(a1, a2), np.minimum(a1, a2)

# per-row colours from clean interior pixels, smoothed with a cubic in y
inner = (a > .999) & ndi.binary_erosion(a > .5, iterations=4)
single = inner & (((d1 < C1[2] - 6) & (d2 > C2[2] + 6)) | ((d2 < C2[2] - 6) & (d1 > C1[2] + 6)))
both = inner & (d1 < C1[2] - 6) & (d2 < C2[2] - 6)
def row_fit(mask):
    ys = yy[mask]; out = []
    for c in range(3):
        p = np.polyfit(ys / H, rgb[..., c][mask], 3); out.append(np.polyval(p, yy[:, 0] / H))
    return np.stack(out, 1)                       # (H, 3)
mint, deep = row_fit(single), row_fit(both)
for n, m, col in [("single", single, mint), ("lens", both, deep)]:
    e = np.abs(rgb[m] - col[yy[m].astype(int)]); print(f"{n} gradient fit: mean {e.mean():.2f} p99 {np.percentile(e, 99):.1f}")

def save(name, color_rows, alpha):
    o = np.zeros((H, W, 4)); o[..., :3] = color_rows[:, None, :]; o[..., 3] = alpha * 255
    Image.fromarray(np.clip(o, 0, 255).round().astype(np.uint8)).save(A + name)
for n, col in [("mint_col.png", mint), ("deep_col.png", deep)]:
    Image.fromarray(np.clip(col[:, None, :], 0, 255).round().astype(np.uint8)).save(A + n)
letters = np.clip(union - a, 0, 1) * (ndi.binary_erosion(union > .5, iterations=3))
save("letters.png", np.full((H, 3), 255.0), letters)
# verify: base, lens over it, letters knocked out — against the source on white
bg = np.array([255.0] * 3)
comp = mint[:, None] * (1 - lens_a[..., None]) + deep[:, None] * lens_a[..., None]
cov = union * (1 - letters)
out = comp * cov[..., None] + bg * (1 - cov[..., None])
src = rgb * a[..., None] + bg * (1 - a[..., None])
err = np.abs(out - src); print(f"recomposite vs source: mean {err.mean():.2f}  p99 {np.percentile(err, 99):.1f}  p99.9 {np.percentile(err, 99.9):.1f}")

geo = {"size": [W, H], "c1": [round(float(v), 2) for v in C1], "c2": [round(float(v), 2) for v in C2]}
ys, xs = np.where(letters > .5); geo["letters_box"] = [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)]
lab, n = ndi.label(letters > .5)
geo["letters"] = sorted([[int(s[1].start), int(s[0].start), int(s[1].stop), int(s[0].stop)] for s in ndi.find_objects(lab) if (s[1].stop - s[1].start) > 40])
json.dump(geo, open(A + "geometry.json", "w"), indent=1); print(geo)
