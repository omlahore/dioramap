#!/usr/bin/env node
// dioramap "any place" -> a pixel-art isometric poster of it.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { loadPlace } from "../src/data.mjs";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    radius: { type: "string", short: "r", default: "220" },
    theme: { type: "string", short: "t", default: "day" },
    rotate: { type: "string", default: "45" },
    size: { type: "string", short: "s", default: "1800x1100" },
    pixel: { type: "string", short: "p", default: "3" },
    out: { type: "string", short: "o" },
    title: { type: "string" },
    subtitle: { type: "string" },
    "no-plaque": { type: "boolean" },
    "save-data": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const place = positionals.join(" ");
if (o.help || !place) {
  console.log(`usage: dioramap "<place or lat,lon>" [options]

  -r, --radius <m>     half-width of the square, in metres (default 220)
  -t, --theme <name>   day | night (default day)
      --rotate <deg>   view from 45, 135, 225 or 315 degrees (default 45)
  -s, --size <WxH>     output size in pixels (default 1800x1100)
  -p, --pixel <n>      screen pixels per art pixel (default 3)
  -o, --out <file>     output PNG (default: <place>.png)
      --title, --subtitle   override the plaque text
      --no-plaque      map only
      --save-data      also write the fetched map data as JSON`);
  process.exit(place ? 0 : 1);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const threeDir = dirname(dirname(createRequire(import.meta.url).resolve("three")));
const slug = place.split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "place";
const out = resolve(o.out || `${slug}${o.theme === "night" ? "-night" : ""}.png`);

process.stdout.write(`finding ${place}... `);
const data = await loadPlace(place, Number(o.radius));
console.log(`${data.name}\n${data.stats.features} map features, ${data.feats.filter((f) => f.tags?.building).length} buildings`);
if (o["save-data"]) await writeFile(out.replace(/\.png$/, ".json"), JSON.stringify(data));

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    if (path === "/data.json") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    const file = path.startsWith("/three/") ? join(threeDir, path.slice(7)) : join(src, path === "/" ? "render.html" : path);
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, "127.0.0.1");

const { chromium } = await import("playwright-core");
let browser;
for (const channel of ["chrome", "msedge", "chromium"]) {
  try { browser = await chromium.launch({ channel, args: ["--enable-gpu", "--ignore-gpu-blocklist"] }); break; } catch {}
}
if (!browser) { console.error("dioramap needs Google Chrome, Microsoft Edge or Chromium installed to render."); process.exit(1); }
const [w, h] = o.size.split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w + 100, height: h + 400 } });
page.on("pageerror", (e) => console.error("render error:", e.message));
const q = new URLSearchParams({ data: "/data.json", px: o.pixel, w, h, az: o.rotate, theme: o.theme, ...(o.title ? { title: o.title } : {}), ...(o.subtitle != null ? { subtitle: o.subtitle } : {}), ...(o["no-plaque"] ? { plaque: "0" } : {}) });
await page.goto(`http://127.0.0.1:${server.address().port}/?${q}`);
await page.waitForFunction(() => window.__done, null, { timeout: 180000 });
await page.locator("#out").screenshot({ path: out });
await browser.close();
server.close();
console.log(`saved ${out}`);
