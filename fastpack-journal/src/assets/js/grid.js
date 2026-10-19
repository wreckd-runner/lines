/* Routes page: flat slabs, built as they scroll into view. */
(function () {
  "use strict";
  const ROUTES = window.ROUTES || {};
  const io = new IntersectionObserver((items) => {
    for (const it of items) {
      if (!it.isIntersecting) continue;
      io.unobserve(it.target);
      const slug = it.target.dataset.route;
      if (ROUTES[slug]) Terrain.build({ ...ROUTES[slug], slug, url: null }, { host: it.target, label: false });
    }
  }, { rootMargin: "300px" });
  document.querySelectorAll(".slab--flat[data-route]").forEach((el) => io.observe(el));
})();
