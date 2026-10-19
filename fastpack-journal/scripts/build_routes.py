#!/usr/bin/env python3
"""
Turn every .gpx in /routes into:

  src/_data/routes.json      simplified line, elevation profile and stats per route
  src/assets/terrain/*.png   black LiDAR hillshade "slab" behind each route (optional)

Usage
  python scripts/build_routes.py             # routes only (fast, no network)
  python scripts/build_routes.py --terrain   # also render LiDAR slabs from LINZ

The terrain step reads the public LINZ nz-elevation catalogue (1 m LiDAR DEM,
8 m DEM filling any gaps) through `linz-stac-utils`. If that package or the
network isn't available the site still works: the browser draws the relief
itself from open terrain tiles.

The route slug is the GPX filename: routes/southern-crossing.gpx -> "southern-crossing".
A post links to it with `route: southern-crossing` in its front matter.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

try:
    from defusedxml import ElementTree as ET  # safe against XML bombs
except ImportError:  # pragma: no cover
    import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
GPX_DIR = ROOT / "routes"
OUT_JSON = ROOT / "src" / "_data" / "routes.json"
TERRAIN_DIR = ROOT / "src" / "assets" / "terrain"

R_EARTH = 6371008.8
MAP_POINTS_TOLERANCE_M = 12      # Douglas-Peucker tolerance for the drawn line
PROFILE_SAMPLES = 160            # points in the elevation profile
SLAB_PX = 1400                   # long edge of a rendered terrain slab


# ---------------------------------------------------------------- GPX parsing
def parse_gpx(path: Path) -> list[tuple[float, float, float | None]]:
    tree = ET.parse(path)
    root = tree.getroot()
    if not root.tag.lower().endswith("gpx"):
        raise ValueError(f"{path.name}: not a GPX file")
    pts = []
    # track points first, then route points, then waypoints as a last resort
    for tag in ("trkpt", "rtept", "wpt"):
        for el in root.iter():
            if el.tag.split("}")[-1] != tag:
                continue
            try:
                lat = float(el.attrib["lat"])
                lon = float(el.attrib["lon"])
            except (KeyError, ValueError):
                continue
            ele = None
            for child in el:
                if child.tag.split("}")[-1] == "ele" and child.text:
                    try:
                        ele = float(child.text)
                    except ValueError:
                        pass
            pts.append((lat, lon, ele))
        if len(pts) >= 2:
            break
    if len(pts) < 2:
        raise ValueError(f"{path.name}: needs at least two track points")
    return pts


def haversine(a, b) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(h))


def local_xy(pts, lat0):
    """Equirectangular metres — plenty accurate for simplifying one route."""
    k = math.cos(math.radians(lat0))
    return [(math.radians(p[1]) * R_EARTH * k, math.radians(p[0]) * R_EARTH) for p in pts]


def douglas_peucker(xy, tol):
    n = len(xy)
    if n < 3:
        return list(range(n))
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = xy[s]
        bx, by = xy[e]
        dx, dy = bx - ax, by - ay
        seg = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(s + 1, e):
            px, py = xy[i]
            if seg == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / seg))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [i for i, k in enumerate(keep) if k]


def smooth(vals, window=7):
    out = []
    half = window // 2
    for i in range(len(vals)):
        seg = vals[max(0, i - half): i + half + 1]
        out.append(sum(seg) / len(seg))
    return out


def route_stats(pts):
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + haversine(a, b))
    eles = [p[2] for p in pts]
    have_ele = sum(e is not None for e in eles) > len(eles) * 0.5
    ascent = descent = 0.0
    profile = []
    if have_ele:
        # fill gaps, smooth GPS jitter, then count climbs over a 3 m threshold
        last = next(e for e in eles if e is not None)
        filled = []
        for e in eles:
            last = e if e is not None else last
            filled.append(last)
        sm = smooth(filled)
        ref = sm[0]
        for e in sm[1:]:
            if e - ref >= 3:
                ascent += e - ref
                ref = e
            elif ref - e >= 3:
                descent += ref - e
                ref = e
        total = cum[-1] or 1
        j = 0
        for k in range(PROFILE_SAMPLES):
            d = total * k / (PROFILE_SAMPLES - 1)
            while j < len(cum) - 2 and cum[j + 1] < d:
                j += 1
            span = cum[j + 1] - cum[j] or 1
            t = min(1, max(0, (d - cum[j]) / span))
            profile.append([round(d / 1000, 3), round(sm[j] + (sm[j + 1] - sm[j]) * t, 1)])
        ele_min, ele_max = min(sm), max(sm)
    else:
        ele_min = ele_max = None
    return {
        "distance_km": round(cum[-1] / 1000, 1),
        "ascent_m": round(ascent) if have_ele else None,
        "descent_m": round(descent) if have_ele else None,
        "ele_min": round(ele_min) if ele_min is not None else None,
        "ele_max": round(ele_max) if ele_max is not None else None,
        "profile": profile,
    }


def padded_bbox(pts, pad=0.16, min_aspect=0.72, max_aspect=1.45):
    """Lon/lat box around the route, padded and nudged to a pleasing shape."""
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    lat0 = (min(lats) + max(lats)) / 2
    k = math.cos(math.radians(lat0))
    w = (max(lons) - min(lons)) * k
    h = max(lats) - min(lats)
    w, h = max(w, 0.004), max(h, 0.004)
    w *= 1 + pad * 2
    h *= 1 + pad * 2
    aspect = w / h
    if aspect < min_aspect:
        w = h * min_aspect
    elif aspect > max_aspect:
        h = w / max_aspect
    cx = (min(lons) + max(lons)) / 2
    cy = lat0
    return [round(cx - w / k / 2, 6), round(cy - h / 2, 6), round(cx + w / k / 2, 6), round(cy + h / 2, 6)]


# ------------------------------------------------------------ LiDAR terrain
def hillshade(z, cell):
    import numpy as np

    z = np.where(np.isfinite(z), z, np.nanmin(z) if np.isfinite(z).any() else 0)
    gy, gx = np.gradient(z, cell)
    slope = np.arctan(np.hypot(gx, gy) * 1.6)
    aspect = np.arctan2(-gx, gy)
    shade = np.zeros_like(z, dtype="float64")
    # multi-directional light reads more like a LiDAR render than a single sun
    for az, w in ((315, 0.5), (270, 0.2), (0, 0.2), (225, 0.1)):
        a = math.radians(360 - az + 90)
        alt = math.radians(42)
        shade += w * (np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(a - aspect))
    shade = np.clip(shade, 0, 1)
    return shade, slope


def ink(z, cell):
    """Black slab: near-black base, ridges and gullies lifted in cool greys, fine contours."""
    import numpy as np

    shade, slope = hillshade(z, cell)
    v = 6 + 120 * shade ** 2.2
    v += 18 * (np.sin(slope) ** 2)  # steep faces catch a little more light
    # contours every 20 m (every 5 m on gentle terrain), very faint
    rng = float(np.nanmax(z) - np.nanmin(z)) if np.isfinite(z).any() else 0
    step = 20 if rng > 300 else 5
    frac = np.abs(((z / step) % 1.0) - 0.5)
    v += np.where(frac > 0.47, 14, 0)
    v = np.clip(v, 0, 255).astype("uint8")
    return v


def render_terrain(slug, bbox, pts):
    """Return {src, xy} or None. Writes src/assets/terrain/<slug>.png."""
    try:
        import numpy as np
        from PIL import Image
        from linz_stac_utils import load_elevation
        from pyproj import Transformer
    except Exception as exc:  # noqa: BLE001
        print(f"  terrain: skipped ({exc.__class__.__name__}: {exc})")
        return None

    tf = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    x0, y0 = tf.transform(bbox[0], bbox[1])
    x1, y1 = tf.transform(bbox[2], bbox[3])
    span = max(abs(x1 - x0), abs(y1 - y0))
    resolution = max(1, round(span / SLAB_PX))
    try:
        da = load_elevation(bbox=tuple(bbox), resolution=resolution)
    except Exception as exc:  # noqa: BLE001
        print(f"  terrain: LINZ load failed ({exc})")
        return None
    if hasattr(da, "data_vars"):  # Dataset -> first band
        da = da[list(da.data_vars)[0]]
    da = da.squeeze()
    z = np.asarray(da.values, dtype="float64")
    if z.ndim != 2 or not np.isfinite(z).any():
        print("  terrain: no elevation returned")
        return None
    xs = np.asarray(da["x"].values)
    ys = np.asarray(da["y"].values)
    img = ink(z, resolution)
    TERRAIN_DIR.mkdir(parents=True, exist_ok=True)
    out = TERRAIN_DIR / f"{slug}.png"
    Image.fromarray(img, mode="L").save(out, optimize=True)

    # route in the same NZTM grid, normalised 0..1 across the image
    xmin, xmax = float(xs.min()), float(xs.max())
    ymin, ymax = float(ys.min()), float(ys.max())
    xy = []
    for lat, lon, _ in pts:
        px, py = tf.transform(lon, lat)
        xy.append([round((px - xmin) / (xmax - xmin), 5), round((ymax - py) / (ymax - ymin), 5)])
    print(f"  terrain: {out.relative_to(ROOT)} ({img.shape[1]}x{img.shape[0]} @ {resolution} m)")
    return {"src": f"/assets/terrain/{slug}.png", "xy": xy, "w": int(img.shape[1]), "h": int(img.shape[0])}


# --------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--terrain", action="store_true", help="render LiDAR slabs from LINZ")
    args = ap.parse_args()

    previous = {}
    if OUT_JSON.exists():
        try:
            previous = json.loads(OUT_JSON.read_text())
        except json.JSONDecodeError:
            previous = {}

    routes = {}
    files = sorted(GPX_DIR.glob("*.gpx"))
    if not files:
        print("No GPX files in /routes")
    for path in files:
        slug = path.stem.lower().replace(" ", "-")
        digest = hashlib.sha1(path.read_bytes()).hexdigest()[:12]
        print(f"- {slug}")
        try:
            pts = parse_gpx(path)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {exc}")
            continue
        lat0 = sum(p[0] for p in pts) / len(pts)
        idx = douglas_peucker(local_xy(pts, lat0), MAP_POINTS_TOLERANCE_M)
        line = [pts[i] for i in idx]
        bbox = padded_bbox(pts)
        rec = {
            "slug": slug,
            "hash": digest,
            "bbox": bbox,
            "start": [round(pts[0][0], 5), round(pts[0][1], 5)],
            "line": [[round(p[1], 5), round(p[0], 5)] for p in line],  # [lon, lat]
            **route_stats(pts),
        }
        old = previous.get(slug, {})
        old_png = TERRAIN_DIR / f"{slug}.png"
        if old.get("hash") == digest and old.get("terrain") and old_png.exists():
            rec["terrain"] = old["terrain"]  # unchanged, reuse
            print("  terrain: cached")
        elif args.terrain:
            t = render_terrain(slug, bbox, line)
            if t:
                rec["terrain"] = t
        routes[slug] = rec
        print(f"  {rec['distance_km']} km, +{rec['ascent_m']} m, {len(line)} pts")

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(routes, separators=(",", ":")))
    print(f"Wrote {OUT_JSON.relative_to(ROOT)} ({len(routes)} routes)")


if __name__ == "__main__":
    sys.exit(main())
