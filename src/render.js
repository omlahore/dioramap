import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { pixText } from "./font.js";
THREE.ColorManagement.enabled = false;

const qs = new URLSearchParams(location.search);
const data = await (await fetch(qs.get("data") || "data.json")).json();
const PX = +(qs.get("px") || 3);
const OUT_W = +(qs.get("w") || 1600), OUT_H = +(qs.get("h") || 1200);
const AZ = (+(qs.get("az") || 45) * Math.PI) / 180;
const EL = Math.atan(0.5); // 2:1 pixel-art dimetric
const R = data.radius;
const T = R * 0.07; // tile thickness

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };
let seed = 987654321;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const hex = (h) => new THREE.Color(h);
const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

// ---------- geometry helpers ----------
function clipPoly(ring) {
  let pts = ring.slice(0, ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? -1 : undefined);
  const edges = [[0, -R, 1], [0, R, -1], [1, -R, 1], [1, R, -1]]; // axis, bound, sign (inside if sign*(v-bound)>=0)
  for (const [ax, b, s] of edges) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const ina = s * (a[ax] - b) >= 0, inc = s * (c[ax] - b) >= 0;
      if (ina) out.push(a);
      if (ina !== inc) {
        const t = (b - a[ax]) / (c[ax] - a[ax]);
        out.push([a[0] + t * (c[0] - a[0]), a[1] + t * (c[1] - a[1])]);
      }
    }
    pts = out;
    if (!pts.length) break;
  }
  return pts;
}
function clipSeg(a, b) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] + R], [dx, R - a[0]], [-dy, a[1] + R], [dy, R - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}
const area = (p) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const shapeOf = (ring, holes = []) => {
  const s = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) { const c = clipPoly(h); if (c.length > 2) s.holes.push(new THREE.Path(c.map(([x, z]) => new THREE.Vector2(x, -z)))); }
  return s;
};

// Every mesh shares one material, so each geometry carries aColor and aInfo(height, id, windowStyle).
function paint(geo, color, info = [0, 0, 0], roof = null) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const n = geo.attributes.position.count, col = new Float32Array(n * 3), inf = new Float32Array(n * 3);
  const nor = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    const c = roof && nor && nor.getY(i) > 0.5 ? roof : color;
    col.set([c.r, c.g, c.b], i * 3);
    inf.set(info, i * 3);
  }
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aInfo", new THREE.BufferAttribute(inf, 3));
  geo.setAttribute("aDelay", new THREE.BufferAttribute(new Float32Array(n), 1));
  for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "aColor", "aInfo", "aDelay"].includes(k)) geo.deleteAttribute(k);
  return geo;
}
const flat = (ring, holes, y, color) => {
  const c = clipPoly(ring);
  if (c.length < 3) return null;
  const g = new THREE.ShapeGeometry(shapeOf(c, holes));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  g.computeVertexNormals();
  return paint(g, color);
};

const NIGHT = qs.get("theme") === "night";
const VIDEO = qs.get("video"); // "mp4" or "gif"
const SPIN = qs.get("spin") === "1";
const ANIM = qs.get("anim") === "1" || !!VIDEO;

// Builds the whole model with the day or night palette. Same seed, so both builds line up vertex for vertex.
function build(night) {
  seed = 987654321;
  // ---------- palette ----------
  const P = {
    ground: hex("#e4dccb"), earth: hex("#a5774f"), earthDark: hex("#7d5838"), grassEdge: hex("#7fae55"),
    grass: hex("#a6d06e"), park: hex("#93c562"), wood: hex("#79ad52"), pitch: hex("#8cc96a"), sand: hex("#f0dca0"),
    water: hex("#5eb0e5"), parking: hex("#c9c3b8"), plaza: hex("#ece4d4"), footway: hex("#efe6d3"), sidewalk: hex("#d9d2c4"),
    road: hex("#8b8e96"), roadMajor: hex("#80838c"), rail: hex("#7d6a5a"), lane: hex("#fff3c4"), car: ["#e8574a", "#f2c14e", "#4f8fd8", "#f4f1ea", "#3d4450", "#59b37a", "#e98bb5"],
    residential: hex("#e6dfcf"), commercial: hex("#e3ddd2"), industrial: hex("#dcd5c6"),
    walls: { home: ["#f3e3c3", "#f2c9a1", "#e99a7c", "#f6efe2", "#b9d7e6", "#c4e0c4", "#f4dc8f", "#efb9b3"], city: ["#f1e6d0", "#e6cfa9", "#d98b6c", "#c97559", "#f4efe6", "#b7d3e3", "#e9c27e", "#d5c9e6"], tower: ["#9fc6e0", "#7fb0d4", "#e6ddcf", "#c9d6df", "#8fc4c0", "#f1ece3"], old: ["#efdcb6", "#e6c999", "#d9b585", "#f3e5c9"], ind: ["#dcd6cc", "#cfc8bc", "#e6dccb"] },
    roofs: { home: ["#d0583f", "#b8483a", "#c96b46", "#8e5a4a", "#5f7c8c", "#d17a3f"], city: ["#a9a29a", "#958f88", "#b8b0a4", "#c25a43", "#6f8796"], tower: ["#8d9aa6", "#7b8894", "#a7b1ba"], old: ["#5f7d8a", "#4f8a8b", "#a0523f"], ind: ["#a8adb0", "#bcc1c3"] },
    trees: ["#5fa847", "#71b851", "#4f9a3f", "#85c25a", "#63a64a"], trunk: hex("#80603f"),
  };
  if (night) Object.assign(P, { ground: hex("#3a3f52"), residential: hex("#3d4256"), commercial: hex("#3f4458"), industrial: hex("#3b4052"), grass: hex("#2f5640"), park: hex("#2b513c"), wood: hex("#244a35"), pitch: hex("#2f5a42"), water: hex("#1f3d66"), road: hex("#2a2d38"), roadMajor: hex("#262934"), sidewalk: hex("#4a4f63"), footway: hex("#545a70"), plaza: hex("#4d536a"), lane: hex("#f6d77a"), earth: hex("#4a3a33"), earthDark: hex("#33282a") });

  // ---------- build ----------
  const geos = [];
  const num = (v) => { if (v == null) return NaN; const m = String(v).match(/-?[\d.]+/); if (!m) return NaN; return /ft|'/.test(v) ? +m[0] * 0.3048 : +m[0]; };

  // Tile: ground top, earth sides.
  {
    const g = new THREE.BoxGeometry(2 * R, T, 2 * R);
    g.translate(0, -T / 2, 0);
    geos.push(paint(g, P.earth, [0, 0, 0], P.ground));
    const band = new THREE.BoxGeometry(2 * R + 0.02, T * 0.18, 2 * R + 0.02);
    band.translate(0, -T * 0.91, 0);
    geos.push(paint(band, P.earthDark));
  }

  const trees = [];
  const waters = data.feats.filter((f) => f.closed && f.tags && (f.tags.natural === "water" || ["riverbank", "dock"].includes(f.tags.waterway))).map((f) => f.ring);
  const LAND = [
    [(t) => t.landuse === "residential", 0.02, P.residential],
    [(t) => ["commercial", "retail"].includes(t.landuse), 0.02, P.commercial],
    [(t) => ["industrial", "railway", "construction"].includes(t.landuse), 0.02, P.industrial],
    [(t) => ["grass", "meadow", "village_green", "recreation_ground", "allotments", "cemetery"].includes(t.landuse) || ["grassland", "heath"].includes(t.natural), 0.06, P.grass, 0.004],
    [(t) => ["park", "garden", "nature_reserve", "golf_course"].includes(t.leisure), 0.08, P.park, 0.012],
    [(t) => ["pitch", "track", "stadium", "playground"].includes(t.leisure), 0.12, P.pitch],
    [(t) => t.landuse === "forest" || ["wood", "scrub"].includes(t.natural), 0.1, P.wood, 0.03],
    [(t) => ["beach", "sand", "bare_rock"].includes(t.natural), 0.1, P.sand],
    [(t) => t.natural === "water" || ["riverbank", "dock"].includes(t.waterway) || t.leisure === "swimming_pool", 0.14, P.water],
    [(t) => t.amenity === "parking", 0.16, P.parking],
    [(t) => t.highway && (t.area === "yes" || t.highway === "pedestrian"), 0.18, P.plaza],
  ];
  for (const f of data.feats) {
    if (f.kind === "tree") { if (Math.abs(f.p[0]) < R && Math.abs(f.p[1]) < R) trees.push(f.p); continue; }
    const t = f.tags;
    if (t.building || !f.closed) continue;
    const rule = LAND.find(([test]) => test(t));
    if (!rule) continue;
    const g = flat(f.ring, f.holes, rule[1], rule[2]);
    if (g && rule[2] === P.water) { const inf = g.attributes.aInfo.array; for (let j = 2; j < inf.length; j += 3) inf[j] = 3; }
    if (g) geos.push(g);
    if (rule[3]) {
      const c = clipPoly(f.ring);
      if (c.length < 3) continue;
      const n = Math.min(400, Math.floor(area(c) * rule[3]));
      const xs = c.map((p) => p[0]), zs = c.map((p) => p[1]);
      const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
        const p = [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)];
        if (inside(p, c) && !f.holes.some((h) => inside(p, h)) && !waters.some((w) => inside(p, w))) trees.push(p), i++;
      }
    }
  }

  // Dashed centre lines: split a polyline into [len] on, [gap] off.
  const dashes = (pts, len, gap) => {
    const out = [];
    let on = true, left = len, cur = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      let [a, b] = [pts[i], pts[i + 1]];
      let L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (L > 1e-6) {
        const step = Math.min(left, L), t = step / L;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (on) cur.push(p);
        a = p, (L -= step), (left -= step);
        if (left <= 1e-6) { if (on && cur.length > 1) out.push(cur); on = !on; left = on ? len : gap; cur = [p]; }
      }
    }
    if (on && cur.length > 1) out.push(cur);
    return out;
  };

  // Parked and moving cars: small boxes along the road, either side of the centre line.
  const cars = (pts, w) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (let d = 6 + rnd() * 14; d < L - 4; d += 14 + rnd() * 26) {
        const side = rnd() < 0.5 ? -1 : 1, off = side * w * (0.18 + rnd() * 0.12);
        const x = a[0] + ((b[0] - a[0]) * d) / L - Math.sin(ang) * off, z = a[1] + ((b[1] - a[1]) * d) / L + Math.cos(ang) * off;
        if (Math.abs(x) > R - 3 || Math.abs(z) > R - 3) continue;
        const body = new THREE.BoxGeometry(4.4, 1.3, 1.9);
        body.rotateY(-ang);
        body.translate(x, 0.95, z);
        out.push(paint(body, hex(pick(P.car, rnd()))));
        const cab = new THREE.BoxGeometry(2.2, 0.8, 1.7);
        cab.rotateY(-ang);
        cab.translate(x, 1.95, z);
        out.push(paint(cab, hex(night ? "#f6e7a8" : "#d9e6ee")));
      }
    }
    return out;
  };

  // Roads and rails as ribbons with round joints.
  const RW = { motorway: 16, trunk: 14, primary: 13, secondary: 11, tertiary: 10, unclassified: 8, residential: 8, living_street: 6, service: 4.5, motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 7, tertiary_link: 7, footway: 2.4, path: 2, cycleway: 2.4, steps: 2.4, track: 3, bridleway: 2 };
  const ribbon = (pts, w, y, color, caps = true) => {
    const parts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const s = clipSeg(pts[i], pts[i + 1]);
      if (!s) continue;
      const [a, b] = s, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * w / 2, nz = (dx / L) * w / 2;
      const quad = new THREE.BufferGeometry();
      quad.setAttribute("position", new THREE.Float32BufferAttribute([a[0] + nx, y, a[1] + nz, b[0] + nx, y, b[1] + nz, b[0] - nx, y, b[1] - nz, a[0] + nx, y, a[1] + nz, b[0] - nx, y, b[1] - nz, a[0] - nx, y, a[1] - nz], 3));
      quad.setAttribute("normal", new THREE.Float32BufferAttribute(Array(18).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
      parts.push(paint(quad, color));
      for (const p of caps ? [a, b] : []) {
        if (Math.abs(p[0]) > R - w / 2 || Math.abs(p[1]) > R - w / 2) continue;
        const d = new THREE.CircleGeometry(w / 2, 8);
        d.rotateX(-Math.PI / 2);
        d.translate(p[0], y, p[1]);
        parts.push(paint(d, color));
      }
    }
    return parts;
  };
  for (const f of data.feats) {
    const t = f.tags || {};
    if (t.tunnel && t.tunnel !== "no") continue;
    if (num(t.layer) < 0 || t.indoor === "yes" || t.location === "underground") continue;
    if (t.highway && RW[t.highway] && !(f.closed && t.area === "yes")) {
      const foot = RW[t.highway] < 3;
      const major = RW[t.highway] >= 11;
      const w = RW[t.highway] * (t.lanes && !foot ? Math.min(1.4, 0.7 + num(t.lanes) * 0.15) : 1);
      if (!foot) geos.push(...ribbon(f.ring, w + 3.4, 0.2, P.sidewalk));
      geos.push(...ribbon(f.ring, w, foot ? 0.22 : major ? 0.28 : 0.26, foot ? P.footway : major ? P.roadMajor : P.road));
      if (w >= 6 && t.highway !== "service") geos.push(...cars(f.ring, w));
      if (w >= 9 && t.bridge !== "yes") for (const d of dashes(f.ring, 3.5, 6)) geos.push(...ribbon(d, 0.7, 0.34, P.lane, false));
    } else if (t.railway) {
      geos.push(...ribbon(f.ring, 3.2, 0.3, P.rail));
    } else if (t.waterway && ["river", "canal", "stream"].includes(t.waterway) && !f.closed) {
      geos.push(...ribbon(f.ring, t.waterway === "stream" ? 2.5 : 8, 0.15, P.water));
    }
  }

  // Pitched roofs: a gable over near-rectangular footprints, a pyramid otherwise.
  // Triangles are flipped to face away from the roof's centre so normals light correctly.
  function solid(tris, centre) {
    const pos = [];
    for (const [a, b, c] of tris) {
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const mid = a.clone().add(b).add(c).divideScalar(3).sub(centre);
      for (const v of n.dot(mid) < 0 ? [a, c, b] : [a, b, c]) pos.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }
  function roofOf(c, base, height, pyramid) {
    let best = null;
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const cs = Math.cos(-ang), sn = Math.sin(-ang);
      const r = c.map(([x, z]) => [x * cs - z * sn, x * sn + z * cs]);
      const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
      const box = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      const A = (box[1] - box[0]) * (box[3] - box[2]);
      if (!best || A < best.A) best = { A, box, ang };
    }
    const V = (x, y, z) => { const cs = Math.cos(best.ang), sn = Math.sin(best.ang); return new THREE.Vector3(x * cs - z * sn, y, x * sn + z * cs); };
    let [x0, x1, z0, z1] = best.box;
    const longX = x1 - x0 >= z1 - z0, short = longX ? z1 - z0 : x1 - x0;
    const rh = height || Math.min(4.5, short * 0.42), top = base + rh;
    if (!pyramid && area(c) / best.A > 0.82) {
      const zm = (z0 + z1) / 2, xm = (x0 + x1) / 2;
      const [p1, p2, p3, p4] = [V(x0, base, z0), V(x1, base, z0), V(x1, base, z1), V(x0, base, z1)];
      const [r1, r2] = longX ? [V(x0, top, zm), V(x1, top, zm)] : [V(xm, top, z0), V(xm, top, z1)];
      const centre = V(xm, base + rh / 3, zm);
      const slopes = longX ? [[p1, p2, r2], [p1, r2, r1], [p4, p3, r2], [p4, r2, r1]] : [[p1, p4, r2], [p1, r2, r1], [p2, p3, r2], [p2, r2, r1]];
      const ends = longX ? [[p1, p4, r1], [p2, p3, r2]] : [[p1, p2, r1], [p4, p3, r2]];
      return { slopes: solid(slopes, centre), ends: solid(ends, centre) };
    }
    const cx = c.reduce((s, p) => s + p[0], 0) / c.length, cz = c.reduce((s, p) => s + p[1], 0) / c.length;
    const apex = new THREE.Vector3(cx, top, cz), centre = new THREE.Vector3(cx, base + rh / 3, cz);
    return { slopes: solid(c.map((p, i) => [new THREE.Vector3(p[0], base, p[1]), new THREE.Vector3(c[(i + 1) % c.length][0], base, c[(i + 1) % c.length][1]), apex]), centre) };
  }

  // A skillion is one sloping plane: highest at the back, falling towards roof:direction (a compass bearing).
  function skillion(c, base, low, high, bearing) {
    const b = (bearing * Math.PI) / 180, s = c.map(([x, z]) => x * Math.sin(b) - z * Math.cos(b));
    const s0 = Math.min(...s), span = Math.max(...s) - s0 || 1;
    const V = (i, y) => new THREE.Vector3(c[i][0], y, c[i][1]), topY = (i) => high - ((high - low) * (s[i] - s0)) / span;
    const ccw = c.reduce((acc, a, i) => acc + a[0] * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * a[1], 0) > 0;
    const walls = [], top = [];
    const add = (out, a, b2, c2, want) => out.push(new THREE.Vector3().subVectors(b2, a).cross(new THREE.Vector3().subVectors(c2, a)).dot(want) < 0 ? [a, c2, b2] : [a, b2, c2]);
    for (let i = 0; i < c.length; i++) {
      const j = (i + 1) % c.length, ex = c[j][0] - c[i][0], ez = c[j][1] - c[i][1];
      const out = new THREE.Vector3(ccw ? ez : -ez, 0, ccw ? -ex : ex);
      add(walls, V(i, base), V(j, base), V(j, topY(j)), out);
      add(walls, V(i, base), V(j, topY(j)), V(i, topY(i)), out);
    }
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(c.map(([x, z]) => new THREE.Vector2(x, z)), [])) add(top, V(i, topY(i)), V(j, topY(j)), V(k, topY(k)), new THREE.Vector3(0, 1, 0));
    const geo = (tris) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat().flatMap((v) => [v.x, v.y, v.z]), 3));
      g.computeVertexNormals();
      return g;
    };
    return { walls: geo(walls), top: geo(top) };
  }
  // Domes and onions: a half sphere as wide as the footprint.
  function dome(c, base, height) {
    const r = Math.sqrt(area(c) / Math.PI), cx = c.reduce((a, p) => a + p[0], 0) / c.length, cz = c.reduce((a, p) => a + p[1], 0) / c.length;
    const g = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(r, height || r, r);
    g.translate(cx, base, cz);
    return g;
  }

  // Buildings. "dense" = buildings cover more than a quarter of the tile.
  const bArea = data.feats.reduce((a, f) => a + (f.tags && f.tags.building && f.closed ? area(clipPoly(f.ring)) || 0 : 0), 0);
  const dense = bArea / (4 * R * R) > 0.25;
  let maxH = 10;
  let bid = 0;
  for (const f of data.feats) {
    const t = f.tags || {};
    if (!t.building || !f.closed || t.building === "roof") continue;
    if (num(t.layer) < 0) continue;
    const c = clipPoly(f.ring);
    if (c.length < 3 || area(c) < 4) continue;
    const id = hash(f.ring[0].join(","));
    let h = num(t.height);
    if (!(h > 0)) {
      const lv = num(t["building:levels"]);
      if (lv > 0) h = lv * 3.3 + 1;
    }
    const typ = t.building;
    const homeish = ["house", "detached", "semidetached_house", "terrace", "bungalow", "farm", "hut", "cabin"].includes(typ);
    const fp = area(c);
    if (!(h > 0)) {
      const known = { house: 7, detached: 7, semidetached_house: 7, terrace: 9, apartments: 16, garage: 3, garages: 3, shed: 2.5, carport: 2.5, retail: 7, office: 18, industrial: 9, warehouse: 9, church: 16, cathedral: 32, school: 11, hospital: 20, kiosk: 3, hut: 3 }[typ];
      // Unknown buildings: bigger footprints in built-up areas tend to be taller.
      const guess = fp < 70 ? 4 + 3 * id : fp < 250 ? (dense ? 9 + 9 * id : 6 + 4 * id) : fp < 1200 ? (dense ? 14 + 12 * id : 8 + 6 * id) : 8 + 8 * id;
      h = known ? known * (0.8 + 0.45 * id) : guess;
    }
    const minH = num(t.min_height) || (num(t["building:min_level"]) * 3.3) || 0;
    h = Math.max(2.5, h - minH);
    maxH = Math.max(maxH, h + minH);
    const kind = h > 45 ? "tower" : homeish ? "home" : ["industrial", "warehouse", "garage", "garages", "shed"].includes(typ) ? "ind" : ["church", "cathedral", "chapel", "temple", "mosque", "synagogue", "civic", "government", "train_station"].includes(typ) || t.historic ? "old" : "city";
    const shape = t["roof:shape"], rH = num(t["roof:height"]);
    const guess = !shape && h < 16 && fp < 600 && kind !== "ind" && hash(id + 1) < (homeish ? 0.9 : typ === "yes" && !dense && fp < 250 ? 0.75 : 0.2);
    const form = ["dome", "onion"].includes(shape) ? "dome" : ["pyramidal", "cone"].includes(shape) ? "pyramid" : shape === "skillion" && rH > 0 ? "skillion" : ["gabled", "hipped", "half-hipped", "gambrel", "mansard", "round", "saltbox", "skillion"].includes(shape) || guess ? "pitched" : null;
    // With a mapped roof height the roof is part of the height. Without one, a small roof sits on top as before.
    const roofH = form && rH > 0 ? Math.min(rH, h - 0.5) : 0, wallH = h - roofH;
    // Spires, domes and towers like the Eiffel Tower are mostly roof: no windows, and the roof takes the wall colour.
    const structure = roofH > h * 0.5;
    const colour = (v) => (v && /^#/.test(v) ? (v === "#000000" ? "#3b3b3b" : v) : null);
    const wall = hex(colour(t["building:colour"]) || pick(P.walls[kind], id));
    const roof = hex(colour(t["roof:colour"]) || (structure && colour(t["building:colour"])) || pick(P.roofs[kind], hash(id)));
    // Window style: 0 none, 1 windows, 2 glass tower, 4 landmark that is floodlit at night.
    const info = [wallH + minH, (bid++ % 997) / 997, structure ? 4 : kind === "tower" ? 2 : kind === "ind" ? 0 : 1];
    const roofInfo = structure ? info : undefined;
    if (form === "skillion") {
      const sk = skillion(c, minH, minH + wallH, minH + h, num(t["roof:direction"]) || 0);
      geos.push(paint(sk.walls, wall, info), paint(sk.top, roof, roofInfo));
      continue;
    }
    const g = new THREE.ExtrudeGeometry(shapeOf(c, f.holes), { depth: wallH, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, minH, 0);
    g.computeVertexNormals();
    geos.push(paint(g, wall, info, roof));
    if (form === "dome") geos.push(paint(dome(c, minH + wallH, roofH), roof, roofInfo));
    else if (form) {
      const rf = roofOf(c, minH + wallH, roofH, form === "pyramid");
      geos.push(paint(rf.slopes, roof, roofInfo));
      if (rf.ends) geos.push(paint(rf.ends, wall, roofInfo));
    }
  }

  // Trees: chunky canopies on short trunks.
  for (const [x, z] of trees) {
    const r = 1.8 + rnd() * 1.6, th = 1.2 + rnd();
    const trunk = new THREE.BoxGeometry(0.6, th, 0.6);
    trunk.translate(x, th / 2, z);
    geos.push(paint(trunk, P.trunk));
    const can = new THREE.IcosahedronGeometry(r, 0);
    can.scale(1, 1.15, 1);
    can.translate(x, th + r * 0.9, z);
    geos.push(paint(can, hex(pick(P.trees, rnd())), [0, 0, 0]));
  }
  // Ground-level pieces never animate; everything else rises in a wave from the centre.
  for (const g of geos) {
    g.computeBoundingBox();
    const bb = g.boundingBox;
    g.attributes.aDelay.array.fill(bb.max.y < 0.5 ? -1 : Math.hypot((bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2) / (R * 1.42));
  }
  return { geom: mergeGeometries(geos), maxH, dense, bArea, bid, trees };
}
const { geom, maxH, dense, bArea, bid, trees } = build(NIGHT && !ANIM);
const nightCol = ANIM ? build(true).geom.attributes.aColor : null;
geom.setAttribute("aColorN", nightCol && nightCol.count === geom.attributes.aColor.count ? nightCol : geom.attributes.aColor.clone());
// Grow animation: each piece rises out of the ground after its delay, with a little overshoot.
const GROW = `
  attribute float aDelay; uniform float uGrow;
  vec3 grown(vec3 p){
    if (aDelay < 0.) return p;
    float g = clamp((uGrow - aDelay * 0.65) / 0.35, 0., 1.) - 1.;
    return vec3(p.x, mix(-1.5, p.y, 1. + 2.70158 * g * g * g + 1.70158 * g * g), p.z);
  }`;
const mat = new THREE.ShaderMaterial({
  uniforms: {
    uNight: { value: NIGHT ? 1 : 0 }, uGrow: { value: 1 }, uTime: { value: 0 }, uR: { value: R }, uView: { value: new THREE.Vector2(Math.sin(AZ), Math.cos(AZ)) },
    uSun: { value: new THREE.Vector3(Math.sin(AZ - 0.9), 1.6, Math.cos(AZ - 0.9)).normalize() }, uShadow: { value: null }, uLightVP: { value: new THREE.Matrix4() }, uBias: { value: 0 },
  },
  vertexShader: `
    attribute vec3 aColor; attribute vec3 aColorN; attribute vec3 aInfo;
    varying vec3 vColor; varying vec3 vColorN; varying vec3 vN; varying vec3 vW; varying vec3 vInfo;
    ${GROW}
    void main(){ vColor=aColor; vColorN=aColorN; vInfo=aInfo; vN=normalize(mat3(modelMatrix)*normal);
      vec4 w=modelMatrix*vec4(grown(position),1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `
    uniform float uNight; uniform float uTime; uniform float uR; uniform vec2 uView; uniform vec3 uSun; uniform sampler2D uShadow; uniform mat4 uLightVP; uniform float uBias;
    varying vec3 vColor; varying vec3 vColorN; varying vec3 vN; varying vec3 vW; varying vec3 vInfo;
    float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
    void main(){
      // Night sweeps in from the far side of the tile as uNight goes from 0 to 1.
      float nt = clamp((uNight*1.3 - (dot(vW.xz, uView)/(uR*1.42)*0.5+0.5))/0.3, 0., 1.);
      vec3 n=normalize(vN); vec3 c=mix(vColor, vColorN, nt);
      if(vInfo.z>0.5 && vInfo.z<2.5 && abs(n.y)<0.5){
        float fl = vInfo.z>1.5 ? 3.6 : 3.3;
        float along = abs(n.x)>abs(n.z) ? vW.z : vW.x;
        float fy=fract(vW.y/fl), fx=fract(along/(vInfo.z>1.5 ? 2.2 : 3.0));
        bool win = vW.y>1.4 && vW.y<vInfo.x-1.2 && fy>0.30 && fy<0.74 && fx>0.2 && fx<(vInfo.z>1.5 ? 0.8 : 0.66);
        if(win){
          float lit=h31(vec3(floor(along/2.6), floor(vW.y/fl), vInfo.y*131.));
          vec3 glass = vInfo.z>1.5 ? vec3(0.36,0.50,0.64) : vec3(0.33,0.39,0.48);
          float th = mix(0.95, 0.55, nt);
          c = lit>th ? vec3(0.98,0.88,0.56) : mix(c*0.55, glass, 0.7);
          if (nt>0.5 && lit>th) { gl_FragColor=vec4(c,1.); return; }
        }
      }
      if(vInfo.z>2.5 && vInfo.z<3.5 && n.y>0.5){
        float sp=h31(vec3(floor((vW.x+uTime*1.5)/1.3), floor(vW.z/0.7), 3.));
        if(sp>0.94) c=mix(c, vec3(1.), 0.45); else if(sp>0.86) c=mix(c, vec3(1.), 0.18);
      }
      float d = dot(n, uSun);
      float l = n.y>0.6 ? 1.0 : (d>0.25 ? 0.88 : 0.68);
      vec4 lc = uLightVP * vec4(vW + n*0.15, 1.);
      vec3 sc = lc.xyz / lc.w * 0.5 + 0.5;
      if (d > 0.0 && sc.x>0. && sc.x<1. && sc.y>0. && sc.y<1. && sc.z - uBias > texture2D(uShadow, sc.xy).x) l *= 0.74;
      l *= mix(1., 0.55, nt);
      // Landmarks are floodlit: warm gold at night, brighter towards the top.
      if (vInfo.z>3.5) { float up = clamp(vW.y/max(vInfo.x, 1.), 0., 1.); c = mix(c, vec3(0.98, 0.74, 0.36) * (0.8 + 0.25*up), nt*0.8); l = mix(l, d>0.25 ? 1.0 : 0.82, nt); }
      gl_FragColor=vec4(c*l,1.);
    }`,
});
const depthMat = new THREE.ShaderMaterial({
  uniforms: { uGrow: mat.uniforms.uGrow },
  vertexShader: `${GROW}\n void main(){ gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(grown(position),1.); }`,
  fragmentShader: `void main(){ gl_FragColor=vec4(1.); }`,
});
const scene = new THREE.Scene();
scene.add(new THREE.Mesh(geom, mat));

// ---------- camera + pixel pipeline ----------
// The output is exactly OUT_W x OUT_H: the map on top, the plaque band under it.
const plaque = qs.get("plaque") !== "0";
const S = Math.max(2, Math.round(OUT_W / 600)), band = plaque ? 34 * S : 0;
const lowW = Math.floor(OUT_W / PX), lowH = Math.floor((OUT_H - band) / PX), mapX = Math.floor((OUT_W - lowW * PX) / 2);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10 * R + 4 * maxH);
const aim = (az) => {
  cam.position.set(Math.sin(az) * Math.cos(EL), Math.sin(EL), Math.cos(az) * Math.cos(EL)).multiplyScalar(4 * R + 2 * maxH);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
};
// Fit the frame to the model. A spinning view is fitted from every side so the zoom stays put.
const fitAz = SPIN ? Array.from({ length: 16 }, (_, i) => AZ + (i * Math.PI) / 8) : [AZ];
const pa = geom.attributes.position.array;
let [l, r, b, t] = [Infinity, -Infinity, Infinity, -Infinity];
for (const az of fitAz) {
  aim(az);
  const vm = cam.matrixWorldInverse.elements;
  for (let i = 0; i < pa.length; i += 3) {
    const x = vm[0] * pa[i] + vm[4] * pa[i + 1] + vm[8] * pa[i + 2], y = vm[1] * pa[i] + vm[5] * pa[i + 1] + vm[9] * pa[i + 2];
    if (x < l) l = x; if (x > r) r = x; if (y < b) b = y; if (y > t) t = y;
  }
}
aim(AZ);
const m = 0.04 * (r - l);
[l, r, b, t] = [l - m, r + m, b - m, t + m];
const aspect = lowW / lowH, cx = (l + r) / 2, cy = (b + t) / 2;
let hw = (r - l) / 2, hh = (t - b) / 2;
if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
Object.assign(cam, { left: cx - hw, right: cx + hw, bottom: cy - hh, top: cy + hh });
cam.updateProjectionMatrix();

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setSize(lowW, lowH, false);
renderer.domElement.style.width = lowW * PX + "px";
renderer.domElement.style.height = lowH * PX + "px";
document.body.appendChild(renderer.domElement);

const rt = new THREE.WebGLRenderTarget(lowW, lowH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
rt.depthTexture = new THREE.DepthTexture(lowW, lowH);
const DAY_BG = "#f1ebdd", NIGHT_BG = "#1b1f2e";
const bg = hex(qs.get("bg") || (NIGHT ? NIGHT_BG : DAY_BG));
scene.background = bg;
const post = new THREE.ShaderMaterial({
  uniforms: { tColor: { value: rt.texture }, tDepth: { value: rt.depthTexture }, texel: { value: new THREE.Vector2(1 / lowW, 1 / lowH) }, thresh: { value: 1.5 / (cam.far - cam.near) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
  fragmentShader: `
    uniform sampler2D tColor, tDepth; uniform vec2 texel; uniform float thresh; varying vec2 vUv;
    float D(vec2 o){ return texture2D(tDepth, vUv+o*texel).x; }
    void main(){
      vec3 c=texture2D(tColor,vUv).rgb; float d=D(vec2(0.));
      float e=max(max(d-D(vec2(1.,0.)), d-D(vec2(-1.,0.))), max(d-D(vec2(0.,1.)), d-D(vec2(0.,-1.))));
      if(e>thresh) c*=0.62;
      gl_FragColor=vec4(c,1.);
    }`,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
const postScene = new THREE.Scene();
postScene.add(quad);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// Sun shadows: render depth from the sun, then sample it in the main pass.
const sun = mat.uniforms.uSun.value;
const SM = 4096, ext = R * 1.5 + maxH;
const lightCam = new THREE.OrthographicCamera(-ext, ext, ext, -ext, 1, 4 * ext + 4 * maxH);
lightCam.position.copy(sun.clone().multiplyScalar(2 * ext + 2 * maxH));
lightCam.lookAt(0, 0, 0);
lightCam.updateMatrixWorld();
lightCam.updateProjectionMatrix();
const srt = new THREE.WebGLRenderTarget(SM, SM);
srt.depthTexture = new THREE.DepthTexture(SM, SM);
mat.uniforms.uShadow.value = srt.depthTexture;
mat.uniforms.uLightVP.value.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse);
mat.uniforms.uBias.value = 0.6 / (lightCam.far - lightCam.near);

// One frame. The video maker calls this with grow (0-1), night (0-1), az (degrees) and time (seconds).
let shadowAt = null;
function draw(o = {}) {
  const U = mat.uniforms;
  if (o.grow !== undefined) U.uGrow.value = o.grow;
  if (o.night !== undefined) U.uNight.value = o.night;
  if (o.time !== undefined) U.uTime.value = o.time;
  if (o.az !== undefined) aim((o.az * Math.PI) / 180);
  if (ANIM) scene.background = hex(DAY_BG).lerp(hex(NIGHT_BG), U.uNight.value);
  if (shadowAt !== U.uGrow.value) {
    scene.overrideMaterial = depthMat;
    renderer.setRenderTarget(srt);
    renderer.render(scene, lightCam);
    scene.overrideMaterial = null;
    shadowAt = U.uGrow.value;
  }
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}

// ---------- poster: upscale with hard pixels and add a pixel-font plaque ----------
const outC = document.createElement("canvas");
outC.id = "out";
outC.width = OUT_W + (VIDEO ? OUT_W % 2 : 0); // H.264 wants even sizes
outC.height = OUT_H + (VIDEO ? OUT_H % 2 : 0);
const ctx = outC.getContext("2d", { willReadFrequently: VIDEO === "gif" });
ctx.imageSmoothingEnabled = false;
const tone = (day, night, n) => "#" + hex(day).lerp(hex(night), n).getHexString();
function poster(n = NIGHT ? 1 : 0) {
  ctx.fillStyle = ANIM ? tone(DAY_BG, NIGHT_BG, n) : "#" + bg.getHexString();
  ctx.fillRect(0, 0, outC.width, outC.height);
  ctx.drawImage(renderer.domElement, mapX, 0, lowW * PX, lowH * PX);
  if (!plaque) return;
  const ink = tone("#3d342c", "#f3e7c9", n), soft = tone("#8a7d6c", "#a9a08a", n);
  const x = 12 * S, y = lowH * PX - 4 * S;
  pixText(ctx, qs.get("title") || data.title || data.place, x, y, 2 * S, ink);
  pixText(ctx, qs.get("subtitle") ?? data.subtitle ?? "", x, y + 17 * S, S, ink);
  const ll = `${Math.abs(data.lat).toFixed(4)}° ${data.lat >= 0 ? "N" : "S"}  ${Math.abs(data.lon).toFixed(4)}° ${data.lon >= 0 ? "E" : "W"}`;
  const fs = Math.max(1, S - 1);
  pixText(ctx, ll, x, y + 26 * S, fs, soft);
  const credit = "MAP DATA (C) OPENSTREETMAP CONTRIBUTORS, OVERTURE MAPS";
  pixText(ctx, credit, outC.width - 12 * S - credit.length * 6 * fs, y + 26 * S, fs, soft);
  const mark = "GITHUB.COM/OMLAHORE/DIORAMAP";
  pixText(ctx, mark, outC.width - 12 * S - mark.length * 6 * S + S, y + 17 * S, S, soft);
}

// ---------- video: the city rises out of the street map, then night falls ----------
async function video(kind) {
  const fps = kind === "gif" ? 15 : 30, len = NIGHT ? 6 : 7.5, n = Math.round(len * fps), az0 = (AZ * 180) / Math.PI;
  const ramp = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a))), smooth = (x) => x * x * (3 - 2 * x);
  const frame = (t) => {
    const night = NIGHT ? 1 : smooth(ramp(t, 4, 5.8));
    draw({ grow: ramp(t, 0.4, 3), night, time: t, az: SPIN ? az0 + 360 * smooth(t / len) : az0 });
    poster(night);
  };
  if (kind === "gif") {
    const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
    const { width: w, height: h } = outC, px = () => ctx.getImageData(0, 0, w, h).data;
    // One palette for the whole loop, taken from the finished city by day and by night.
    frame(3.5);
    const day = px();
    frame(len);
    const both = new Uint8ClampedArray(day.length * 2);
    both.set(day), both.set(px(), day.length);
    const palette = quantize(both, 256);
    const gif = GIFEncoder();
    for (let i = 0; i < n; i++) {
      frame(i / fps);
      gif.writeFrame(applyPalette(px(), palette), w, h, { palette, delay: i === n - 1 ? 1500 : 1000 / fps });
    }
    gif.finish();
    return gif.bytes();
  }
  const { mp4 } = await import("./mp4.js");
  const config = { codec: "avc1.640033", width: outC.width, height: outC.height, bitrate: 12e6, framerate: fps, avc: { format: "avc" } };
  if (!window.VideoEncoder || !(await VideoEncoder.isConfigSupported(config)).supported) throw new Error("this browser can't encode H.264 video, try --gif instead");
  const chunks = [];
  let avcC, failed;
  const enc = new VideoEncoder({
    output: (c, meta) => {
      if (meta?.decoderConfig?.description) avcC = new Uint8Array(meta.decoderConfig.description);
      const d = new Uint8Array(c.byteLength);
      c.copyTo(d);
      chunks.push({ data: d, key: c.type === "key" });
    },
    error: (e) => (failed = e),
  });
  enc.configure(config);
  for (let i = 0; i < n && !failed; i++) {
    frame(i / fps);
    const vf = new VideoFrame(outC, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: i % 60 === 0 });
    vf.close();
    while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
  }
  await enc.flush();
  if (failed) throw failed;
  return mp4(chunks, avcC, outC.width, outC.height, fps);
}

if (VIDEO) {
  const bytes = await video(VIDEO);
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  window.__video = btoa(b64);
} else if (ANIM) {
  window.__dio = { draw, canvas: renderer.domElement, data, lowW, lowH };
} else {
  draw();
  poster();
  renderer.domElement.style.display = "none";
  document.body.appendChild(outC);
}
window.__done = { dense, cover: +(bArea / (4 * R * R)).toFixed(2), buildings: bid, trees: trees.length, maxH: Math.round(maxH) };
console.log("rendered", JSON.stringify(window.__done));
