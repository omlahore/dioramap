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
    size: { type: "string", short: "s" },
    pixel: { type: "string", short: "p" },
    video: { type: "boolean" },
    gif: { type: "boolean" },
    spin: { type: "boolean" },
    out: { type: "string", short: "o" },
    title: { type: "string" },
    subtitle: { type: "string" },
    "no-plaque": { type: "boolean" },
    "save-data": { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});
const place = positionals.join(" ");
if (o.version) {
  console.log(JSON.parse(await readFile(new URL("../package.json", import.meta.url))).version);
  process.exit(0);
}
if (o.help || !place) {
  console.log(`usage: dioramap "<place or lat,lon>" [options]

  -r, --radius <m>     half-width of the square, in metres (default 220)
  -t, --theme <name>   day | night (default day)
      --rotate <deg>   view from 45, 135, 225 or 315 degrees (default 45)
  -s, --size <WxH>     output size in pixels (default 1800x1200, video 1080x1350, gif 720x900)
  -p, --pixel <n>      screen pixels per art pixel (default 3, video 4)
      --video          make an MP4 of the city rising and night falling
      --gif            the same as a looping GIF
      --spin           turn the camera all the way round during the video
  -o, --out <file>     output file; the extension picks the format: .png .mp4 .gif
      --title, --subtitle   override the plaque text
      --no-plaque      map only
      --save-data      also write the fetched map data as JSON

examples:
  dioramap "Eiffel Tower, Paris"
  dioramap "Times Square, Manhattan" -r 160 -t night
  dioramap "Dubai Marina" -t night --video
  dioramap "48.8584, 2.2945" --title "Home"`);
  process.exit(place ? 0 : 1);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const pkgDir = (name) => dirname(dirname(createRequire(import.meta.url).resolve(name)));
const threeDir = pkgDir("three"), gifDir = pkgDir("gifenc");
const slug = place.split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "place";
const fmt = o.video ? "mp4" : o.gif ? "gif" : ["mp4", "gif"].find((e) => o.out?.toLowerCase().endsWith("." + e)) || "png";
const DEFAULTS = { png: ["1800x1200", "3"], mp4: ["1080x1350", "4"], gif: ["720x900", "3"] }[fmt];
const out = resolve(o.out || `${slug}${o.theme === "night" ? "-night" : ""}.${fmt}`);

const fail = (msg) => { console.error(`\n${msg === "fetch failed" ? "couldn't reach the map servers. Check your internet connection" : msg}`); process.exit(1); };
const radius = Number(o.radius), [w, h] = (o.size || DEFAULTS[0]).split("x").map(Number);
if (!["day", "night"].includes(o.theme)) fail(`--theme is day or night, not "${o.theme}"`);
if (!(radius >= 50 && radius <= 1000)) fail("--radius is in metres, from 50 to 1000");
if (!(w >= 200 && h >= 200 && w <= 8000 && h <= 8000)) fail('--size looks like "1800x1200"');
process.stdout.write(`finding ${place}... `);
const data = await loadPlace(place, radius).catch((e) => fail(e.message));
console.log(`${data.name}\n${data.stats.features} map features, ${data.feats.filter((f) => f.tags?.building).length} buildings`);
if (o["save-data"]) await writeFile(out.replace(/\.\w+$/, "") + ".json", JSON.stringify(data));

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    if (path === "/data.json") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    const file = path.startsWith("/three/") ? join(threeDir, path.slice(7)) : path.startsWith("/gifenc/") ? join(gifDir, path.slice(8)) : join(src, path === "/" ? "render.html" : path);
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
const page = await browser.newPage({ viewport: { width: w + 100, height: h + 400 } });
page.on("pageerror", async (e) => { console.error("render error:", e.message); await browser.close(); process.exit(1); });
const q = new URLSearchParams({ data: "/data.json", px: o.pixel || DEFAULTS[1], w, h, az: o.rotate, theme: o.theme, ...(fmt !== "png" ? { video: fmt } : {}), ...(o.spin ? { spin: "1" } : {}), ...(o.title ? { title: o.title } : {}), ...(o.subtitle != null ? { subtitle: o.subtitle } : {}), ...(o["no-plaque"] ? { plaque: "0" } : {}) });
await page.goto(`http://127.0.0.1:${server.address().port}/?${q}`);
if (fmt !== "png") console.log(`making the ${fmt === "mp4" ? "video" : "gif"}...`);
await page.waitForFunction(() => window.__done, null, { timeout: 600000, polling: 500 });
if (fmt === "png") await page.locator("#out").screenshot({ path: out });
else await writeFile(out, Buffer.from(await page.evaluate(() => window.__video), "base64"));
await browser.close();
server.close();
console.log(`saved ${out}`);
