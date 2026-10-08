// Zero-dependency static server: `node serve.mjs [port]` → http://localhost:5173
// ES modules need http(s); opening index.html via file:// will not work.
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 5173);
const shouldOpen = args.includes('--open');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = join(root, path || 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`GradDocs is running at ${url}`);
  console.log('Keep this window open while you use the app. Close it to stop GradDocs.');
  if (shouldOpen) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => { /* if no browser can be opened, the URL is printed above */ });
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is busy. GradDocs may already be running: open http://localhost:${port}`);
  else console.error(err.message);
  process.exit(1);
});
