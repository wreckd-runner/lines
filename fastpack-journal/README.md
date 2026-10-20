# ESCARP.

A running and fastpacking journal for GitHub Pages. Stories are Markdown, every story carries a GPX track, and the front page floats black LiDAR terrain in front of the excerpts with each route drawn above its relief. Click a line, a slab, a title or a keyword to open the story.

## Set up (once)

1. **Make the repo.** Create a new GitHub repo and push this folder to `main`.
2. **Turn on Pages.** Settings → Pages → *Source: GitHub Actions*.
3. **Allow submissions to open PRs.** Settings → Actions → General → *Workflow permissions*: tick **Allow GitHub Actions to create and approve pull requests**.
4. **Add two labels.** Issues → Labels: `submission` and `approved`.
5. **Edit `src/_data/site.json`.** Set `title`, `tagline`, `url` and `repo` (`your-username/your-repo` — the Submit button uses it).

Push, and the *Build and deploy* action publishes the site. The first build takes a few minutes while it renders terrain; later builds reuse it.

## Writing a post

Add two files:

```
routes/tararua-southern-crossing.gpx
src/posts/2026-10-04-tararua-southern-crossing.md
```

```yaml
---
title: Southern Crossing in a day and a bit
author: Callum Mallett
region: Tararua Range
route: tararua-southern-crossing     # GPX filename without .gpx
days: 2
keywords: [cloud, tussock, Alpha]     # words from the excerpt → front-page links
excerpt: One or two sentences that run on the front page.
---

The story in Markdown…
```

Photos: put them in `src/assets/img/<post-name>/` and link as `![alt](../../assets/img/<post-name>/photo.jpg)`.

The sample posts (marked `sample: true`) and their GPX files are placeholders — delete them once you have real ones.

## Reader submissions

The **Submit** page links to a GitHub issue form. The flow:

1. Someone fills in the form: title, name, excerpt, keywords, the story in Markdown, photos dragged in, and a GPX (zipped or renamed `.txt`, because GitHub won't take a bare `.gpx`).
2. You read it. If it's good, add the **approved** label.
3. The *Submission to pull request* action writes the post, saves the GPX, downloads the photos into the repo and opens a PR. Tweak on the branch if you like, then merge. It's live a couple of minutes later.

Submitted text is shown as written — HTML and template tags are escaped. Only people with write access can add labels, so nothing publishes without you.

## The terrain

`scripts/build_routes.py` runs in the deploy action. For each GPX it:

- computes distance, ascent, high point and an elevation profile,
- simplifies the line for drawing,
- renders a black hillshade slab from **LINZ's national elevation model** — the 1 m LiDAR DEM, with the 8 m DEM filling gaps — via the public `nz-elevation` catalogue (`linz-stac-utils`), and projects the route onto it.

If LINZ can't be reached, the build still succeeds and the browser shades relief from open AWS terrain tiles instead. Slabs are cached and only redrawn when a GPX changes. LINZ data is CC BY 4.0; the footer carries the attribution.

## Run it locally

```bash
npm install
pip install -r requirements.txt
npm run terrain      # or `npm run routes` to skip terrain
npm start            # http://localhost:8080
```

## Where things live

| | |
|---|---|
| `src/index.njk` | front page |
| `src/_includes/layouts/` | base and post layouts |
| `src/assets/css/style.css` | all styling — colours and fonts are tokens at the top |
| `src/assets/js/terrain.js` | builds a slab (relief + floating route) |
| `src/assets/js/front.js` | floating composition, hover links, leader line |
| `src/assets/js/post.js` | tiltable hero map and elevation profile |
| `scripts/` | GPX/terrain build and issue → post converter |
| `.github/` | deploy + submission workflows, issue form |

Route colour is `--line` in `style.css`; how many slabs float on the front page is `front_slabs` in `site.json`.
