/* Stories list: a small slab follows the cursor over each row. */
(function () {
  "use strict";
  const ROUTES = window.ROUTES || {};
  const peek = document.getElementById("peek");
  if (!peek || matchMedia("(hover: none)").matches) return;
  let current = null, x = 0, y = 0, tx = 0, ty = 0;
  document.querySelectorAll(".row[data-route]").forEach((row) => {
    const slug = row.dataset.route;
    if (!ROUTES[slug]) return;
    row.addEventListener("mouseenter", () => {
      if (current !== slug) {
        current = slug;
        Terrain.build({ ...ROUTES[slug], slug, url: null }, { host: peek.firstElementChild || peek.appendChild(document.createElement("div")), label: false });
      }
      peek.classList.add("is-on");
    });
    row.addEventListener("mouseleave", () => peek.classList.remove("is-on"));
  });
  addEventListener("mousemove", (e) => { tx = e.clientX + 36; ty = e.clientY - 120; }, { passive: true });
  (function loop() {
    x += (tx - x) * 0.14; y += (ty - y) * 0.14;
    const maxX = innerWidth - peek.offsetWidth - 12;
    peek.style.transform = `translate3d(${Math.min(x, maxX)}px, ${Math.max(60, y)}px, 0)`;
    requestAnimationFrame(loop);
  })();
})();
