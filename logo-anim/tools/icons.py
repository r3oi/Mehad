"""Cut the Higgsfield icon sheets (2x2 grids) into icons for AIM's Mash sting.

  line sheets → white ink with alpha, strokes thickened to the pen weight at their display size
  real sheets → product cut-outs from the sheets after Higgsfield's background remover
                (RGBA), cropped per quadrant; stray specks dropped

usage: python3 tools/icons.py <line_a.png> <line_b.png> <real_a_cut.png> <real_b_cut.png>
writes assets/aim/icons/{line,real}_<name>.png
"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize, disk

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "aim", "icons")
os.makedirs(OUT, exist_ok=True)
# display size (max dimension, px at 1920 wide) of each icon, by sheet and quadrant
LINE = [["lipstick", 82, "brush", 100, "hanger", 108, "dress", 96], ["handbag", 96, "polish", 80, "heel", 104, "lips", 104]]
REAL = [["lipstick", 86, "brush", 108, "hanger", 112, "dress", 100], ["handbag", 100, "polish", 84, "heel", 108, "compact", 84]]
PEN = 2.1          # target stroke width at display size (px)
SS = 4             # icons are stored at SS × display size

def cells(path, mode="RGB"):
    im = np.asarray(Image.open(path).convert(mode)).astype(np.float32)
    h, w = im.shape[:2]; inset = 14
    for j in range(2):
        for i in range(2):
            yield im[j * h // 2 + inset:(j + 1) * h // 2 - inset, i * w // 2 + inset:(i + 1) * w // 2 - inset]

def bbox(mask, pad):
    ys, xs = np.nonzero(mask)
    return max(0, ys.min() - pad), min(mask.shape[0], ys.max() + pad + 1), max(0, xs.min() - pad), min(mask.shape[1], xs.max() + pad + 1)

def line_icon(c, name, size):
    ink = np.clip((235 - c.mean(2)) / 180, 0, 1)
    y0, y1, x0, x1 = bbox(ink > .3, 24); ink = ink[y0:y1, x0:x1]
    k = size * SS / max(ink.shape)
    sk = skeletonize(ink > .5); dt = ndi.distance_transform_edt(ink > .5)
    stroke = 2 * float(np.median(dt[sk])) * k                     # current stroke width after resizing
    small = np.asarray(Image.fromarray((ink * 255).astype(np.uint8)).resize((round(ink.shape[1] * k), round(ink.shape[0] * k)), Image.LANCZOS)).astype(np.float32) / 255
    r = max(0, (PEN * SS - stroke) / 2)
    if r >= .5: small = ndi.grey_dilation(small, footprint=disk(int(round(r))))
    a = ndi.gaussian_filter(small, .6)
    rgba = np.dstack([np.full(a.shape + (3,), 255, np.uint8), (np.clip(a, 0, 1) * 255).astype(np.uint8)])
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, f"line_{name}.png"))
    print(f"line_{name}: {rgba.shape[1]}x{rgba.shape[0]}, stroke {stroke:.1f} → {PEN * SS:.1f} (r={r:.1f})")

def real_icon(c, name, size):
    a = c[..., 3] / 255
    lab, n = ndi.label(a > .5)                                    # keep the object (and its sizeable parts)
    if n > 1:
        sizes = ndi.sum(a > .5, lab, range(1, n + 1)); keep = np.isin(lab, 1 + np.nonzero(sizes > sizes.max() * .02)[0])
        a = a * ndi.binary_dilation(keep, iterations=4)
    y0, y1, x0, x1 = bbox(a > .05, 12)
    rgba = np.dstack([c[..., :3], a[..., None] * 255])[y0:y1, x0:x1].astype(np.uint8)
    k = size * SS / max(rgba.shape[:2])
    im = Image.fromarray(rgba, "RGBA").resize((round(rgba.shape[1] * k), round(rgba.shape[0] * k)), Image.LANCZOS)
    im.save(os.path.join(OUT, f"real_{name}.png"))
    print(f"real_{name}: {im.size[0]}x{im.size[1]}")

la, lb, ra, rb = sys.argv[1:5]
for sheet, spec in ((la, LINE[0]), (lb, LINE[1])):
    for q, c in enumerate(cells(sheet)): line_icon(c, spec[q * 2], spec[q * 2 + 1])
for sheet, spec in ((ra, REAL[0]), (rb, REAL[1])):
    for q, c in enumerate(cells(sheet, "RGBA")): real_icon(c, spec[q * 2], spec[q * 2 + 1])
