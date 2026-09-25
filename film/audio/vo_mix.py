"""Split the chosen VO take into its 20 lines (by pause length), place each line at its storyboard time,
and mix it over the temp score with ducking. Writes audio/final_mix.wav and engine/assets/vo_timing.json."""
import subprocess, re, json, wave, sys, os
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAKE = sys.argv[1] if len(sys.argv) > 1 else "full_sterling_light.mp3"
SR = 48000
LINES = ["كل شيء كبير... بدأ بفكرة.", "ومهاد... بدأت بفكرة.", "فكرة إن التعليم... يكون أقرب. أسهل. وأوسع.",
         "خلال الشهور اللي راحت... ما كان الطريق سهل.", "اشتغلنا... وجرّبنا... وغلطنا... وعدّلنا.", "مرات وقفنا عند مشكلة... ومرات رجعنا من البداية.",
         "بس كل مرة... كان عندنا سبب نكمل.", "وفي يوم نحتفل فيه بوطن... علّمنا إن الطموح ما له سقف.", "نحتفل بخطوة جديدة...",
         "خطوة اسمها... مهاد.", "اليوم... مهاد مو مجرد فكرة.", "اليوم... مهاد صارت منصة.", "ومن هنا... تبدأ الحكاية.",
         "طموحنا أكبر من منصة.", "طموحنا إننا نقرّب التعليم... من كل طالب.", "ونعطي المعلم مساحة أكبر... يعلّم، ويطوّر، ويصنع أثر.",
         "ونبني تجربة... تخلي التعليم أقرب للناس.", "وهذي... بس البداية.", "من السعودية... وبطموح ما يعرف حدود.", "مهاد."]
SLOT = [1.0, 5.5, 9.3, 13.8, 18.0, 22.3, 26.5, 36.0, 43.5, 46.0, 53.6, 56.8, 59.5, 62.3, 64.4, 67.9, 72.9, 76.8, 80.3, 84.3]

src = f"{ROOT}/src/vo/{TAKE}"
pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
vo = np.frombuffer(pcm, np.float32).copy()
log = subprocess.run(["ffmpeg", "-hide_banner", "-i", src, "-af", "silencedetect=noise=-40dB:d=0.35", "-f", "null", "-"], capture_output=True, text=True).stderr
st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]; en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
gaps = [(s, e) for s, e in zip(st, en) if s > 0.05]
# speech segments, then join segments separated by short (comma) pauses into lines
segs = []; cur = 0.0
for s, e in gaps: segs.append([cur, s]); cur = e
segs.append([cur, len(vo) / SR])
lines = [segs[0][:]]; subs = [[segs[0][:]]]
for (s0, s1), (g0, g1) in zip(segs[1:], gaps):
    if g1 - g0 < 0.5: lines[-1][1] = s1; subs[-1].append([s0, s1])
    else: lines.append([s0, s1]); subs.append([[s0, s1]])
assert len(lines) == 20, f"expected 20 lines, got {len(lines)}"

N = int(SR * 89.5); track = np.zeros(N, np.float32); timing = []
for i, ((a, b), sb) in enumerate(zip(lines, subs)):
    t = SLOT[i]
    if i == 15: t -= max(0, (b - a) - (SLOT[16] - SLOT[15] - .15))   # long line: start early so it ends before the next
    pieces = sb
    if i == 9 and len(sb) >= 2:   # «خطوة اسمها... (0.6s) مهاد.»
        pieces = [sb[0], [sb[-1][0], sb[-1][1]]]
        offs = [0, (sb[0][1] - sb[0][0]) + 0.6]
    else:
        offs = [p[0] - a for p in pieces]
    end = t
    for p, o in zip(pieces, offs):
        seg = vo[max(0, int((p[0] - .03) * SR)): int((p[1] + .08) * SR)].copy()
        f = int(.01 * SR); seg[:f] *= np.linspace(0, 1, f); seg[-f:] *= np.linspace(1, 0, f)
        i0 = int((t + o - .03) * SR); track[i0:i0 + len(seg)] += seg[:max(0, N - i0)]
        end = t + o + (p[1] - p[0])
    timing.append({"i": i + 1, "t0": round(t, 2), "t1": round(end, 2), "text": LINES[i]})
    print(f"{i+1:2d} {t:6.2f}-{end:6.2f}  {LINES[i]}")

# loudness: dialogue ~ -18 dBFS rms while speaking
act = np.abs(track) > 1e-4
track *= 10 ** (-17 / 20) / (np.sqrt(np.mean(track[act] ** 2)) + 1e-9)
# ducking envelope (music ~8 dB under the voice)
env = np.zeros(N, np.float32)
for d in timing: env[int((d["t0"] - .25) * SR): int((d["t1"] + .35) * SR)] = 1
k = int(.25 * SR); env = np.convolve(env, np.ones(k) / k, "same")
duck = 1 - env * (1 - 10 ** (-8 / 20))
w = wave.open(f"{ROOT}/audio/temp_score.wav"); mus = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2).astype(np.float32) / 32768
mus = mus[:N]
mix = mus * duck[:len(mus), None] * .9 + track[:len(mus), None] * np.array([1, 1])[None]
peak = np.abs(mix).max()
if peak > .95: mix = np.tanh(mix / peak * 1.2) * .95 / np.tanh(1.2)
out = (np.clip(mix, -1, 1) * 32767).astype(np.int16)
with wave.open(f"{ROOT}/audio/final_mix.wav", "wb") as o: o.setnchannels(2); o.setsampwidth(2); o.setframerate(SR); o.writeframes(out.tobytes())
json.dump({"take": TAKE, "lines": timing}, open(f"{ROOT}/engine/assets/vo_timing.json", "w"), ensure_ascii=False, indent=1)
print("wrote audio/final_mix.wav + engine/assets/vo_timing.json")
