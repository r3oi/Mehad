// Render a brand's logo animation to frames → ffmpeg.
// usage: node render.mjs <brand> <16x9|1x1> <out.mp4|stills|cues> [frame,frame,...]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [brand = "mehad", format = "16x9", out = "stills", list] = process.argv.slice(2);
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".css": "text/css", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
}).listen(0, "127.0.0.1");
await new Promise(r => server.once("listening", r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const [w, h] = format === "1x1" ? [1080, 1080] : [1920, 1080];
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on("pageerror", e => console.error("PAGEERR:", e.message));
const [idea, logo, variant] = brand.split("-");   // idea stings: mash-mehad, risk-aim, … (+ a variant: mash-aim-real)
await page.goto(`http://127.0.0.1:${port}/engine/index.html?render&brand=${idea}&format=${format}${logo ? "&logo=" + logo : ""}${variant ? "&v=" + variant : ""}`);
await page.waitForFunction(() => window.READY || window.BOOT_ERROR, null, { timeout: 60000 });
const err = await page.evaluate(() => window.BOOT_ERROR); if (err) { console.error(err); process.exit(1); }
const total = await page.evaluate(() => FRAMES());
const grab = n => page.evaluate(n => { renderFrame(n); return document.getElementById("cv").toDataURL("image/png").slice(22); }, n);

if (out === "cues") {
  fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, `out/${brand}_cues.json`), JSON.stringify(await page.evaluate(() => BRAND_DEF.cues()), null, 1));
  console.log("wrote", `out/${brand}_cues.json`);
} else if (out === "stills") {
  const dir = path.join(ROOT, "out/stills"); fs.mkdirSync(dir, { recursive: true });
  for (const n of list.split(",").map(Number)) fs.writeFileSync(`${dir}/${brand}_${format}_f${String(n).padStart(3, "0")}.png`, Buffer.from(await grab(n), "base64"));
} else {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  // PNG frames, encoded with BT.709 so the brand teal/navy survive the RGB→YUV conversion
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "25", "-c:v", "png", "-i", "-",
    "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-tune", "animation",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  for (let n = 0; n < total; n++) {
    const b = Buffer.from(await grab(n), "base64");
    if (!ff.stdin.write(b)) await new Promise(r => ff.stdin.once("drain", r));
    if (n % 25 === 0) console.log(`${brand} ${format}: ${n}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise(r => ff.on("close", r));
  console.log("wrote", out);
}
await browser.close(); server.close();
