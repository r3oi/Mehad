"""Temp score + sound design for the first cut of «خيطٌ واحد».
Synthesised placeholder that follows the storyboard cue map (item 7) and SFX map (item 8).
Replace with the licensed / original score and the recorded VO for the final."""
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
import wave

SR = 48000
DUR = 89.5
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(96)


def note(name):
    names = {'C': -9, 'C#': -8, 'D': -7, 'Eb': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'Ab': -1, 'A': 0, 'Bb': 1, 'B': 2}
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[n] + 12 * (o - 4)) / 12)


def put(sig, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N: return
    sig = sig[: N - i]
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * gain * gl * 1.414
    R[i:i + len(sig)] += sig * gain * gr * 1.414


def env_adsr(n, a, d, s, r, sustain_len):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), 1.0)
    e = np.where((t >= a) & (t < a + d), 1 - (1 - s) * (t - a) / max(d, 1e-4), e)
    e = np.where((t >= a + d) & (t < sustain_len), s, e)
    e = np.where(t >= sustain_len, s * np.exp(-(t - sustain_len) / max(r, 1e-4) * 3), e)
    return e


def piano(f, dur=3.0, bright=6, muted=True):
    n = int(SR * dur); t = np.arange(n) / SR; s = np.zeros(n)
    for k in range(1, bright + 1):
        fk = f * k * (1 + 0.0004 * k * k)
        s += (1 / k ** (1.6 if muted else 1.1)) * np.sin(2 * np.pi * fk * t) * np.exp(-t * (1.4 + 0.9 * k))
    s *= np.minimum(t / 0.004, 1)
    return s * 0.5


def oud(f, dur=2.2):
    n = int(SR * dur); t = np.arange(n) / SR; s = np.zeros(n)
    bend = 1 + 0.004 * np.exp(-t * 18)
    for k in range(1, 10):
        s += (1 / k) * np.sin(2 * np.pi * f * k * bend * t) * np.exp(-t * (2.5 + 1.3 * k))
    s *= np.minimum(t / 0.002, 1)
    return s * 0.45


def pad(freqs, dur, attack=1.2, release=1.5, bright=8, vib=0.004):
    n = int(SR * (dur + release)); t = np.arange(n) / SR; s = np.zeros(n)
    for f in freqs:
        for det in (-0.12, 0.0, 0.12):
            fv = f * (1 + det / 100) * (1 + vib * np.sin(2 * np.pi * 5.1 * t + rng.random() * 6))
            ph = 2 * np.pi * np.cumsum(fv) / SR
            for k in range(1, bright + 1):
                s += (1 / k) * np.sin(k * ph + rng.random() * 6) / 3
    e = np.clip(t / attack, 0, 1) * np.where(t > dur, np.exp(-(t - dur) / release * 3), 1)
    return s * e / max(1, len(freqs)) * 0.18


def harmonic(f, dur=2.5, slide=0.0):
    n = int(SR * dur); t = np.arange(n) / SR
    fv = f * (1 + slide * np.exp(-t * 10))
    ph = 2 * np.pi * np.cumsum(fv) / SR
    s = (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)) * np.exp(-t * 1.6) * np.minimum(t / 0.006, 1)
    return s * 0.22


def noise(dur, lo, hi, order=2):
    n = int(SR * dur); x = rng.standard_normal(n)
    sos = butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return sosfilt(sos, x)


def click(freq=1800, dur=0.05, q=(900, 4000)):
    s = noise(dur, q[0], q[1]); t = np.arange(len(s)) / SR
    return s * np.exp(-t * 90) * 0.5


def thump(f0=70, f1=42, dur=2.0):
    n = int(SR * dur); t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 6)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    s += noise(dur, 60, 400) * np.exp(-t * 25) * 0.4
    return s * 0.9


def drum(dur=0.6):  # soft frame drum (taar)
    n = int(SR * dur); t = np.arange(n) / SR
    f = 110 + 60 * np.exp(-t * 30)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) + noise(dur, 200, 2500) * np.exp(-t * 40) * 0.3
    return s * 0.35


def vol_curve(points):
    """piecewise-linear gain over the timeline: [(t, g), ...]"""
    t = np.arange(N) / SR; xs, ys = zip(*points)
    return np.interp(t, xs, ys)


MOTIF = ['D4', 'F4', 'A4', 'G4']

# ---------- bed: drone + pads per cue (item 7) ----------
drone = np.zeros(N); tt = np.arange(N) / SR
for f in (note('D2'), note('A2')):
    drone += np.sin(2 * np.pi * f * tt + 0.3 * np.sin(2 * np.pi * 0.07 * tt))
drone *= 0.05
drone *= vol_curve([(0, 0), (1.0, 0), (2.0, 1), (13, 1), (21.5, .8), (26, .8), (33, .6), (48.3, .7), (48.4, 0), (49.2, 0), (50, .6), (86, .6), (89.5, 0)])
L += drone; R += drone

chords = [  # (t0, dur, notes, gain)
    (1.0, 12.0, ['D3', 'A3', 'F4'], .5),
    (13.0, 4.3, ['D3', 'A3', 'F4'], .7), (17.3, 4.2, ['Bb2', 'F3', 'D4'], .7),
    (21.5, 4.5, ['D2'], .9),                      # the knot: a single low cello note
    (26.0, 3.5, ['F2', 'C3', 'A3', 'F4'], .8),    # major returns
    (29.5, 3.5, ['C3', 'G3', 'E4', 'C5'], .9),
    (33.0, 2.0, ['Bb2', 'F3', 'D4', 'F4'], 1.0), (35.0, 2.0, ['F2', 'C3', 'A3', 'F4', 'C5'], 1.2),
    (37.0, 6.0, ['Bb2', 'F3', 'D4', 'F4'], .8),   # leadership: still, no rhythm
    (43.0, 5.4, ['G2', 'D3', 'Bb3', 'G4'], .9),
    (49.2, 3.9, ['C3', 'G3', 'E4', 'C5'], .8),
    (53.1, 3.4, ['F2', 'C3', 'A3', 'F4', 'C5'], 1.3),  # reveal: emotional release
    (56.5, 5.5, ['D3', 'A3', 'F4', 'A4'], .8),
    (62.0, 3.6, ['Bb2', 'F3', 'D4'], .8), (65.6, 3.6, ['F2', 'C3', 'A3'], .8), (69.2, 3.6, ['C3', 'G3', 'E4'], .8), (72.8, 3.7, ['D3', 'A3', 'F4'], .8),
    (76.5, 3.0, ['Bb2', 'F3', 'D4', 'F4'], 1.0), (79.5, 3.3, ['C3', 'G3', 'E4', 'C5'], 1.1), (82.8, 3.2, ['F2', 'C3', 'A3', 'F4', 'C5'], 1.2),
    (86.0, 3.0, ['D3', 'A3', 'F#4', 'D5'], .8),   # resolve
]
for t0, d, ns, g in chords:
    put(pad([note(n) for n in ns], d, attack=min(1.2, d * .4), release=1.2), t0, g, 0)
# silence cut on «مهاد.» (48.4) — duck everything but the thread there
cut = vol_curve([(0, 1), (48.33, 1), (48.4, 0), (49.05, 0), (49.4, 1), (89.5, 1)])

# ---------- piano motif ----------
for i, n in enumerate(MOTIF[:1]): put(piano(note(n), 4), 1.0, .6, -.1)
put(piano(note('F4'), 4), 5.5, .55, .1)
for i, n in enumerate(MOTIF): put(piano(note(n), 3), 9.3 + i * .75, .5, (-.2 + i * .13))
for i, n in enumerate(MOTIF): put(piano(note(n), 3), 26.5 + i * .8, .4, .1)
for i, n in enumerate(MOTIF): put(piano(note(n), 3), 62.4 + i * .9, .35, -.1)
for i, n in enumerate(MOTIF): put(piano(note(n), 3.5), 80.3 + i * .85, .45, .0)
put(piano(note('D4'), 5), 88.0, .6, 0)          # last note = first note
# oud plays the full motif at the reveal
for i, n in enumerate(MOTIF): put(oud(note(n)), 53.2 + i * .42, .75, .15)
for i, n in enumerate(MOTIF): put(oud(note(n)), 57.0 + i * .5, .45, -.15)

# ---------- pulse (build) + frame drum ----------
for k, t0 in enumerate(np.arange(13.0, 21.5, 0.6)):
    put(piano(note(['D3', 'A3', 'F3', 'A3'][k % 4]), .5, bright=3), t0, .35, .3 * (-1) ** k)
for t0 in np.arange(30.0, 33.0, 0.6): put(drum(), t0, .5, -.2)
for t0 in np.arange(62.0, 76.5, 1.2): put(drum(), t0, .35, .2)
for t0 in np.arange(62.6, 76.5, 1.2): put(drum(), t0, .2, -.2)

# ---------- sound design (item 8) ----------
put(thump(90, 50, 1.2), 1.0, .5)                                  # the point ignites
put(harmonic(note('A6'), 2.0), 1.02, .35)
put(noise(.5, 2000, 6000) * np.exp(-np.arange(int(.5 * SR)) / SR * 6) * .15, 4.55)   # pen on paper
for t0 in (5.1, 5.7, 6.3, 6.9, 7.5): put(click(), t0, .25, .3)   # montage cuts / keys
put(click(), 8.1, .5)                                              # mouse click
for t0, n in ((10.7, 'A5'), (11.4, 'D6'), (12.15, 'E6')): put(harmonic(note(n), 2.2), t0, .45, 0)   # «صوت الخيط»
for t0 in np.arange(17.5, 18.5, .09): put(click(q=(1500, 6000)), t0 + rng.random() * .03, .18, .4)  # keyboard
put(click(q=(2500, 7000)), 18.9, .3)                               # UI click
put(piano(note('C3'), .6, bright=2), 19.55, .25)                   # muted error
put(noise(.35, 300, 3000) * np.hanning(int(.35 * SR)) * .2, 20.5)   # swipe
creak = noise(3.0, 700, 1600); tc = np.arange(len(creak)) / SR
put(creak * (0.3 + 0.7 * np.abs(np.sin(tc * 7))) * np.clip(tc / 3, 0, 1) * .25, 21.7)      # knot tension creak
nr = int(.75 * SR); tr = np.arange(nr) / SR                        # tape-rewind
put(np.sin(2 * np.pi * np.cumsum(2400 * np.exp(-tr * 3.2)) / SR) * np.exp(-tr * 2) * .12 + noise(.75, 500, 4000) * .05, 24.75)
put(harmonic(note('A5'), 3.0), 27.4, .5)                           # knot releases: clean ring
put(harmonic(note('E6'), 1.2) * .6, 28.6, .5, .2); put(harmonic(note('A6'), 1.2) * .6, 28.75, .5, .2)  # success chime
put(noise(3.0, 2000, 9000) * np.linspace(0, 1, int(3 * SR)) ** 2 * .12, 30.0)   # riser
for t0 in (30.8, 31.4, 32.2): put(click(q=(600, 2200)), t0, .6)   # loom shuttle
for t0, d in ((33.2, .3), (33.5, .28), (33.8, .26), (34.08, .22), (34.32, .2), (34.54, .18), (34.74, .2)): put(click(q=(500, 2000)), t0, .7, .2)
put(thump(), 35.0, 1.0)                                            # the only deep hit in the film
put(harmonic(note('D6'), 2.5), 43.5, .4); put(harmonic(note('A6'), 2.5), 46.0, .45)
put(noise(2.0, 3000, 9000) * np.linspace(0, 1, 2 * SR) ** 3 * .15, 46.4)
for t0 in (49.35, 49.58, 49.8, 50.03, 50.2, 50.35): put(click(q=(2500, 7000)), t0, .3, rng.uniform(-.5, .5))
put(noise(1.2, 1500, 8000) * np.linspace(0, 1, int(1.2 * SR)) ** 2 * .1, 50.2)
put(harmonic(note('D6'), 3.5), 53.15, .6); put(harmonic(note('A5'), 3.5), 53.2, .4)   # reveal: string ring, no impact
put(harmonic(note('E6'), 1.0) * .5, 72.6, .5, .3); put(harmonic(note('A6'), 1.0) * .5, 72.72, .5, .3)  # notification
for i, t0 in enumerate(np.arange(77.0, 79.4, .3)): put(harmonic(note(['A5', 'D6', 'E6', 'A6'][i % 4]), 1.8), t0, .22, rng.uniform(-.7, .7))  # chorus of threads
put(noise(6.0, 200, 1200) * .04, 79.5, 1.0)                         # wind on the escarpment

# ---------- master ----------
ir_n = int(2.8 * SR); tir = np.arange(ir_n) / SR
irL = rng.standard_normal(ir_n) * np.exp(-tir * 2.6); irR = rng.standard_normal(ir_n) * np.exp(-tir * 2.6)
irL /= np.sqrt((irL ** 2).sum()); irR /= np.sqrt((irR ** 2).sum())
wetL = fftconvolve(L, irL)[:N]; wetR = fftconvolve(R, irR)[:N]
L2 = (L * .75 + wetL * .35) * cut; R2 = (R * .75 + wetR * .35) * cut
fade = vol_curve([(0, 1), (88.6, 1), (89.5, 0)])
L2 *= fade; R2 *= fade
sos = butter(2, 30, btype='high', fs=SR, output='sos'); L2 = sosfilt(sos, L2); R2 = sosfilt(sos, R2)
rms = np.sqrt(np.mean(np.concatenate([L2, R2]) ** 2)); target = 10 ** (-20 / 20)
g = target / rms; L2 *= g; R2 *= g
peak = max(np.abs(L2).max(), np.abs(R2).max())
if peak > 0.89: L2 = np.tanh(L2 / peak * 1.3) * .89 / np.tanh(1.3); R2 = np.tanh(R2 / peak * 1.3) * .89 / np.tanh(1.3)
out = (np.stack([L2, R2], 1) * 32767).astype(np.int16)
with wave.open('audio/temp_score.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
print('wrote audio/temp_score.wav', round(DUR, 1), 's')
