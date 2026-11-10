/** Minimal deterministic static server for the Storybook --test build. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

/* eslint-disable no-undef -- node CLI script */
const root = resolve(process.argv[2] ?? "dist-storybook");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon" };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = join(root, decodeURIComponent(url.pathname));
    path = normalize(path);
    if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
    let body = null;
    try { body = await readFile(path); } catch {
      body = await readFile(join(root, "index.html"));
    }
    const type = types[extname(path)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(500).end();
  }
});
const port = Number(process.env.PORT ?? 6060);
server.listen(port, "127.0.0.1", () => console.log(`storybook static on http://127.0.0.1:${port}`));
/* eslint-enable no-undef */
