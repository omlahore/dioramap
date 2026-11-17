// Map data for a place: roads, water and parks from OpenFreeMap, buildings from Overture,
// both read straight from static tiles (no API key, no rate-limited server).
import { VectorTile } from "@mapbox/vector-tile";
import Protobuf from "pbf";
import { PMTiles } from "pmtiles";

const UA = { "User-Agent": "dioramap/0.2 (+https://github.com/omlahore/dioramap)" };

// Overture keeps only the last few releases online, so use the newest one there is.
const OVERTURE_BUCKET = "https://overturemaps-extras-us-west-2.s3.amazonaws.com";
async function overture() {
  let release = "2026-10-21.0";
  try {
    const xml = await (await fetch(`${OVERTURE_BUCKET}/?list-type=2&prefix=tiles/&delimiter=/`)).text();
    release = [...xml.matchAll(/<Prefix>tiles\/([\d-]+\.\d+)\/<\/Prefix>/g)].map((m) => m[1]).sort().at(-1) || release;
  } catch {}
  return new PMTiles(`${OVERTURE_BUCKET}/tiles/${release}/buildings.pmtiles`);
}

async function nominatim(path) {
  const r = await fetch(`https://nominatim.openstreetmap.org/${path}&format=jsonv2&addressdetails=1&accept-language=en`, { headers: UA });
  if (!r.ok) throw new Error(`the OpenStreetMap geocoder answered ${r.status}. Wait a minute and try again`);
  return r.json();
}

const LONDON = new Set("BDG BNE BEX BEN BRY CMD CRY EAL ENF GRE HCK HMF HRY HRW HAV HIL HNS ISL KEC KTT LBH LEW MRT NWM RDB RIC SWK STN TWH WFT WND WSM LND".split(" "));
function label(hit) {
  const a = hit.address || {};
  // London boroughs and Tokyo wards come back as the "city"; people expect London and Tokyo.
  const metro = LONDON.has(a["ISO3166-2-lvl8"]?.slice(3)) ? "London" : a["ISO3166-2-lvl4"] === "JP-13" ? "Tokyo" : null;
  const city = (metro || a.city || a.town || a.village || a.municipality || a.state_district || a.county || a.state || "").replace(/ (City )?District$| Emirate$/, "").replace(/^City of /, "");
  return [...new Set([city, a.country].filter(Boolean))].join(", ");
}

async function geocode(q) {
  const m = q.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/);
  if (m) {
    const lat = +m[1], lon = +m[3];
    const hit = await nominatim(`reverse?lat=${lat}&lon=${lon}&zoom=17`).catch(() => ({}));
    const a = hit.address || {};
    return { lat, lon, name: hit.display_name || q, title: a.road || a.neighbourhood || a.suburb || q, subtitle: label(hit) };
  }
  const hits = await nominatim(`search?limit=5&q=${encodeURIComponent(q)}`);
  if (!hits.length) throw new Error(`couldn't find "${q}". Try adding the city and country, or use "lat, lon"`);
  // A town's boundary centre can sit in a forest; its village or town point is where the buildings are.
  const top = hits[0], [s, n, w, e] = (top.boundingbox || []).map(Number);
  const place = top.category === "boundary" && hits.find((h) => h.category === "place" && h.name === top.name && h.lat >= s && h.lat <= n && h.lon >= w && h.lon <= e);
  const hit = place || top;
  return { lat: +hit.lat, lon: +hit.lon, name: hit.display_name, title: q.split(",")[0].trim(), subtitle: label(hit) };
}

export async function loadPlace(place, R = 250) {
  const { lat, lon, name, title = place, subtitle = "" } = await geocode(place);
  const Z = 14, N = 2 ** Z;
  const tx = (lo) => ((lo + 180) / 360) * N;
  const ty = (la) => ((1 - Math.log(Math.tan((la * Math.PI) / 180) + 1 / Math.cos((la * Math.PI) / 180)) / Math.PI) / 2) * N;
  const dLat = (R * 1.2) / 110540, dLon = (R * 1.2) / (111320 * Math.cos((lat * Math.PI) / 180));
  const [x0, x1] = [Math.floor(tx(lon - dLon)), Math.floor(tx(lon + dLon))];
  const [y0, y1] = [Math.floor(ty(lat + dLat)), Math.floor(ty(lat - dLat))];

  const [tilejson, OVERTURE] = await Promise.all([fetch("https://tiles.openfreemap.org/planet", { headers: UA }).then((r) => r.json()), overture()]);
  const k = Math.cos((lat * Math.PI) / 180) * 111320;
  const feats = [];
  const seen = new Set();

  const mapTags = (layer, p) => {
    switch (layer) {
      case "building": return p.hide_3d ? null : { building: "yes", height: p.render_height, min_height: p.render_min_height, ...(p.colour ? { "building:colour": p.colour } : {}) };
      case "overture": return p.is_underground || p.has_parts ? null : { building: ovClass(p), ...ovShape(p) };
      case "overture_part": return p.is_underground ? null : { building: "part", "roof:shape": "flat", ...ovShape(p) };
      case "water": return { natural: "water", water: p.class };
      case "park": return { leisure: "park" };
      case "landcover": return { grass: { landuse: "grass" }, wood: { natural: "wood" }, sand: { natural: "sand" }, wetland: { natural: "wetland" }, farmland: { landuse: "farmland" }, rock: { natural: "bare_rock" }, ice: { natural: "glacier" } }[p.class] || null;
      case "landuse": return { residential: { landuse: "residential" }, commercial: { landuse: "commercial" }, retail: { landuse: "retail" }, industrial: { landuse: "industrial" }, railway: { landuse: "railway" }, cemetery: { landuse: "cemetery" }, stadium: { leisure: "stadium" }, pitch: { leisure: "pitch" }, playground: { leisure: "playground" }, track: { leisure: "track" }, garden: { leisure: "garden" } }[p.class] || null;
      case "transportation": {
        if (p.brunnel === "tunnel" || p.indoor) return null;
        const hw = { motorway: "motorway", trunk: "trunk", primary: "primary", secondary: "secondary", tertiary: "tertiary", minor: "residential", service: "service", path: "footway", track: "track", raceway: "service", busway: "secondary" }[p.class];
        if (hw) return { highway: hw, ...(p.brunnel === "bridge" ? { bridge: "yes" } : {}) };
        if (p.class === "rail" || p.class === "transit") return { railway: "rail" };
        return null;
      }
      case "waterway": return p.brunnel === "tunnel" ? null : { waterway: p.class === "river" ? "river" : p.class === "canal" ? "canal" : "stream" };
      default: return null;
    }
  };

  const ovShape = (p) => Object.fromEntries(Object.entries({
    height: p.height, min_height: p.min_height, "building:levels": p.num_floors, "roof:shape": p.roof_shape, "roof:height": p.roof_height,
    "roof:direction": p.roof_direction, "building:colour": p.facade_color, "roof:colour": p.roof_color,
  }).filter(([, v]) => v != null && v !== ""));

  // Overture buildings cover far more of the world than OSM alone, and carry a class.
  const ovClass = (p) => {
    const c = p.class || "", s = p.subtype || "";
    if (["house", "detached", "semidetached_house", "terrace", "bungalow", "hut", "cabin", "farm", "static_caravan"].includes(c)) return c;
    if (["apartments", "dormitory", "residential"].includes(c) || s === "residential") return c || "residential";
    if (["garage", "garages", "shed", "carport"].includes(c)) return c;
    if (["church", "cathedral", "chapel", "mosque", "temple", "synagogue", "shrine"].includes(c) || s === "religious") return c || "church";
    if (s === "industrial" || ["industrial", "warehouse", "factory"].includes(c)) return c || "industrial";
    if (s === "commercial" || ["commercial", "retail", "office", "supermarket", "hotel"].includes(c)) return c || "commercial";
    if (["school", "university", "college", "hospital", "train_station", "civic", "government"].includes(c) || ["education", "medical", "civic", "transportation"].includes(s)) return c || "civic";
    return "yes";
  };
  let overtureUsed = 0;
  async function tileLayers(x, y) {
    const url = tilejson.tiles[0].replace("{z}", Z).replace("{x}", x).replace("{y}", y);
    const base = new VectorTile(new Protobuf(Buffer.from(await (await fetch(url, { headers: UA })).arrayBuffer()))).layers;
    try {
      const t = await OVERTURE.getZxy(Z, x, y);
      const L = t && new VectorTile(new Protobuf(new Uint8Array(t.data))).layers;
      if (L?.building?.length) { overtureUsed++; return { ...base, building: undefined, overture: L.building, overture_part: L.building_part }; }
    } catch (e) { console.error("overture:", e.message); }
    return base;
  }

  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const layers = await tileLayers(x, y);
    for (const [lname, layer] of Object.entries(layers)) {
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const tags = mapTags(lname, f.properties);
        if (!tags) continue;
        const ext = layer.extent;
        const toXY = (pt) => {
          const lo = ((x + pt.x / ext) / N) * 360 - 180;
          const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + pt.y / ext)) / N))) * 180) / Math.PI;
          return [+((lo - lon) * k).toFixed(2), +(-(la - lat) * 110540).toFixed(2)];
        };
        const rings = f.loadGeometry().map((r) => r.map(toXY));
        if (f.type === 3) {
          // MVT: outer rings have positive signed area in tile space, holes negative.
          let cur = null;
          for (const r of rings) {
            const sa = r.reduce((s, a, j) => { const b = r[(j + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
            if (sa > 0 || !cur) { cur = { tags, ring: r, holes: [], closed: true }; feats.push(cur); }
            else cur.holes.push(r);
          }
        } else if (f.type === 2) {
          for (const r of rings) feats.push({ tags, ring: r, holes: [], closed: false });
        }
      }
    }
  }

  // Buildings split across tiles appear twice; drop exact repeats.
  const uniq = feats.filter((f) => { const key = (f.tags.building ? "b" + (f.tags.min_height || 0) : "") + f.ring.slice(0, 3).join(";"); if (seen.has(key)) return false; seen.add(key); return true; });
  return { name, title, subtitle, place, lat, lon, radius: R, feats: uniq, stats: { features: uniq.length, tiles: (x1 - x0 + 1) * (y1 - y0 + 1), overtureTiles: overtureUsed } };
}
