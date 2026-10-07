"""Sound design for a logo sting, synthesised from the animation's own cue sheet.

The reference sting is silent, so the sound follows its structure instead:
  build-up  — a soft paper tick on every flash over a low, slowly opening air bed
  reveal    — one whoosh that tracks the mark's speed and position, a low bloom as the
              colour floods in, three soft mallet notes for the counters, pen-on-paper hiss
  lockup    — the impact lands on the frame the logo completes, then a warm chord rings
              out and is gone before the last frame (clean end)

usage: python3 tools/sound.py out/<brand>_cues.json out/<brand>.wav
The cue sheet's "style" picks the palette: paper (Mehad) or digital (AIM, blips + scan sweep, E add9).
"""
import json, sys
import numpy as np
from scipy import signal

SR = 48000
cues = json.load(open(sys.argv[1]))
STYLE = cues.get("style", "paper")              # paper (Mehad) · digital (AIM)
N = int(cues["dur"] * SR)
rng = np.random.default_rng(7)
mix = np.zeros((N, 2))

def db(x): return 10 ** (x / 20)
def place(sig, t, gain_db=0.0, pan=0.0):
    """add a mono or stereo signal at time t (s) with equal-power pan"""
    i = int(round(t * SR))
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(a), sig * np.sin(a)], 1) * np.sqrt(2)
    n = min(len(sig), N - i)
    if n > 0: mix[i:i + n] += sig[:n] * db(gain_db)
def tt(d): return np.arange(int(d * SR)) / SR
def bp(x, lo, hi, order=2): return signal.sosfilt(signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)
def lp(x, f, order=2): return signal.sosfilt(signal.butter(order, f, "lowpass", fs=SR, output="sos"), x)
def hp(x, f, order=2): return signal.sosfilt(signal.butter(order, f, "highpass", fs=SR, output="sos"), x)
def norm(x): return x / (np.abs(x).max() + 1e-12)

# --- build-up: ticks + air bed --------------------------------------------------
for k, t0 in enumerate(cues["flashes"][:-1]):
    t = tt(.05)
    click = bp(rng.standard_normal(len(t)), 1800, 6500) * np.exp(-t / .004)
    tone = np.sin(2 * np.pi * rng.uniform(1900, 2600) * t) * np.exp(-t / .007) * .35
    if STYLE == "digital":                          # short clean blips instead of paper
        click *= .25; tone = np.sin(2 * np.pi * rng.choice([2637.0, 3136.0, 3520.0]) * t) * np.exp(-t / .012)
    place(norm(click + tone), t0, -27 + rng.uniform(-2, 1.5), pan=.14 * (-1) ** k)
t = tt(cues["glide"][0] + .1)
f, frames, Z = signal.stft(rng.standard_normal(len(t)), SR, nperseg=2048)
cut = 250 + 1500 * (frames / t[-1]) ** 2                  # the bed opens up as the flicker runs
Z /= np.sqrt(1 + (f[:, None] / cut[None]) ** 4)
bed = signal.istft(Z, SR, nperseg=2048)[1][:len(t)]
bed *= np.minimum(1, t / .3) * (.35 + .65 * (t / t[-1]) ** 2) * np.minimum(1, (t[-1] - t) / .1)
place(np.stack([bed, np.roll(bed, 517)], 1) / np.abs(bed).max(), 0, -33)

# --- reveal: whoosh following the glide's velocity -------------------------------
g0, g1 = cues["glide"]
t = tt(g1 - g0 + .25); u = np.clip(t / (g1 - g0), 0, 1)
pos = np.where(u < .5, 16 * u ** 5, 1 - (-2 * u + 2) ** 5 / 2)        # inOutQuint, as on screen
vel = np.gradient(pos, t); vel = vel / vel.max()
f, frames, Z = signal.stft(rng.standard_normal(len(t)), SR, nperseg=1024)
vf = np.interp(frames, t, vel)
fc = 250 + 2300 * vf
Z *= np.exp(-.5 * (np.log(f[:, None] + 1) - np.log(fc[None] + 1)) ** 2 / .55 ** 2) * (vf[None] ** 1.3 + .02)
whoosh = signal.istft(Z, SR, nperseg=1024)[1][:len(t)]
place(norm(whoosh) * np.minimum(1, (t[-1] - t) / .15), g0, -13, pan=cues["glidePan"][1] * .6)

# colour flood: low bloom
t = tt(1.2)
sub = np.sin(2 * np.pi * np.cumsum(48 + 34 * np.exp(-t / .09)) / SR) * np.exp(-t / .38) * np.minimum(1, t / .012)
puff = lp(rng.standard_normal(len(t)), 420) * np.exp(-t / .16) * np.minimum(1, t / .02)
place(norm(sub + .5 * norm(puff)), cues["flood"], -15, pan=cues["glidePan"][1] * .5)

# counters: soft mallet notes, right → left, descending (A5 F#5 D5); digital: one FM ping (B5)
notes = [987.77] if STYLE == "digital" else [880.0, 739.99, 587.33]
for c, f0 in zip(cues["fills"], notes):
    t = tt(1.0)
    if STYLE == "digital":
        note = np.sin(2 * np.pi * f0 * t + 1.2 * np.exp(-t / .08) * np.sin(2 * np.pi * f0 * 2 * t)) * np.exp(-t / .45) * np.minimum(1, t / .004)
    else:
        note = (np.sin(2 * np.pi * f0 * t) + .18 * np.sin(2 * np.pi * f0 * 3.98 * t) * np.exp(-t / .05)) * np.exp(-t / .32) * np.minimum(1, t / .003)
    place(note, c["t"], -27, pan=c["pan"] * .7)

# scan beam (digital): a quiet airy sweep that travels with the beam, left → right
if cues.get("scan"):
    a, b = cues["scan"]; t = tt(b - a); u = t / t[-1]
    pos = np.where(u < .5, 4 * u ** 3, 1 - (-2 * u + 2) ** 3 / 2)
    f, frames, Z = signal.stft(rng.standard_normal(len(t)), SR, nperseg=1024)
    fc = 1500 + 4500 * np.interp(frames, t, pos)
    Z *= np.exp(-.5 * (np.log(f[:, None] + 1) - np.log(fc[None] + 1)) ** 2 / .25 ** 2)
    sweep = norm(signal.istft(Z, SR, nperseg=1024)[1][:len(t)]) * np.sin(np.pi * u) ** .7
    for k, pn in enumerate(np.linspace(-.6, .6, 8)):          # pan follows the beam
        seg_ = slice(k * len(t) // 8, (k + 1) * len(t) // 8); piece = np.zeros_like(sweep); piece[seg_] = sweep[seg_]
        place(piece, a, -30, pan=pn)

# pen on paper while the wordmarks write
for (a, b), lvl in [(w, l) for w, l in [(cues.get("write"), -36), (cues.get("write2"), -38)] if w]:
    t = tt(b - a); u = t / t[-1]
    speed = np.sin(np.pi * u) ** 1.5
    hiss = bp(rng.standard_normal(len(t)), 2500, 9000) * speed * (.7 + .3 * np.abs(np.sin(2 * np.pi * 11 * t)))
    place(norm(hiss), a, lvl, pan=-.25)

# --- lockup impact ------------------------------------------------------------------
L0 = cues["lock"]; t = tt(cues["dur"] - L0)
fade = np.clip((cues["dur"] - .25 - L0 - t) / 1.2, 0, 1) ** 2         # silent before the last frame
sub = np.sin(2 * np.pi * np.cumsum(52 + 43 * np.exp(-t / .06)) / SR) * np.exp(-t / .55) * np.minimum(1, t / .004)
click = lp(rng.standard_normal(len(t)), 3500) * np.exp(-t / .006)
place((norm(sub) + .22 * norm(click)) * fade, L0, -7)
chord = np.zeros((len(t), 2))
VOICING = {"paper": [(146.83, 1), (220.0, .8), (293.66, .7), (369.99, .55), (440.0, .45), (659.26, .3)],            # D add9
           "digital": [(164.81, 1), (246.94, .8), (329.63, .7), (369.99, .5), (415.30, .5), (493.88, .4), (739.99, .3)]}  # E add9
for f0, amp in VOICING[STYLE]:
    for ch, cents in [(0, -3), (1, 3)]:
        ff = f0 * 2 ** (cents / 1200)
        chord[:, ch] += amp * (np.sin(2 * np.pi * ff * t) + .25 * np.sin(2 * np.pi * 2 * ff * t) * np.exp(-t / .4))
chord *= (np.exp(-t / 1.5) * np.minimum(1, t / .025))[:, None]
chord = np.stack([lp(chord[:, 0], 3800), lp(chord[:, 1], 3800)], 1)
place(chord / np.abs(chord).max() * fade[:, None], L0, -16)
fb = 1318.51 if STYLE == "digital" else 1174.66
vib = .002 * np.sin(2 * np.pi * 5 * t) if STYLE == "digital" else 0
bell = (np.sin(2 * np.pi * fb * t * (1 + vib)) + .4 * np.sin(2 * np.pi * 2 * fb * t) * np.exp(-t / .3)) * np.exp(-t / 1.0) * np.minimum(1, t / .002)
place(bell * fade, L0 + .01, -31, pan=.2)

# --- shared room: short synthetic reverb on everything --------------------------------
ir_t = tt(2.2)
ir = np.stack([lp(rng.standard_normal(len(ir_t)), 5000) * np.exp(-ir_t / .45) for _ in range(2)], 1)
ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([signal.fftconvolve(mix[:, c], ir[:, c])[:N] for c in range(2)], 1)
out = mix + wet * db(-11)
out[-int(.05 * SR):] *= np.linspace(1, 0, int(.05 * SR))[:, None]
out = hp(out.T, 25).T
out *= db(-1.0) / np.abs(out).max()

from scipy.io import wavfile
wavfile.write(sys.argv[2], SR, (out * (2 ** 31 - 1)).astype(np.int32))
print("wrote", sys.argv[2], f"{cues['dur']}s peak -1.0 dBFS")
