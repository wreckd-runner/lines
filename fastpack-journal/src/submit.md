---
layout: layouts/base.njk
title: Submit a story
permalink: /submit/
bodyClass: page-submit
---
<main id="main" class="page prose">

# Send us your trip

Been somewhere on foot, fast and light? Write it up in Markdown, attach the GPX, and it’ll land here with its own slab of LiDAR terrain and a line you can click.

<p class="cta">
  <a class="button" href="https://github.com/{{ site.repo }}/issues/new?template=story.yml">Submit a story&ensp;→</a>
  <span>Opens a short form on GitHub (free account needed).</span>
</p>

## How it works

1. **Fill in the form.** Title, your name, where and when, a one-line excerpt, and the story itself in Markdown. Drag photos straight into the story box.
2. **Attach your GPX.** GitHub won’t take a bare `.gpx`, so zip it first — or rename it to `.txt`. Either works.
3. **We read it.** When an editor marks it approved, the site turns it into a post and opens a pull request. Once that’s merged it’s live, usually within a couple of minutes.

## Writing in Markdown

You don’t need much. Paragraphs are separated by a blank line, and:

```md
## A heading for a new day

**Bold** and *italic* text, [a link](https://example.com).

![Alt text for a photo](drag-your-photo-in-here)

> A line someone said on the ridge.
```

## Already use GitHub?

Fork the repo, add your story to `src/posts/YYYY-MM-DD-your-title.md` and your track to `routes/your-title.gpx`, then open a pull request. Copy this to the top of your file:

```yaml
---
title: Your trip title
date: 2026-10-18
author: Your Name
author_url: https://your-site-or-strava
region: Tararua Range
route: your-title          # matches routes/your-title.gpx
days: 2
keywords: [ridgeline, Alpha Hut, wind]
excerpt: One or two sentences for the front page.
---
```

**Keywords** are words from your excerpt that become links on the front page — pick two or three that actually appear in it.

## The small print

By submitting you confirm the words and photos are yours (or you have permission), and you’re happy for them to be published here with credit to you. We may lightly edit for length and clarity. Please don’t include anyone’s private details, and take care sharing routes across private land.

</main>
