"""Event-driven sound design for the idea stings (mash · risk · kapsul).

Each sting exports a cue list ({"dur", "events": [{"type", "t", ...}]}) from the same
timeline that drives the picture, so every sound lands on its frame. Synthesised
(no samples): pencil scratch, marker squeak, zip, whoosh, impact (paper / digital
chord), pop, tumble clicks, thud, glitch, riser, 3D spin, paper flutter, swell, type.

usage: python3 tools/sound2.py out/<name>_cues.json out/<name>.wav
"""
import json, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
cues = json.load(open(sys.argv[1]))
N = int(cues["dur"] * SR)
rng = np.random.default_rng(23)
mix = np.zeros((N + SR, 2))

def db(x): return 10 ** (x / 20)
def tt(d): return np.arange(max(1, int(d * SR))) / SR
def norm(x): return x / (np.abs(x).max() + 1e-12)
def bp(x, lo, hi, o=2): return signal.sosfilt(signal.butter(o, [lo, hi], "bandpass", fs=SR, output="sos"), x)
def lp(x, f, o=2): return signal.sosfilt(signal.butter(o, f, "lowpass", fs=SR, output="sos"), x)
def hp(x, f, o=2): return signal.sosfilt(signal.butter(o, f, "highpass", fs=SR, output="sos"), x)
def place(sig, t, gain=0.0, pan=0.0):
    i = int(round(t * SR))
    if i < 0: sig, i = sig[-i:], 0
    if sig.ndim == 1:
        a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(a), sig * np.sin(a)], 1) * np.sqrt(2)
    n = min(len(sig), len(mix) - i)
    if n > 0: mix[i:i + n] += sig[:n] * db(gain)
def shaped(n, fc, width, nper=1024):
    f, fr, Z = signal.stft(rng.standard_normal(n), SR, nperseg=nper)
    c = fc(fr) if callable(fc) else np.full(len(fr), fc)
    Z *= np.exp(-.5 * (np.log(f[:, None] + 1) - np.log(c[None] + 1)) ** 2 / width ** 2)
    return norm(signal.istft(Z, SR, nperseg=nper)[1][:n])
def panned(sig, t, gain, p0, p1, parts=10):
    for k, pn in enumerate(np.linspace(p0, p1, parts)):
        sl = slice(k * len(sig) // parts, (k + 1) * len(sig) // parts); piece = np.zeros_like(sig); piece[sl] = sig[sl]
        place(piece, t, gain, pn)

def scratch(e):
    t = tt(.075); grain = np.repeat(rng.uniform(.3, 1, len(t) // 60 + 1), 60)[:len(t)]
    s = bp(rng.standard_normal(len(t)), 2200, 7500) * grain * np.minimum(1, t / .006) * np.exp(-t / .045)
    place(norm(s), e["t"], e.get("level", -28) + rng.uniform(-2, 2), pan=rng.uniform(-.3, .3))
def squeak(e):
    t = tt(e.get("d", .16)); f0 = rng.uniform(1700, 2300)
    tone = np.sin(2 * np.pi * np.cumsum(f0 * (1 + .03 * np.sin(2 * np.pi * 9 * t))) / SR)
    s = (.5 * tone + .5 * bp(rng.standard_normal(len(t)), 1200, 3800)) * np.minimum(1, t / .02) * np.minimum(1, (t[-1] - t) / .04)
    place(norm(s), e["t"], -31, pan=rng.uniform(-.4, .4))
def zip_(e):
    t = tt(.14); u = t / t[-1]
    place(shaped(len(t), lambda fr: 800 + 5000 * np.interp(fr, t, u), .35) * np.sin(np.pi * u) ** .5, e["t"], -21)
def whoosh(e):
    t = tt(e["d"]); u = t / t[-1]; vel = np.sin(np.pi * u) ** 1.2
    lo, hi = e.get("fc", [250, 2500])
    s = shaped(len(t), lambda fr: lo + (hi - lo) * np.interp(fr, t, vel), .5) * (vel ** 1.3 + .01)
    p = e.get("pan", [0, 0]); panned(s, e["t"], e.get("level", -15), p[0], p[1])
VOICING = {"paper": [(146.83, 1), (220.0, .8), (293.66, .7), (369.99, .55), (440.0, .45), (659.26, .3)],
           "digital": [(164.81, 1), (246.94, .8), (329.63, .7), (369.99, .5), (415.30, .5), (493.88, .4), (739.99, .3)]}
def impact(e):
    L0 = e["t"]; tail = e.get("tail", cues["dur"] - L0); t = tt(cues["dur"] - L0 + .01)
    fade = np.clip((tail - .25 - t) / 1.2, 0, 1) ** 2
    sub = np.sin(2 * np.pi * np.cumsum(52 + 43 * np.exp(-t / .06)) / SR) * np.exp(-t / .55) * np.minimum(1, t / .004)
    click = lp(rng.standard_normal(len(t)), 3500) * np.exp(-t / .006)
    place((norm(sub) + .22 * norm(click)) * fade, L0, -7)
    ch = np.zeros((len(t), 2))
    for f0, amp in VOICING[e.get("style", "paper")]:
        for c, cents in [(0, -3), (1, 3)]:
            ff = f0 * 2 ** (cents / 1200)
            ch[:, c] += amp * (np.sin(2 * np.pi * ff * t) + .25 * np.sin(2 * np.pi * 2 * ff * t) * np.exp(-t / .4))
    ch *= (np.exp(-t / 1.5) * np.minimum(1, t / .025) * fade)[:, None]
    ch = np.stack([lp(ch[:, 0], 3800), lp(ch[:, 1], 3800)], 1)
    place(ch / np.abs(ch).max(), L0, -16)
def pop(e):
    t = tt(.09)
    s = np.sin(2 * np.pi * np.cumsum(320 + 700 * np.exp(-t / .012)) / SR) * np.exp(-t / .03) + .3 * bp(rng.standard_normal(len(t)), 2000, 6000) * np.exp(-t / .004)
    place(norm(s), e["t"], -25, pan=e.get("pan", 0))
def clicks(e):
    n, d = e.get("n", 6), e["d"]; t = tt(d + .2); out = np.zeros(len(t))
    times = d * (1 - (1 - np.linspace(0, 1, n) ** 1.0) ** 1.6) * .92
    for k, tc in enumerate(times):
        tk = tt(.06); f0 = rng.uniform(900, 1500)
        c = bp(rng.standard_normal(len(tk)), 2000, 8000) * np.exp(-tk / .003) + .6 * np.sin(2 * np.pi * f0 * tk) * np.exp(-tk / .025)
        i = int(tc * SR); out[i:i + len(tk)] += c[:len(out) - i] * (.6 + .4 * k / n)
    if e.get("rev"): out = out[::-1]
    place(norm(out), e["t"], -24, pan=rng.uniform(-.3, .3))
def thud(e):
    t = tt(.4)
    s = np.sin(2 * np.pi * np.cumsum(50 + 40 * np.exp(-t / .04)) / SR) * np.exp(-t / .12) + .4 * lp(rng.standard_normal(len(t)), 300) * np.exp(-t / .05)
    place(norm(s), e["t"], -14)
def glitch(e):
    d = e["d"]; t = tt(d); out = np.zeros(len(t)); i = 0
    while i < len(t):
        L = int(rng.uniform(.012, .045) * SR); seg_t = np.arange(L) / SR; u = i / len(t)
        f0 = rng.choice([220, 330, 440, 660, 880, 1320]) * rng.uniform(.9, 1.1)
        g = np.sin(2 * np.pi * f0 * seg_t + rng.uniform(2, 6) * np.sin(2 * np.pi * f0 * rng.choice([.5, 1.5, 2.01]) * seg_t))
        g = np.round(g * 6) / 6                                              # a little bit-crush
        if rng.random() < .35: g = bp(rng.standard_normal(L), 600, 5000)
        g *= np.hanning(L) * (1 - u) ** 1.2 * (rng.random() > .2)
        out[i:i + L] += g[:len(out) - i]; i += L
    if e.get("rev"): out = out[::-1]
    place(norm(out), e["t"], e.get("level", -27), pan=e.get("pan", 0))
def riser(e):
    t = tt(e["d"]); u = t / t[-1]
    s = shaped(len(t), lambda fr: 400 + 5000 * np.interp(fr, t, u ** 2), .45) * u ** 2.2
    s += .4 * np.sin(2 * np.pi * np.cumsum(330 * 2 ** (2 * u)) / SR) * u ** 2
    if not e.get("rev"): s = s[::-1]
    place(norm(s), e["t"], -22)
def spin(e):
    t = tt(e["d"] + .2); u = np.clip(t / e["d"], 0, 1)
    rate = 7 * (1 - u) ** 1.5 + .3
    am = .55 + .45 * np.abs(np.sin(2 * np.pi * np.cumsum(rate) / SR))
    s = shaped(len(t), lambda fr: 500 + 2200 * np.interp(fr, t, u), .45) * am * np.sin(np.pi * np.clip(u * .9 + .05, 0, 1)) ** .8
    sh = sum(np.sin(2 * np.pi * f * t + ph) for f, ph in [(2637.0, 0), (3520.0, 1.3)]) * .15 * np.sin(np.pi * u) ** 2
    place(norm(s + sh), e["t"], -18)
def flutter(e):
    t = tt(.07)
    s = bp(rng.standard_normal(len(t)), 900, 5200) * np.exp(-t / .018) * (1 + .6 * (np.sin(2 * np.pi * 70 * t) > 0))
    place(norm(s), e["t"], -27 + rng.uniform(-2, 2), pan=rng.uniform(-.2, .5))
def swell(e):
    t = tt(e["d"]); u = t / t[-1]
    s = sum(a * np.sin(2 * np.pi * f * t) for f, a in [(220, 1), (329.63, .7), (440, .5), (554.37, .35)]) * u ** 2.5
    s += .3 * shaped(len(t), 3000, .4) * u ** 3
    place(norm(s), e["t"], -26)
def type_(e):
    t = tt(.12)
    s = .7 * bp(rng.standard_normal(len(t)), 1500, 7000) * np.exp(-t / .005) + np.sin(2 * np.pi * np.cumsum(180 + 120 * np.exp(-t / .01)) / SR) * np.exp(-t / .035)
    place(norm(s), e["t"], e.get("level", -20), pan=e.get("pan", 0))

FX = {"scratch": scratch, "squeak": squeak, "zip": zip_, "whoosh": whoosh, "impact": impact, "pop": pop, "clicks": clicks,
      "thud": thud, "glitch": glitch, "riser": riser, "spin": spin, "flutter": flutter, "swell": swell, "type": type_}
for e in sorted(cues["events"], key=lambda e: e["t"]): FX[e["type"]](e)

mix = mix[:N]
ir_t = tt(2.2)
ir = np.stack([lp(rng.standard_normal(len(ir_t)), 5000) * np.exp(-ir_t / .45) for _ in range(2)], 1); ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([signal.fftconvolve(mix[:, c], ir[:, c])[:N] for c in range(2)], 1)
out = hp((mix + wet * db(-11)).T, 25).T
out[-int(.05 * SR):] *= np.linspace(1, 0, int(.05 * SR))[:, None]
# loudness: −16 LUFS for every sting, true peaks held under −1 dBFS by a soft knee
import pyloudnorm
out *= db(-16 - pyloudnorm.Meter(SR).integrated_loudness(out))
ceil = db(-1.0); k = .7 * ceil
over = np.abs(out) > k
out[over] = np.sign(out[over]) * (k + (ceil - k) * np.tanh((np.abs(out[over]) - k) / (ceil - k)))
wavfile.write(sys.argv[2], SR, (out * (2 ** 31 - 1)).astype(np.int32))
print("wrote", sys.argv[2], f"{cues['dur']}s, {len(cues['events'])} events, {pyloudnorm.Meter(SR).integrated_loudness(out):.1f} LUFS")
