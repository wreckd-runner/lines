/*
 * Terrain slabs: black LiDAR relief with a route floating above it.
 *
 * Relief source, in order of preference:
 *   1. route.terrain  — PNG rendered at build time from the LINZ 1 m LiDAR DEM
 *   2. open terrain tiles (AWS "terrarium") shaded in the browser
 *   3. a procedural stand-in, so the page never shows an empty box
 */
(function () {
  "use strict";

  const BASE = (window.SITE_BASE || "/").replace(/\/$/, "");
  const TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  const LONG_EDGE = 900; // px for browser-rendered relief
  const SVGNS = "http://www.w3.org/2000/svg";
  const cache = new Map(); // slug -> Promise<HTMLCanvasElement|HTMLImageElement>

  /* ---------------------------------------------------------- projection */
  const mx = (lon) => (lon + 180) / 360;
  const my = (lat) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  };

  function geometry(route) {
    if (route.terrain && route.terrain.xy) {
      const t = route.terrain;
      return { w: t.w, h: t.h, xy: t.xy };
    }
    const [w0, s0, e0, n0] = route.bbox;
    const X0 = mx(w0), X1 = mx(e0), Y0 = my(n0), Y1 = my(s0);
    const aspect = (X1 - X0) / (Y1 - Y0);
    const w = aspect >= 1 ? LONG_EDGE : Math.round(LONG_EDGE * aspect);
    const h = aspect >= 1 ? Math.round(LONG_EDGE / aspect) : LONG_EDGE;
    const xy = route.line.map(([lon, lat]) => [(mx(lon) - X0) / (X1 - X0), (my(lat) - Y0) / (Y1 - Y0)]);
    return { w, h, xy };
  }

  /* --------------------------------------------------------------- shading */
  // Same recipe as scripts/build_routes.py so both sources look alike.
  function ink(z, W, H, cell) {
    const out = new Uint8ClampedArray(W * H * 4);
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < z.length; i++) { if (z[i] < zmin) zmin = z[i]; if (z[i] > zmax) zmax = z[i]; }
    const step = zmax - zmin > 300 ? 20 : 5;
    const lights = [[315, .5], [270, .2], [0, .2], [225, .1]].map(([az, w]) => [((360 - az + 90) * Math.PI) / 180, w]);
    const alt = (42 * Math.PI) / 180, sa = Math.sin(alt), ca = Math.cos(alt);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const l = z[y * W + Math.max(0, x - 1)], r = z[y * W + Math.min(W - 1, x + 1)];
        const u = z[Math.max(0, y - 1) * W + x], d = z[Math.min(H - 1, y + 1) * W + x];
        const gx = (r - l) / (2 * cell), gy = (u - d) / (2 * cell);
        const slope = Math.atan(Math.hypot(gx, gy) * 1.6);
        const aspect = Math.atan2(-gx, gy);
        let s = 0;
        for (const [a, w] of lights) s += w * (sa * Math.cos(slope) + ca * Math.sin(slope) * Math.cos(a - aspect));
        s = Math.min(1, Math.max(0, s));
        let v = 6 + 120 * Math.pow(s, 2.2) + 18 * Math.sin(slope) ** 2;
        const f = Math.abs(((((z[i] / step) % 1) + 1) % 1) - 0.5);
        if (f > 0.47) v += 14;
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
        out[i * 4 + 3] = 255;
      }
    }
    return out;
  }

  function toCanvas(rgba, W, H) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    c.getContext("2d").putImageData(new ImageData(rgba, W, H), 0, 0);
    return c;
  }

  /* ----------------------------------------------------- 2. terrain tiles */
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  async function fromTiles(route, W, H) {
    const [w0, s0, e0, n0] = route.bbox;
    const X0 = mx(w0), X1 = mx(e0), Y0 = my(n0), Y1 = my(s0);
    let z = Math.floor(Math.log2(W / ((X1 - X0) * 256)));
    z = Math.max(6, Math.min(15, z + 1));
    const n = 2 ** z;
    const tx0 = Math.floor(X0 * n), tx1 = Math.floor(X1 * n);
    const ty0 = Math.floor(Y0 * n), ty1 = Math.floor(Y1 * n);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 30) throw new Error("too many tiles");
    const mosaic = document.createElement("canvas");
    mosaic.width = (tx1 - tx0 + 1) * 256; mosaic.height = (ty1 - ty0 + 1) * 256;
    const mctx = mosaic.getContext("2d", { willReadFrequently: true });
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++)
        jobs.push(loadImage(TILE_URL.replace("{z}", z).replace("{x}", tx).replace("{y}", ty))
          .then((img) => mctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256)));
    await Promise.all(jobs);
    // crop the bbox, resample to W×H
    const sx = (X0 * n - tx0) * 256, sy = (Y0 * n - ty0) * 256;
    const sw = (X1 - X0) * n * 256, sh = (Y1 - Y0) * n * 256;
    const crop = document.createElement("canvas");
    crop.width = W; crop.height = H;
    const cctx = crop.getContext("2d", { willReadFrequently: true });
    cctx.imageSmoothingEnabled = false; // never blend encoded elevation
    cctx.drawImage(mosaic, sx, sy, sw, sh, 0, 0, W, H);
    const px = cctx.getImageData(0, 0, W, H).data;
    const zArr = new Float32Array(W * H);
    for (let i = 0; i < zArr.length; i++) zArr[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    const lat = (s0 + n0) / 2;
    const cell = (40075016.7 * Math.cos((lat * Math.PI) / 180) * (X1 - X0)) / W;
    return toCanvas(ink(zArr, W, H, cell), W, H);
  }

  /* ------------------------------------------------- 3. procedural stand-in */
  function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function fromNoise(route, W, H) {
    const seed = hash(route.slug || "x");
    const rnd = (x, y) => {
      let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const val = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const sx = xf * xf * xf * (xf * (xf * 6 - 15) + 10), sy = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      const a = rnd(xi, yi), b = rnd(xi + 1, yi), c = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    const fbm = (x, y, oct) => { let a = 0.5, s = 0; for (let o = 0; o < oct; o++) { s += a * val(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; };
    const z = new Float32Array(W * H);
    const k = 4 / Math.max(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x * k, v = y * k;
      const wx = u + 1.6 * fbm(u + 5.2, v + 1.3, 3), wy = v + 1.6 * fbm(u + 1.7, v + 9.2, 3);
      let s = 0, a = 0.55, f = 1;
      for (let o = 0; o < 6; o++) { const n = 1 - Math.abs(val(wx * f, wy * f) * 2 - 1); s += a * n * n; f *= 2.1; a *= 0.48; }
      z[y * W + x] = s * 1400;
    }
    return toCanvas(ink(z, W, H, 6), W, H);
  }

  /* ------------------------------------------------------------- relief */
  function relief(route, W, H) {
    if (cache.has(route.slug)) return cache.get(route.slug);
    let p;
    if (route.terrain && route.terrain.src) {
      p = loadImage(BASE + route.terrain.src).catch(() => fromTiles(route, W, H)).catch(() => fromNoise(route, W, H));
    } else {
      p = fromTiles(route, W, H).catch(() => fromNoise(route, W, H));
    }
    cache.set(route.slug, p);
    return p;
  }

  /* ---------------------------------------------------------------- build */
  function svg(tag, attrs, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  /**
   * Fill `host` (or a new <a>) with a slab for `route`.
   * Returns { el, pointAt(t) -> {x,y} in viewBox, cursor(t|null) }.
   */
  function build(route, opts = {}) {
    const { w: W, h: H, xy } = geometry(route);
    const el = opts.host || document.createElement(route.url ? "a" : "div");
    el.classList.add("slab");
    if (route.url && el.tagName === "A") el.href = BASE + route.url;
    el.dataset.route = route.slug;
    el.innerHTML = "";

    const body = document.createElement("div");
    body.className = "slab__body";
    const shade = document.createElement("div");
    shade.className = "slab__shade";
    // the "ground": terrain plus the line's shadow on it — can be cropped
    const ground = document.createElement("div");
    ground.className = "slab__ground";
    const canvas = document.createElement("canvas");
    canvas.className = "slab__terrain";
    canvas.width = W; canvas.height = H;
    canvas.getContext("2d").fillStyle = "#070707";
    canvas.getContext("2d").fillRect(0, 0, W, H);
    ground.append(canvas);
    body.append(shade, ground);

    const d = "M" + xy.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join("L");
    const ghost = svg("svg", { class: "slab__ghost", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
    svg("path", { d }, ghost);
    const top = svg("svg", { class: "slab__route", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
    svg("path", { d, class: "hit" }, top);
    const line = svg("path", { d, class: "line", pathLength: 1 }, top);
    line.style.setProperty("--len", 1);
    const [sx, sy] = xy[0], [ex, ey] = xy[xy.length - 1];
    const loop = Math.hypot((sx - ex) * W, (sy - ey) * H) < 12;
    if (!loop) svg("circle", { cx: ex * W, cy: ey * H, r: 4.5, class: "end", "vector-effect": "non-scaling-stroke" }, top);
    svg("circle", { cx: sx * W, cy: sy * H, r: 6, class: "start" }, top);
    const cur = svg("circle", { cx: sx * W, cy: sy * H, r: 7, class: "cursor" }, top);
    ground.append(ghost);
    body.append(top);

    if (opts.label !== false && route.title) {
      const lab = document.createElement("span");
      lab.className = "slab__label";
      lab.innerHTML = `<b>${escapeHtml(route.title)}</b><br>${route.distance_km} km${route.ascent_m ? ` · +${route.ascent_m.toLocaleString("en-NZ")} m` : ""}`;
      body.append(lab);
    }
    el.append(body);

    relief(route, W, H).then((src) => {
      const ctx = canvas.getContext("2d");
      ctx.drawImage(src, 0, 0, W, H);
    });

    // distance along the drawn line, for syncing with the elevation profile
    const seg = [0];
    for (let i = 1; i < xy.length; i++) seg.push(seg[i - 1] + Math.hypot((xy[i][0] - xy[i - 1][0]) * W, (xy[i][1] - xy[i - 1][1]) * H));
    const total = seg[seg.length - 1] || 1;
    function pointAt(t) {
      const dd = t * total;
      let i = 1;
      while (i < seg.length - 1 && seg[i] < dd) i++;
      const k = (dd - seg[i - 1]) / (seg[i] - seg[i - 1] || 1);
      return { x: (xy[i - 1][0] + (xy[i][0] - xy[i - 1][0]) * k) * W, y: (xy[i - 1][1] + (xy[i][1] - xy[i - 1][1]) * k) * H };
    }
    function cursor(t) {
      if (t == null) { cur.style.opacity = 0; return; }
      const p = pointAt(t);
      cur.setAttribute("cx", p.x); cur.setAttribute("cy", p.y);
      cur.style.opacity = 1;
    }
    // opts.crop: show only a random window of the terrain; the line runs on past its edges
    if (opts.crop) {
      const rnd = Math.random;
      const cw = 0.42 + rnd() * 0.3, ch = 0.42 + rnd() * 0.3;
      const c = pointAt(0.15 + rnd() * 0.7); // centre the window somewhere on the route
      const cx = c.x / W + (rnd() - 0.5) * 0.2, cy = c.y / H + (rnd() - 0.5) * 0.2;
      const l = Math.min(Math.max(cx - cw / 2, 0), 1 - cw), t = Math.min(Math.max(cy - ch / 2, 0), 1 - ch);
      const r = 1 - l - cw, b = 1 - t - ch;
      const pct = (v) => (v * 100).toFixed(2) + "%";
      ground.style.clipPath = `inset(${pct(t)} ${pct(r)} ${pct(b)} ${pct(l)})`;
      Object.assign(shade.style, { left: pct(l), top: pct(t + ch * 0.06), right: pct(r), bottom: pct(b - ch * 0.04) });
      el.classList.add("slab--cropped");
    }
    return { el, W, H, start: top.querySelector(".start"), pointAt, cursor };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function coords(lat, lon) {
    return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? "W" : "E"}`;
  }

  window.Terrain = { build, coords };
})();
