"""Charcoal / marker renderings of an official logo, for the hand-drawn (Mash) stage.

Density follows the logo's own darkness (navy → dense, teal → medium, white → none),
so the sketch is the real logo drawn by hand, not a redraw. Three boil variants
(different grain and a 1–2px edge wobble) alternate at 12.5fps like stop-motion.
Also writes a paper texture for the background.

usage: python3 tools/rough.py mehad|aim
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

brand = sys.argv[1]
A = f"assets/{brand}/"
src = {"mehad": "lockup_source.webp", "aim": "logo_source.webp"}[brand]
im = np.array(Image.open(A + src).convert("RGBA")).astype(float) / 255
a = im[..., 3]; rgb = im[..., :3] * a[..., None] + (1 - a[..., None])     # on white
dark = 1 - (rgb @ [.2126, .7152, .0722])
H, W = dark.shape

def field(seed, sigma, aniso=None):
    r = np.random.default_rng(seed).standard_normal((H, W))
    f = ndi.gaussian_filter(r, sigma if aniso is None else aniso)
    return (f - f.mean()) / (f.std() + 1e-9)

for k in range(3):
    s = 100 * k + (7 if brand == "aim" else 3)
    # edge wobble: displace the density map by a smooth 1–2px field
    dx, dy = field(s, 6) * 1.6, field(s + 1, 6) * 1.6
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    d = ndi.map_coordinates(dark, [yy + dy, xx + dx], order=1, mode="nearest")
    # charcoal grain: paper tooth + diagonal marker streaks
    tooth = field(s + 2, .7) * .55 + field(s + 3, 2.5) * .35
    streak = field(s + 4, None, aniso=(1.2, 9)) * .45                 # long horizontal-ish fibres
    streak = ndi.rotate(streak, -28, reshape=False, mode="reflect")
    dens = np.clip(d * 1.55, 0, 1.2)
    ink = np.clip((dens + .16 * tooth + .14 * streak - .28) * 2.2, 0, 1)
    ink *= ndi.gaussian_filter((d > .04).astype(float), 1.2)             # only where the logo is
    o = np.zeros((H, W, 4), np.uint8); o[..., :3] = (38, 38, 40); o[..., 3] = (ink * 255).astype(np.uint8)
    Image.fromarray(o).save(A + f"rough_{k}.png"); print("rough", k)

# paper: soft fibres and tooth, used as a multiply layer on the page colour
P = 1080
r = np.random.default_rng(11)
pap = ndi.gaussian_filter(r.standard_normal((P, 1920)), 1.0) * .5 + ndi.gaussian_filter(r.standard_normal((P, 1920)), 12) * 1.4
pap = (pap - pap.min()) / (pap.max() - pap.min())
Image.fromarray((235 + 20 * pap).astype(np.uint8)).save("assets/shared/paper.png")
