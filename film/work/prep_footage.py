"""Extract the Higgsfield AI clips to frames and composite Mehad UI screenshots into the green screens.
Output: engine/assets/footage/<id>/NNN.jpg (source frame rate 24fps, 1364x768)."""
import subprocess, sys, os, glob
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from concurrent.futures import ProcessPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = {k: Image.open(f"{ROOT}/engine/assets/{k}.jpg").convert("RGB") for k in
      ["ui-request-tutor", "ui-attendance", "ui-booking-success", "ui-child-mgmt"]}
# clip id -> (source file, UI screens by area rank, blur px, screen brightness)
CLIPS = {
    "s04": ("s04_office", ["ui-request-tutor", "ui-attendance", "ui-booking-success", "ui-child-mgmt"], 3.0, .48),
    "s07": ("s07_hands", ["ui-booking-success"], 7.0, .8),
    "s15": ("s15_student", ["BACK"], 0.8, 1.0),   # we see the back of the tablet
    "s16": ("s16_teacher", ["ui-attendance"], 1.2, .9),
    "s17": ("s17_parent", ["ui-child-mgmt"], 1.0, .9),
    "s19": ("s19_skyline", [], 0, 1),
}


def cover(img, w, h):
    iw, ih = img.size; s = max(w / iw, h / ih)
    im = img.resize((max(1, round(iw * s)), max(1, round(ih * s))), Image.LANCZOS)
    x = (im.width - w) // 2; y = 0 if im.height > h else (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def device_back(w, h):
    """matte graphite back of a tablet, lit by the window on the right, with a small camera module"""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    base = np.array([52, 50, 48], np.float32)
    light = 0.75 + 0.45 * (xx / max(w - 1, 1)) ** 1.5 + 0.12 * (1 - yy / max(h - 1, 1))
    sheen = 0.10 * np.exp(-((xx / w - 0.72) * 5) ** 2)
    img = base[None, None] * light[..., None] + 255 * sheen[..., None] * np.array([1.0, .9, .75])
    cxm, cym, r = w * 0.12, h * 0.14, max(4, min(w, h) * 0.045)
    d = np.hypot(xx - cxm, yy - cym)
    img[d < r * 1.35] = img[d < r * 1.35] * .7 + 22
    img[d < r] = [18, 18, 20]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))


def comp(args):
    src, dst, screens, blur, bright = args
    im = Image.open(src).convert("RGB"); a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    gr = g - np.maximum(r, b)
    if screens:
        lab, n = ndimage.label(gr > 45)
        comps = []
        for i, sl in enumerate(ndimage.find_objects(lab), 1):
            area = int((lab[sl] == i).sum())
            if area > 900: comps.append((area, sl))
        comps.sort(key=lambda c: -c[0])
        alpha = np.clip((gr - 25) / 55, 0, 1)
        alpha = ndimage.gaussian_filter(alpha, .8)
        fillimg = np.zeros_like(a)
        for k, (area, sl) in enumerate(comps):
            y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
            ui = device_back(x1 - x0, y1 - y0) if screens[0] == "BACK" else cover(UI[screens[k % len(screens)]], x1 - x0, y1 - y0)
            if blur: ui = ui.filter(ImageFilter.GaussianBlur(blur))
            fillimg[y0:y1, x0:x1] = np.asarray(ui).astype(np.float32) * bright
        # despill the edges
        spill = np.clip(gr, 0, None) * (1 - alpha)
        a[..., 1] -= spill * .85
        out = a * (1 - alpha[..., None]) + fillimg * alpha[..., None]
    else:
        out = a
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst, quality=90)


def main():
    jobs = []
    for cid, (fname, screens, blur, bright) in CLIPS.items():
        raw = f"{ROOT}/work/raw/{cid}"; out = f"{ROOT}/engine/assets/footage/{cid}"
        os.makedirs(raw, exist_ok=True); os.makedirs(out, exist_ok=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f"{ROOT}/src/clips/{fname}.mp4", "-q:v", "2", f"{raw}/%03d.jpg"], check=True)
        for f in sorted(glob.glob(f"{raw}/*.jpg")):
            jobs.append((f, f"{out}/{os.path.basename(f)}", screens, blur, bright))
    with ProcessPoolExecutor(4) as ex: list(ex.map(comp, jobs, chunksize=8))
    print("frames", len(jobs))


if __name__ == "__main__":
    main()
