import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export default function (eleventyConfig) {
  eleventyConfig.setLibrary(
    "md",
    markdownIt({ html: true, typographer: true, linkify: true }).use(markdownItAnchor)
  );

  // Static files
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ routes: "routes" }); // GPX downloads
  eleventyConfig.addWatchTarget("src/assets");

  // Posts, newest first
  eleventyConfig.addCollection("posts", (api) =>
    api.getFilteredByGlob("src/posts/*.md").sort((a, b) => b.date - a.date)
  );

  // ---- filters --------------------------------------------------------
  eleventyConfig.addFilter("dateShort", (d) => {
    const x = new Date(d);
    return `${String(x.getUTCDate()).padStart(2, "0")} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
  });
  eleventyConfig.addFilter("year", (d) => new Date(d).getUTCFullYear());
  eleventyConfig.addFilter("isoDate", (d) => new Date(d).toISOString());

  // [-41.2865, 174.7762] -> 41.2865° S  174.7762° E
  eleventyConfig.addFilter("coords", (pt) => {
    if (!pt) return "";
    const [lat, lon] = pt;
    return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"}&ensp;${Math.abs(lon).toFixed(4)}° ${lon < 0 ? "W" : "E"}`;
  });

  // Wrap the first appearance of each keyword in a link to the post.
  eleventyConfig.addFilter("linkKeywords", (text, keywords = [], href = "#") => {
    let out = esc(text || "");
    const kws = [...(keywords || [])].sort((a, b) => b.length - a.length);
    for (const kw of kws) {
      const re = new RegExp(`(^|[^\\p{L}])(${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}])`, "iu");
      if (re.test(out) && !out.includes(`data-kw="${esc(kw)}"`)) {
        out = out.replace(re, `$1<a class="kw" href="${href}" data-kw="${esc(kw)}">$2</a>`);
      }
    }
    return out;
  });

  // Only the route data a page actually needs gets inlined.
  eleventyConfig.addFilter("pickRoutes", (routes, posts) => {
    const out = {};
    for (const p of posts || []) {
      const slug = p.data.route;
      if (slug && routes[slug]) {
        out[slug] = { ...routes[slug], title: p.data.title, url: p.url, profile: undefined };
      }
    }
    return out;
  });
  // /build.json — which routes got real LiDAR terrain, and why not if they didn't
  eleventyConfig.addFilter("buildStatus", (routes) => ({
    built: new Date().toISOString(),
    routes: Object.values(routes || {}).map((r) => ({
      slug: r.slug,
      lidar: !!(r.terrain && r.terrain.src),
      size: r.terrain ? `${r.terrain.w}x${r.terrain.h}` : null,
      error: r.terrain_error || null,
    })),
  }));
  eleventyConfig.addFilter("routeFor", (routes, slug) => (slug && routes[slug]) || null);
  eleventyConfig.addFilter("json", (v) => JSON.stringify(v ?? null).replace(/</g, "\\u003c"));
  eleventyConfig.addFilter("num", (n) => (n == null ? "—" : Number(n).toLocaleString("en-NZ")));

  // First paragraph as a fallback excerpt
  eleventyConfig.addFilter("autoExcerpt", (post) => {
    if (post.data.excerpt) return post.data.excerpt;
    const raw = (post.rawInput || "").split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("!") && !p.trim().startsWith("#")) || "";
    const plain = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`>#]/g, "").trim();
    return plain.length > 240 ? plain.slice(0, 237).replace(/\s+\S*$/, "") + "…" : plain;
  });

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    // GitHub Pages project sites live at /<repo>/ — the deploy workflow sets this.
    pathPrefix: process.env.PATH_PREFIX || "/",
  };
}
