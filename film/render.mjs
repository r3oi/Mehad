// usage: node render.mjs stills t1,t2,...  |  node render.mjs video out.mp4 [t0] [t1] [notags]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const [mode, arg, a0, a1, flag] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-web-security"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", m => { if (m.type() === "error") console.error("PAGE:", m.text()); });
page.on("pageerror", e => console.error("PAGEERR:", e.message));
await page.goto(`http://127.0.0.1:8765/engine/index.html?render${flag === "notags" ? "&notags" : ""}`);
await page.waitForFunction(() => window.READY || window.BOOT_ERROR, null, { timeout: 60000 });
const err = await page.evaluate(() => window.BOOT_ERROR); if (err) { console.error(err); process.exit(1); }
const grab = t => page.evaluate(async t => { await prepareAt(t); renderAt(t); return document.getElementById("cv").toDataURL("image/jpeg", 0.94).slice(23); }, t);
if (mode === "stills") {
  const SD = process.env.SD || "out/stills"; fs.mkdirSync(SD, { recursive: true });
  for (const t of arg.split(",").map(Number)) { const b = await grab(t); fs.writeFileSync(`${SD}/t${t.toFixed(2).padStart(6, "0")}.jpg`, Buffer.from(b, "base64")); }
} else {
  const FPS = 25, t0 = +(a0 || 0), t1 = +(a1 || 89.5);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", arg], { stdio: ["pipe", "inherit", "inherit"] });
  const n0 = Math.round(t0 * FPS), n1 = Math.round(t1 * FPS); const st = Date.now();
  for (let n = n0; n < n1; n++) {
    const b = await grab(n / FPS);
    if (!ff.stdin.write(Buffer.from(b, "base64"))) await new Promise(r => ff.stdin.once("drain", r));
    if ((n - n0) % 125 === 0) console.log(`${arg}: frame ${n - n0}/${n1 - n0} ${((Date.now() - st) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise(r => ff.on("close", r));
}
await browser.close();
