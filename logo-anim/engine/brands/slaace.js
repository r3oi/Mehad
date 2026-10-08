/* × "Slaace": a wavy ribbon runs left → right across the mark; behind its head the mark
   forms out of liquid, tinted fragments that settle within a few tenths of a second.
   AIM on a deep teal ground (white letter plate). */
"use strict";
(() => {
  const T = { run: [.1, 1.3], settle: 1.45, end: 3.2 };
  const BG = "#06201E", RIBBON = "#5FD8CA", TONES = ["#2FB5A9", "#1C8C84", "#9BEDE3"];
  let P, still, band;

  async function load() {
    await LOGO.load(); P = place(LOGO, FORMAT === "1x1" ? 700 : 780);
    still = Object.assign(document.createElement("canvas"), { width: W, height: H });      // the finished mark, once
    const g = still.getContext("2d"); P.tr(g); LOGO.drawFinal(g, true);
    band = Object.assign(document.createElement("canvas"), { width: W, height: H });
  }

  const x0 = () => P.x - 140 * W / 1920, x1 = () => P.x + LOGO.src.w * P.L + 140 * W / 1920;
  const headAt = t => lerp(x0(), x1(), E.inOutSine(seg(t, T.run[0], T.run[1])));

  function ribbon(t, hx) {
    const amp = 46 * P.L / .39, wl = 300 * P.L / .39, len = 520 * W / 1920, cy = H / 2 - LOGO.src.h * P.L * .02;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let k = 0; k < 3; k++) {                                // a soft trail, then the ribbon
      const pts = []; for (let x = hx - len; x <= hx; x += 6) pts.push([x, cy + Math.sin((x - t * 900) / wl * Math.PI * 2) * amp * (1 - .15 * k)]);
      ctx.strokeStyle = k < 2 ? `rgba(95,216,202,${.12 + .1 * k})` : RIBBON; ctx.lineWidth = (k < 2 ? 28 - 8 * k : 11) * W / 1920;
      const g = ctx.createLinearGradient(hx - len, 0, hx, 0); g.addColorStop(0, "rgba(95,216,202,0)"); g.addColorStop(1, k < 2 ? `rgba(95,216,202,${.2 + .15 * k})` : RIBBON);
      ctx.strokeStyle = g; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
    ctx.restore();
  }

  function draw(t, n) {
    flatBG(BG); vignetteDark(.28); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (t >= T.settle) { ctx.drawImage(still, 0, 0); return; }
    const hx = headAt(t), lag = 300 * W / 1920;
    // settled part: everything left of the forming band
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, Math.max(0, hx - lag), H); ctx.clip(); ctx.drawImage(still, 0, 0); ctx.restore();
    // the forming band: liquid, tinted, more so near the head
    const steps = 5, top = P.y - 20, h = LOGO.src.h * P.L + 40;
    for (let i = 0; i < steps; i++) {
      const a = hx - lag + lag * i / steps, b = hx - lag + lag * (i + 1) / steps, amt = (i + 1) / steps;
      if (b <= x0() || a >= x1()) continue;
      const bg = band.getContext("2d"); bg.setTransform(1, 0, 0, 1, 0, 0); bg.clearRect(0, 0, W, H);
      liquid(bg, still, a, top, b - a, h, a, top, b - a, h, amt * .9, i * 31 + 7, t);
      bg.globalCompositeOperation = "source-atop"; bg.fillStyle = TONES[(i + Math.floor(n / 3)) % 3]; bg.globalAlpha = amt * .7; bg.fillRect(0, 0, W, H);
      bg.globalCompositeOperation = "source-over"; bg.globalAlpha = 1;
      ctx.globalAlpha = .45 + .55 * (1 - amt * .6); ctx.drawImage(band, 0, 0); ctx.globalAlpha = 1;
    }
    // a few loose fragments around the head
    for (let i = 0; i < 6; i++) {
      const ph = t * 6 + i * 1.7, fx = hx - lag * rnd(i * 13 + 1) * .9 + Math.sin(ph) * 14, fy = H / 2 + hash(i * 13 + 2) * LOGO.src.h * P.L * .45 + Math.cos(ph) * 10;
      if (fx < x0() || fx > x1()) continue;
      ctx.fillStyle = TONES[i % 3]; ctx.globalAlpha = .85; ctx.beginPath(); ctx.ellipse(fx, fy, (10 + 8 * rnd(i)) * W / 1920, (6 + 5 * rnd(i + 9)) * W / 1920, ph, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (t < T.run[1] + .1) ribbon(t, hx);
  }

  function cues() {
    return { dur: T.end, events: [
      { type: "whoosh", t: T.run[0], d: T.run[1] - T.run[0] + .1, pan: [-.8, .8], level: -16, fc: [400, 3000] },
      ...[0, 1, 2, 3, 4, 5].map(i => ({ type: "flutter", t: T.run[0] + .12 + i * .17 })),
      { type: "impact", t: T.settle - .1, style: "digital" },
    ] };
  }

  window.BRAND_DEF = { name: "slaace-aim", load, draw, cues, blur: [[0, T.settle]] };
  TIMING.dur = T.end;
})();
