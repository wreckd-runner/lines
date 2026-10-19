/*
 * Front page: excerpts run as one paragraph; black terrain slabs float in
 * front of them, each with its route lifted above the relief. Hover an
 * excerpt and its slab comes forward with a leader line to it; hover a
 * slab and its excerpt lights up. Lines, slabs, titles and keywords all
 * open the story.
 */
(function () {
  "use strict";
  const ROUTES = window.ROUTES || {};
  const field = document.getElementById("main");
  const stage = document.getElementById("stage");
  const leader = document.getElementById("leader");
  const leaderPath = leader.querySelector("path");
  const barCoords = document.getElementById("bar-coords");
  const homeCoords = barCoords ? barCoords.innerHTML : "";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const entries = new Map(); // slug -> entry element
  document.querySelectorAll(".entry[data-route]").forEach((e) => {
    if (ROUTES[e.dataset.route]) entries.set(e.dataset.route, e);
  });
  const order = [...entries.keys()];
  if (!order.length) return;

  // Composition: x, y and width as fractions of the viewport; z-rotation; scroll depth.
  const DESKTOP = [
    { x: 0.6, y: 0.13, w: 0.29, rz: -9, depth: 0.22 },
    { x: 0.05, y: 0.5, w: 0.23, rz: 8, depth: 0.12 },
    { x: 0.67, y: 0.6, w: 0.21, rz: 13, depth: 0.3 },
    { x: 0.35, y: 0.24, w: 0.16, rz: -15, depth: 0.08 },
    { x: 0.36, y: 0.7, w: 0.18, rz: 4, depth: 0.18 },
    { x: 0.86, y: 0.36, w: 0.12, rz: -4, depth: 0.05 },
  ];
  const MOBILE = [
    { x: 0.46, y: 0.14, w: 0.5, rz: -8, depth: 0.2 },
    { x: 0.03, y: 0.52, w: 0.44, rz: 9, depth: 0.12 },
    { x: 0.52, y: 0.72, w: 0.42, rz: 5, depth: 0.28 },
  ];

  let slots = [];
  let vw = innerWidth, vh = innerHeight;
  let mouse = { x: 0, y: 0 }, mouseT = { x: 0, y: 0 };
  let focus = null, unfocusTimer = 0, stamp = 0;

  function layoutSlots() {
    vw = innerWidth; vh = innerHeight;
    const comp = vw < 860 ? MOBILE : DESKTOP;
    const n = Math.min(window.FRONT_SLABS || 5, comp.length, order.length);
    // keep what's already on stage, add or remove to match n
    while (slots.length > n) slots.pop().view.el.remove();
    for (let i = 0; i < n; i++) {
      const c = comp[i];
      if (!slots[i]) slots[i] = { slug: null, view: null, used: 0, phase: Math.random() * 6.28 };
      Object.assign(slots[i], c, { px: c.x * vw, py: c.y * vh, pw: Math.max(150, Math.min(560, c.w * vw)) });
      if (!slots[i].slug) mount(slots[i], order.find((s) => !slots.some((o) => o.slug === s)) || order[i % order.length]);
      else style(slots[i]);
    }
  }

  function style(slot) {
    const el = slot.view.el;
    // tall routes get narrower so no slab is taller than ~half the screen
    slot.pw = Math.min(slot.pw, (vh * (vw < 860 ? 0.34 : 0.48) * slot.view.W) / slot.view.H);
    el.style.width = slot.pw + "px";
    el.style.setProperty("--rz", slot.rz + "deg");
  }

  function mount(slot, slug) {
    const route = ROUTES[slug];
    const view = Terrain.build({ ...route, slug });
    view.el.addEventListener("mouseenter", () => setFocus(slug));
    view.el.addEventListener("mouseleave", () => clearFocus());
    view.el.addEventListener("focus", () => setFocus(slug));
    view.el.addEventListener("blur", () => clearFocus());
    view.el.setAttribute("aria-label", route.title);
    stage.appendChild(view.el);
    slot.slug = slug; slot.view = view;
    style(slot);
  }

  function swapIn(slug) {
    if (slots.some((s) => s.slug === slug)) return;
    const slot = slots.slice().sort((a, b) => a.used - b.used)[0];
    if (!slot) return;
    const old = slot.view.el;
    old.classList.add("is-entering");
    setTimeout(() => old.remove(), 700);
    mount(slot, slug);
    slot.view.el.classList.add("is-entering");
    requestAnimationFrame(() => requestAnimationFrame(() => slot.view.el.classList.remove("is-entering")));
  }

  /* ------------------------------------------------------------- focus */
  function setFocus(slug) {
    clearTimeout(unfocusTimer);
    if (focus === slug) return;
    focus = slug;
    swapIn(slug);
    const slot = slots.find((s) => s.slug === slug);
    if (slot) slot.used = ++stamp;
    field.classList.add("is-focus");
    entries.forEach((e, s) => e.classList.toggle("is-on", s === slug));
    slots.forEach((s) => {
      s.view.el.classList.toggle("is-on", s.slug === slug);
      s.view.el.classList.toggle("is-dim", s.slug !== slug);
    });
    leader.classList.add("is-on");
    const r = ROUTES[slug];
    if (barCoords && r) barCoords.textContent = Terrain.coords(r.start[0], r.start[1]);
  }

  function clearFocus() {
    clearTimeout(unfocusTimer);
    unfocusTimer = setTimeout(() => {
      focus = null;
      field.classList.remove("is-focus");
      entries.forEach((e) => e.classList.remove("is-on"));
      slots.forEach((s) => s.view.el.classList.remove("is-on", "is-dim"));
      leader.classList.remove("is-on");
      if (barCoords) barCoords.innerHTML = homeCoords;
    }, 160);
  }

  entries.forEach((e, slug) => {
    e.addEventListener("mouseenter", () => setFocus(slug));
    e.addEventListener("mouseleave", clearFocus);
    e.addEventListener("focusin", () => setFocus(slug));
    e.addEventListener("focusout", clearFocus);
  });

  addEventListener("mousemove", (ev) => {
    mouseT.x = ev.clientX / vw - 0.5;
    mouseT.y = ev.clientY / vh - 0.5;
  }, { passive: true });

  /* -------------------------------------------------------------- frame */
  function frame(t) {
    const s = scrollY;
    mouse.x += (mouseT.x - mouse.x) * 0.06;
    mouse.y += (mouseT.y - mouse.y) * 0.06;
    const time = t / 1000;
    for (const slot of slots) {
      const el = slot.view.el;
      const h = el.offsetHeight || slot.pw * 0.75;
      let x = slot.px, y = slot.py;
      if (!reduce) {
        x += Math.sin(time * 0.21 + slot.phase) * 18 - mouse.x * 40 * (0.4 + slot.depth * 3);
        y += Math.cos(time * 0.17 + slot.phase * 1.3) * 14 - mouse.y * 26 * (0.4 + slot.depth * 3);
        // drift up as the text scrolls, wrapping round so the stage never empties
        const span = vh + h + 120;
        y = ((((y - s * slot.depth + h + 60) % span) + span) % span) - h - 60;
      }
      x = Math.min(x, vw - slot.pw * 0.92);
      if (slot.slug === focus) {
        // keep the focused slab fully in view
        x = Math.min(Math.max(x, 16), vw - slot.pw - 16);
        y = Math.min(Math.max(y, 70), vh - h - 40);
      }
      slot.x = x; slot.y = y;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
    drawLeader();
    requestAnimationFrame(frame);
  }

  function drawLeader() {
    if (!focus) return;
    const entry = entries.get(focus);
    const slot = slots.find((s) => s.slug === focus);
    if (!entry || !slot) return;
    const a = entry.querySelector(".entry__title").getClientRects()[0];
    const b = slot.view.start.getBoundingClientRect();
    if (!a || !b.width) return;
    const x1 = a.left - 6, y1 = a.top + a.height * 0.55;
    const x2 = b.left + b.width / 2, y2 = b.top + b.height / 2;
    const mxp = (x1 + x2) / 2;
    leaderPath.setAttribute("d", `M${x1},${y1} C${mxp},${y1} ${mxp},${y2} ${x2},${y2}`);
  }

  layoutSlots();
  addEventListener("resize", () => { clearTimeout(layoutSlots.t); layoutSlots.t = setTimeout(layoutSlots, 150); });
  requestAnimationFrame(frame);
})();
