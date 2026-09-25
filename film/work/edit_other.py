"""Apply the review edits to the video from the other chat (src/other/other_chat.mp4), frame-accurately.
 1. 26.0–30.0  remove the second knot/logo and the check mark → clean homepage plate (brightness ramp kept)
 2. 43.0–48.56 replace the diagonal line with a thread that climbs the fabric step by step, then lifts to the lens
 3. 61.0–62.0  remove the line leaving the Mehad logo
 4. 62.0–67.5  the boy looks at the tablet → we see the back of the tablet, not the UI
Output: out/Mehad-OtherChat-edited.mp4 (audio copied)."""
import subprocess, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = f"{ROOT}/src/other/other_chat.mp4"
OUT = f"{ROOT}/out/Mehad-OtherChat-edited.mp4"
W, H, FPS = 1920, 1080, 25


def grab(t):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", str(t), "-i", SRC, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(np.float32)


# ---------- 1. homepage plate ----------
HOME = np.asarray(Image.open(f"{ROOT}/work/oc_plate_home.png").convert("RGB"), np.float32)
HGAIN = np.load(f"{ROOT}/work/oc_home_gain.npy")          # per-frame, per-channel (frames 650..749)

# ---------- 2. stairs on the textile ----------
TEX = np.asarray(Image.open(f"{ROOT}/work/oc_plate_textile.png").convert("RGB"), np.float32)
CELL, PX, PY = 40.5, 27.0, 32.5                           # checker cell and grid phase measured on the plate
cc = lambda col, row: (PX + CELL / 2 + col * CELL, PY + CELL / 2 + row * CELL)
V = [(48, 20), (36, 20)]
for k in range(1, 7):
    V.append((36 - 4 * k, 20 - 2 * (k - 1))); V.append((36 - 4 * k, 20 - 2 * k))
VP = [cc(*v) for v in V]
# the thread lands a step on the words (VO in this video: «بخطوة» 44.0, «جديدة» 44.5, «خطوة» ~46.0, «اسمها» 46.4)
KEYS = [(43.0, 0), (43.5, 1), (43.85, 2), (44.3, 3), (44.5, 4), (44.85, 5), (45.05, 6), (45.35, 7), (45.55, 8), (45.8, 9), (46.0, 10), (46.25, 11), (46.5, 12), (46.8, 13)]
TEAL, TEAL2, CORE = np.array([23, 165, 155.]), np.array([43, 212, 197.]), np.array([225, 255, 251.])
SEGL = [np.hypot(VP[i + 1][0] - VP[i][0], VP[i + 1][1] - VP[i][1]) for i in range(len(VP) - 1)]
CUM = np.concatenate([[0], np.cumsum(SEGL)])


def eio(x): x = min(max(x, 0), 1); return 4 * x ** 3 if x < .5 else 1 - (-2 * x + 2) ** 3 / 2


def head_s(t):
    if t <= KEYS[0][0]: return 0.0
    for (t0, i0), (t1, i1) in zip(KEYS, KEYS[1:]):
        if t < t1: return CUM[i0] + (CUM[i1] - CUM[i0]) * eio((t - t0) / (t1 - t0))
    return CUM[-1]


def pt_at(s):
    i = int(np.searchsorted(CUM, s, side="right") - 1); i = min(max(i, 0), len(SEGL) - 1)
    f = (s - CUM[i]) / SEGL[i]; a, b = VP[i], VP[i + 1]
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)


def path_to(s):
    pts = [VP[0]]; i = 0
    while i < len(SEGL) and CUM[i + 1] <= s: pts.append(VP[i + 1]); i += 1
    pts.append(pt_at(s)); return pts


def glow_layer(draw_fn, sigmas=((3, .9), (10, .55), (26, .35))):
    """draw a white mask at half-res, return additive glow intensity map (H, W)"""
    m = Image.new("L", (W // 2, H // 2), 0); draw_fn(ImageDraw.Draw(m), .5)
    a = np.asarray(m, np.float32) / 255; g = np.zeros_like(a)
    for s, w in sigmas: g += ndimage.gaussian_filter(a, s) * w
    g = np.asarray(Image.fromarray(np.clip(g * 255, 0, 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), np.float32) / 255
    return g


def stairs(t, orig=None):
    # the original textile is clean (and still fading in) until its line appears at ~44.2 — use it until then
    img = orig.copy() if (orig is not None and t < 44.2) else TEX.copy()
    s = head_s(t)
    # cells passed by the thread are woven turquoise
    d = 0.0
    while d < s:
        x, y = pt_at(d); col = round((x - PX - CELL / 2) / CELL); row = round((y - PY - CELL / 2) / CELL)
        q = min(1, (s - d) / (CELL * 3)); a = .45 + .5 * q
        x0, y0 = int(PX + col * CELL + 3), int(PY + row * CELL + 3); x1, y1 = int(x0 + CELL - 6), int(y0 + CELL - 6)
        if 0 <= x0 < W and 0 <= y0 < H:
            shade = np.linspace(1.12, .88, max(1, y1 - y0))[:, None, None]
            img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - a) + (TEAL * shade) * a
        d += CELL
    pts = path_to(s)
    lift = min(max((t - 47.0) / 1.45, 0), 1)
    line_w = 3.0
    def dr(dd, k):
        if len(pts) > 1: dd.line([(x * k, y * k) for x, y in pts], fill=255, width=max(1, int(line_w * k * 2)), joint="curve")
    g = glow_layer(dr)
    img += g[..., None] * TEAL2 * .9
    core = glow_layer(dr, sigmas=((.6, 1.0),))
    img = img * (1 - core[..., None] * .8) + CORE * core[..., None] * .8
    hx, hy = pts[-1]
    yy, xx = np.ogrid[:H, :W]
    if lift <= 0:
        r = np.hypot(xx - hx, yy - hy); img += (np.exp(-(r / 22) ** 2) * 1.0)[..., None] * CORE * .9 + (np.exp(-(r / 70) ** 2) * .4)[..., None] * TEAL2
    # a soft ring of light on each landing
    for tk, idx in KEYS:
        if idx >= 3 and idx % 2 == 1:
            q = (t - tk) / .55
            if 0 < q < 1:
                lx, ly = VP[idx]; r = np.hypot(xx - lx, yy - ly)
                img += (np.exp(-((r - 20 - 70 * q) / 10) ** 2) * .5 * (1 - q))[..., None] * TEAL2
    # lift from the top step toward the lens, then the flash that meets the original cut to black
    if lift > 0:
        e = lift ** 2; top = VP[-1]; tip = (top[0] + (960 - top[0]) * eio(lift), top[1] + (500 - top[1]) * eio(lift))
        c1 = (top[0] - 50, top[1] - 90); c2 = (top[0] + (tip[0] - top[0]) * .5, tip[1] - 80 * (1 - e))
        bz = [((1 - u) ** 3 * top[0] + 3 * (1 - u) ** 2 * u * c1[0] + 3 * (1 - u) * u * u * c2[0] + u ** 3 * tip[0],
               (1 - u) ** 3 * top[1] + 3 * (1 - u) ** 2 * u * c1[1] + 3 * (1 - u) * u * u * c2[1] + u ** 3 * tip[1]) for u in np.linspace(0, 1, 40)]
        wl = 3 + e * 26
        g2 = glow_layer(lambda dd, k: dd.line([(x * k, y * k) for x, y in bz], fill=255, width=max(1, int(wl * k)), joint="curve"))
        img += g2[..., None] * TEAL2 * (1 + e)
        r = np.hypot(xx - tip[0], yy - tip[1]); R = 40 + e * 1500
        img += (np.exp(-(r / (R * .35)) ** 2))[..., None] * CORE * (.6 + .6 * e) + (np.exp(-(r / R) ** 2) * (.3 + .9 * e))[..., None] * TEAL2
    # final flash (the original reaches ~mean 126 by 48.36, then cuts to black at 48.56)
    fl = min(max((t - 48.0) / .36, 0), 1)
    if fl > 0:
        r = np.hypot(xx - 960, yy - 500); rad = np.exp(-(r / 900) ** 2)[..., None]
        target = TEAL * .55 + (CORE - TEAL * .55) * rad
        img = img * (1 - fl * .85) + target * fl * .85
    return img


# ---------- 3. line leaving the logo ----------
REF_LOGO = grab(60.84)

# ---------- 4. back of the tablet ----------
def device_back(w, h):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    base = np.array([50, 47, 44], np.float32)
    light = 0.72 + 0.5 * (xx / max(w - 1, 1)) ** 1.5 + 0.12 * (1 - yy / max(h - 1, 1))
    sheen = 0.09 * np.exp(-((xx / w - 0.72) * 5) ** 2)
    img = base[None, None] * light[..., None] + 255 * sheen[..., None] * np.array([1.0, .9, .75])
    cxm, cym, r = w * 0.12, h * 0.14, max(4, min(w, h) * 0.045)
    d = np.hypot(xx - cxm, yy - cym); img[d < r * 1.35] = img[d < r * 1.35] * .7 + 22; img[d < r] = [18, 18, 20]
    return np.asarray(Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float32)


def tablet(frame, t):
    k = min(140, max(0, round((t - 62.0) * 24)))
    raw = np.asarray(Image.open(f"{ROOT}/work/raw/s15/{k + 1:03d}.jpg").convert("RGB").resize((W, H), Image.BILINEAR), np.float32)
    gr = raw[..., 1] - np.maximum(raw[..., 0], raw[..., 2])
    lab, n = ndimage.label(gr > 45)
    if n == 0: return frame
    sizes = ndimage.sum(np.ones_like(gr), lab, range(1, n + 1)); big = int(np.argmax(sizes)) + 1
    m = ndimage.binary_dilation(lab == big, iterations=3)
    a = ndimage.gaussian_filter(m.astype(np.float32), 1.2)
    ys, xs = np.where(m); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    back = np.zeros_like(frame); back[y0:y1, x0:x1] = device_back(x1 - x0, y1 - y0)
    return frame * (1 - a[..., None]) + back * a[..., None]


def main():
    dec = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-i", SRC, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-i", SRC, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
                            "-c:a", "copy", "-shortest", "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
    n = 0; fb = W * H * 3
    while True:
        buf = dec.stdout.read(fb)
        if len(buf) < fb: break
        t = n / FPS
        if 650 <= n < 750 or 1075 <= n < 1214 or 1525 <= n < 1550 or 1550 <= n < 1688:
            f = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32)
            if 650 <= n < 750:
                f = HOME * HGAIN[n - 650][None, None, :]
            elif 1075 <= n < 1214:
                f = stairs(t, f)
            elif 1525 <= n < 1550:
                line = ((f[..., 1] - f[..., 0]) > 25); line[:, 430:] = False; line[:, :] &= True
                line = ndimage.binary_dilation(line, iterations=2)
                f[line] = REF_LOGO[line]
            else:
                f = tablet(f, t)
            buf = np.clip(f, 0, 255).astype(np.uint8).tobytes()
        enc.stdin.write(buf); n += 1
        if n % 250 == 0: print("frame", n, flush=True)
    enc.stdin.close(); enc.wait(); dec.wait(); print("done", n, "frames ->", OUT)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "preview":
        for t in [26.5, 29.4, 43.6, 44.4, 45.4, 46.3, 46.9, 47.5, 48.1, 48.4, 61.6, 63.0, 66.0]:
            n = round(t * FPS); f = grab(t)
            if 650 <= n < 750: f = HOME * HGAIN[n - 650][None, None, :]
            elif 1075 <= n < 1214: f = stairs(t, f)
            elif 1525 <= n < 1550:
                line = ((f[..., 1] - f[..., 0]) > 25); line[:, 430:] = False
                line = ndimage.binary_dilation(line, iterations=2); f[line] = REF_LOGO[line]
            elif 1550 <= n < 1688: f = tablet(f, t)
            Image.fromarray(np.clip(f, 0, 255).astype(np.uint8)).resize((640, 360)).save(f"{ROOT}/out/oc_prev_{t:05.1f}.jpg")
        print("preview ok")
    else:
        main()
