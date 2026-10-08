/* × "Slaace": a wavy ribbon runs across the logo; behind its head the logo forms out of
   liquid, tinted fragments that settle within a few tenths of a second.
   AIM:   left → right on a deep teal ground (white letter plate).
   MEHAD: the thread runs right → left (the reading direction) on a warm light ground,
          tinted with the brand's teal, sand and olive — the «one thread» idea itself. */
"use strict";
(() => {
  const T = { run: [.1, 1.3], settle: 1.45, end: 3.2 };
  const isM = LOGO_NAME === "mehad";
  const C = isM ? { bg: "#F5F2EC", ribbon: [40, 162, 153], tones: ["#28A299", "#BC9D6A", "#6DA87D"], dark: false, dir: -1, width: { "16x9": 1040, "1x1": 860 } }
                : { bg: "#06201E", ribbon: [95, 216, 202], tones: ["#2FB5A9", "#1C8C84", "#9BEDE3"], dark: true, dir: 1, width: { "16x9": 780, "1x1": 700 } };
  const BG = C.bg, TONES = C.tones, RIB = a => `rgba(${C.ribbon.join(",")},${a})`;
  let P, still, band;

  async function load() {
    await LOGO.load(); P = place(LOGO, C.width[FORMAT]);
    still = Object.assign(document.createElement("canvas"), { width: W, height: H });      // the finished mark, once
    const g = still.getContext("2d"); P.tr(g); LOGO.drawFinal(g, C.dark);
    band = Object.assign(document.createElement("canvas"), { width: W, height: H });
  }

  const x0 = () => P.x - 140 * W / 1920, x1 = () => P.x + LOGO.src.w * P.L + 140 * W / 1920;
  const headAt = t => { const u = E.inOutSine(seg(t, T.run[0], T.run[1])); return C.dir > 0 ? lerp(x0(), x1(), u) : lerp(x1(), x0(), u); };

  function ribbon(t, hx) {
    const amp = 46 * P.L / .39, wl = 300 * P.L / .39, len = 520 * W / 1920, cy = H / 2 - LOGO.src.h * P.L * .02;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let k = 0; k < 3; k++) {                                // a soft trail, then the ribbon
      const tail = hx - C.dir * len, pts = [];
      for (let i = 0; i <= len / 6; i++) { const x = lerp(tail, hx, i / (len / 6)); pts.push([x, cy + Math.sin((x - C.dir * t * 900) / wl * Math.PI * 2) * amp * (1 - .15 * k)]); }
      ctx.lineWidth = (k < 2 ? 28 - 8 * k : 11) * W / 1920;
      const g = ctx.createLinearGradient(tail, 0, hx, 0); g.addColorStop(0, RIB(0)); g.addColorStop(1, k < 2 ? RIB(.2 + .15 * k) : RIB(1));
      ctx.strokeStyle = g; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
    ctx.restore();
  }

  function draw(t, n) {
    flatBG(BG); if (C.dark) vignetteDark(.28); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (t >= T.settle) { ctx.drawImage(still, 0, 0); return; }
    const hx = headAt(t), lag = 300 * W / 1920;
    // settled part: everything the head has already passed
    ctx.save(); ctx.beginPath();
    if (C.dir > 0) ctx.rect(0, 0, Math.max(0, hx - lag), H); else ctx.rect(Math.min(W, hx + lag), 0, W, H);
    ctx.clip(); ctx.drawImage(still, 0, 0); ctx.restore();
    // the forming band: liquid, tinted, more so near the head
    const steps = 5, top = P.y - 20, h = LOGO.src.h * P.L + 40;
    for (let i = 0; i < steps; i++) {
      const amt = (i + 1) / steps;                                 // stronger toward the head
      const a = C.dir > 0 ? hx - lag + lag * i / steps : hx + lag - lag * (i + 1) / steps, b = a + lag / steps;
      if (b <= x0() || a >= x1()) continue;
      const bg = band.getContext("2d"); bg.setTransform(1, 0, 0, 1, 0, 0); bg.clearRect(0, 0, W, H);
      liquid(bg, still, a, top, b - a, h, a, top, b - a, h, amt * .9, i * 31 + 7, t);
      bg.globalCompositeOperation = "source-atop"; bg.fillStyle = TONES[(i + Math.floor(n / 3)) % 3]; bg.globalAlpha = amt * .7; bg.fillRect(0, 0, W, H);
      bg.globalCompositeOperation = "source-over"; bg.globalAlpha = 1;
      ctx.globalAlpha = .45 + .55 * (1 - amt * .6); ctx.drawImage(band, 0, 0); ctx.globalAlpha = 1;
    }
    // a few loose fragments around the head
    for (let i = 0; i < 6; i++) {
      const ph = t * 6 + i * 1.7, fx = hx - C.dir * lag * rnd(i * 13 + 1) * .9 + Math.sin(ph) * 14, fy = H / 2 + hash(i * 13 + 2) * LOGO.src.h * P.L * .45 + Math.cos(ph) * 10;
      if (fx < x0() || fx > x1()) continue;
      ctx.fillStyle = TONES[i % 3]; ctx.globalAlpha = .85; ctx.beginPath(); ctx.ellipse(fx, fy, (10 + 8 * rnd(i)) * W / 1920, (6 + 5 * rnd(i + 9)) * W / 1920, ph, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (t < T.run[1] + .1) ribbon(t, hx);
  }

  function cues() {
    return { dur: T.end, events: [
      { type: "whoosh", t: T.run[0], d: T.run[1] - T.run[0] + .1, pan: [-.8 * C.dir, .8 * C.dir], level: -16, fc: [400, 3000] },
      ...[0, 1, 2, 3, 4, 5].map(i => ({ type: "flutter", t: T.run[0] + .12 + i * .17 })),
      { type: "impact", t: T.settle - .1, style: isM ? "paper" : "digital" },
    ] };
  }

  window.BRAND_DEF = { name: "slaace-" + LOGO_NAME, load, draw, cues, blur: [[0, T.settle]] };
  TIMING.dur = T.end;
})();
