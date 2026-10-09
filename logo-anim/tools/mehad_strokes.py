"""Write-on paths for the Mehad wordmark, in lockup_source.webp pixel coordinates.

Arabic «مهاد»: the centre-lines traced for the launch film (film/work/logo_strands.json,
wordmark.png coordinates) mapped onto the high-res source with a fitted scale/offset
(see the fit printed below: the path stays on the stroke's medial axis).
MEHAD: centre-lines read off the letter skeletons (stroke 32px).
The paths only drive reveal masks over the official pixels; they are never drawn.
"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src = json.load(open("../film/work/logo_strands.json"))
S, OX, OY = 2.225, 0.0, 0.5
ar = {k: [[round(x * S + OX, 1), round(y * S + OY, 1)] for x, y in src[k]["pts"]][::2] for k in ["meem", "knot", "alef", "dal"]}

def arc(cx, cy, rx, ry, a0, a1, n=24):
    return [[round(cx + rx * np.cos(a), 1), round(cy + ry * np.sin(a), 1)] for a in np.linspace(a0, a1, n)]

valley = arc(132.5, 541, 38, 32, np.pi * .93, np.pi * .07)      # rounded bottom of the M
en = {
    "M": [[[32, 688], [33, 459]] + [[33, 459]] + [[95, 556]] + valley[3:-3] + [[170, 556], [231, 459], [231, 688]]],
    "E": [[[427, 457], [300, 457], [300, 688], [428, 688]], [[300, 572], [409, 572]]],
    "H": [[[499, 457], [499, 687]], [[655, 457], [655, 687]], [[499, 572], [655, 572]]],
    "A": [[[724, 688], [811, 460], [900, 688]], [[755, 621], [867, 621]]],
    "D": [[[968, 457], [968, 687], [1040, 687]] + arc(1040, 572, 98, 115, np.pi / 2, -np.pi / 2) + [[968, 457]]],
}

# sanity: every path point should sit inside its layer's ink
for name, layer, paths in [("ar", "wordmark_ar.png", list(ar.values())), ("en", "wordmark_en.png", [p for l in en.values() for p in l])]:
    a = np.array(Image.open("assets/mehad/" + layer))[..., 3] > 127
    dt = ndi.distance_transform_edt(a)
    v = np.array([dt[int(round(y)), int(round(x))] for p in paths for x, y in p])
    print(f"{name}: {len(v)} pts, depth inside stroke min {v.min():.1f} median {np.median(v):.1f}")

json.dump({"ar": ar, "ar_order": ["meem", "knot", "alef", "dal"], "ar_width": 30, "en": en, "en_width": 32},
          open("assets/mehad/strokes.json", "w"))
