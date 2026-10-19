/* Story page: hero slab you can tilt, and an elevation profile that walks the line. */
(function () {
  "use strict";
  const R = window.ROUTE;
  const host = document.getElementById("hero-slab");
  if (!R || !host) return;
  const view = Terrain.build({ ...R, url: null }, { host, label: false });
  const fit = () => { host.style.maxWidth = Math.round((innerHeight * 0.68 * view.W) / view.H) + "px"; };
  fit(); addEventListener("resize", fit);

  // drag (or move) to tilt
  let rx = 24, rz = -4, drag = null;
  const apply = () => { host.style.setProperty("--rx", rx + "deg"); host.style.setProperty("--rz", rz + "deg"); };
  host.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, rx, rz }; host.setPointerCapture(e.pointerId); host.style.cursor = "grabbing"; });
  host.addEventListener("pointermove", (e) => {
    if (!drag) return;
    rx = Math.max(0, Math.min(62, drag.rx - (e.clientY - drag.y) * 0.25));
    rz = Math.max(-45, Math.min(45, drag.rz + (e.clientX - drag.x) * 0.2));
    host.querySelector(".slab__body").style.transition = "none";
    apply();
  });
  const end = () => { drag = null; host.style.cursor = ""; host.querySelector(".slab__body").style.transition = ""; };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  host.addEventListener("dblclick", () => { rx = 24; rz = -4; apply(); });
  host.style.touchAction = "pan-y";

  // elevation profile
  const fig = document.getElementById("profile");
  if (!fig || !R.profile || !R.profile.length) return;
  const svg = fig.querySelector("svg");
  const P = R.profile, W = 1000, H = 100;
  const dmax = P[P.length - 1][0] || 1;
  let lo = Infinity, hi = -Infinity;
  for (const [, e] of P) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
  const pad = (hi - lo) * 0.08 || 10;
  lo -= pad; hi += pad;
  const X = (d) => (d / dmax) * W, Y = (e) => H - ((e - lo) / (hi - lo)) * H;
  const pts = P.map(([d, e]) => `${X(d).toFixed(1)},${Y(e).toFixed(1)}`).join(" L");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<path class="area" d="M0,${H} L${pts} L${W},${H} Z"/><path class="ln" d="M${pts}"/><line class="cur" x1="0" x2="0" y1="0" y2="${H}"/>`;
  const cur = svg.querySelector(".cur");
  const out = document.getElementById("profile-readout");
  const base = out.textContent;

  function at(clientX) {
    const r = svg.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const d = t * dmax;
    let i = P.findIndex((p) => p[0] >= d); if (i < 1) i = 1;
    const [d0, e0] = P[i - 1], [d1, e1] = P[i];
    const e = e0 + (e1 - e0) * ((d - d0) / (d1 - d0 || 1));
    cur.setAttribute("x1", t * W); cur.setAttribute("x2", t * W);
    out.textContent = `${d.toFixed(1)} km ${Math.round(e).toLocaleString("en-NZ")} m`;
    fig.classList.add("is-on");
    view.cursor(t);
  }
  fig.addEventListener("pointermove", (e) => at(e.clientX));
  fig.addEventListener("pointerdown", (e) => at(e.clientX));
  fig.addEventListener("pointerleave", () => { fig.classList.remove("is-on"); out.textContent = base; view.cursor(null); });
})();
