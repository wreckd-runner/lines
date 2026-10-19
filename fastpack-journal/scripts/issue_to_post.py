#!/usr/bin/env python3
"""
Turn a "Submit a story" issue into:
  src/posts/YYYY-MM-DD-<slug>.md   (photos downloaded into src/assets/img/<slug>/)
  routes/<slug>.gpx

Reads ISSUE_BODY, ISSUE_NUMBER, ISSUE_USER from the environment (set by the
workflow) and writes `title=` to $GITHUB_OUTPUT. Run locally with:
  ISSUE_BODY="$(cat body.md)" ISSUE_NUMBER=1 python scripts/issue_to_post.py
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

try:
    from defusedxml import ElementTree as ET
except ImportError:  # pragma: no cover
    import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 25 * 1024 * 1024
ALLOWED_HOSTS = ("github.com", "user-images.githubusercontent.com", "objects.githubusercontent.com")

LABELS = {
    "Story title": "title",
    "Your name": "author",
    "Link for your name (optional)": "author_url",
    "Date of the trip": "date",
    "Region": "region",
    "Days (optional)": "days",
    "Excerpt": "excerpt",
    "Keywords": "keywords",
    "Story (Markdown)": "story",
    "GPX track": "gpx",
}


def parse_form(body: str) -> dict:
    """Issue forms render as '### Label\\n\\nvalue' blocks."""
    out = {}
    parts = re.split(r"^### +(.+?)\s*$", body.replace("\r\n", "\n"), flags=re.M)
    for label, value in zip(parts[1::2], parts[2::2]):
        key = LABELS.get(label.strip())
        if key:
            v = value.strip()
            out[key] = "" if v == "_No response_" else v
    return out


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:60] or "story"


def fetch(url: str) -> tuple[bytes, str]:
    host = urllib.parse.urlparse(url).hostname or ""
    if not url.startswith("https://"):
        raise ValueError(f"refusing non-https URL: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "story-bot"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 (https only)
        data = r.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError(f"{url} is larger than {MAX_BYTES // 1_048_576} MB")
        return data, r.headers.get("Content-Type", "")


def extract_gpx(field: str) -> bytes:
    urls = re.findall(r"https://[^\s)\]>\"']+", field)
    if not urls:
        raise ValueError("No GPX attachment or link found in the GPX box")
    for url in urls:
        data, _ = fetch(url)
        if data[:2] == b"PK":  # zip
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = [n for n in z.namelist() if n.lower().endswith((".gpx", ".txt")) and not n.startswith("__MACOSX")]
                if not names:
                    continue
                if z.getinfo(names[0]).file_size > MAX_BYTES:
                    raise ValueError("GPX inside zip is too large")
                data = z.read(names[0])
        try:
            root = ET.fromstring(data)
        except Exception:  # noqa: BLE001
            continue
        if root.tag.lower().endswith("gpx"):
            return data
    raise ValueError("None of the links in the GPX box were a valid GPX file")


IMG_RE = re.compile(r'(!\[[^\]]*\]\()(https://[^)\s]+)(\))|(<img[^>]+src=")(https://[^"]+)(")')


def localise_images(story: str, slug: str) -> str:
    """Download GitHub-hosted images into the repo so posts don't depend on issue attachments."""
    folder = ROOT / "src" / "assets" / "img" / slug
    n = 0

    def swap(m):
        nonlocal n
        pre, url, post = (m.group(1), m.group(2), m.group(3)) if m.group(2) else (m.group(4), m.group(5), m.group(6))
        host = urllib.parse.urlparse(url).hostname or ""
        if not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
            return m.group(0)
        try:
            data, ctype = fetch(url)
        except Exception as exc:  # noqa: BLE001
            print(f"  image skipped ({exc})")
            return m.group(0)
        ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(ctype.split(";")[0])
        if not ext:
            return m.group(0)
        n += 1
        folder.mkdir(parents=True, exist_ok=True)
        name = f"{n:02d}{ext}"
        (folder / name).write_bytes(data)
        # relative path works whatever the site's base URL is (post lives at /stories/<slug>/)
        return f"{pre}../../assets/img/{slug}/{name}{post}"

    story = IMG_RE.sub(swap, story)
    # alt-less <img> tags from drag-and-drop become Markdown for consistency
    story = re.sub(r'<img[^>]*src="([^"]+)"[^>]*>', r"![](\1)", story)
    return story


def yaml_str(v: str) -> str:
    return json.dumps(v, ensure_ascii=False)  # JSON strings are valid YAML


def main():
    body = os.environ.get("ISSUE_BODY", "")
    number = os.environ.get("ISSUE_NUMBER", "0")
    user = os.environ.get("ISSUE_USER", "")
    f = parse_form(body)
    for req in ("title", "author", "excerpt", "story", "gpx"):
        if not f.get(req):
            sys.exit(f"Missing required field: {req}")

    trip = f.get("date", "")
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", trip)
    d = date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else date.today()

    slug = slugify(f["title"])
    if (ROOT / "routes" / f"{slug}.gpx").exists():
        slug = f"{slug}-{number}"

    gpx = extract_gpx(f["gpx"])
    (ROOT / "routes").mkdir(exist_ok=True)
    (ROOT / "routes" / f"{slug}.gpx").write_bytes(gpx)

    story = localise_images(f["story"], slug)
    # No raw HTML from submissions (script tags etc.) — escape '<' outside code fences
    lines, fenced = [], False
    for ln in story.split("\n"):
        if ln.lstrip().startswith("```"):
            fenced = not fenced
        lines.append(ln if fenced else ln.replace("<", "&lt;"))
    story = "\n".join(lines)
    # Posts go through Nunjucks; submitted text is shown literally, never executed
    story = "{% raw %}\n" + story.replace("{% endraw %}", "").replace("{%endraw%}", "") + "\n{% endraw %}"

    keywords = [k.strip() for k in f.get("keywords", "").split(",") if k.strip()][:5]
    days = re.sub(r"[^\d.]", "", f.get("days", ""))
    url = f.get("author_url", "")
    if url and not url.startswith(("https://", "http://")):
        url = ""

    fm = [
        "---",
        f"title: {yaml_str(f['title'])}",
        f"date: {d.isoformat()}",
        f"author: {yaml_str(f['author'])}",
    ]
    if url:
        fm.append(f"author_url: {yaml_str(url)}")
    fm += [
        f"region: {yaml_str(f.get('region', ''))}",
        f"route: {slug}",
    ]
    if days:
        fm.append(f"days: {days}")
    fm += [
        f"keywords: {json.dumps(keywords, ensure_ascii=False)}",
        f"excerpt: {yaml_str(' '.join(f['excerpt'].split()))}",
        "submitted: true",
        f"submitted_by: {yaml_str(user)}",
        f"issue: {int(number)}",
        "---",
        "",
    ]
    post = ROOT / "src" / "posts" / f"{d.isoformat()}-{slug}.md"
    post.write_text("\n".join(fm) + story.strip() + "\n", encoding="utf-8")
    print(f"Wrote {post.relative_to(ROOT)} and routes/{slug}.gpx")

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            fh.write(f"title={f['title'].splitlines()[0][:100]}\n")
            fh.write(f"slug={slug}\n")


if __name__ == "__main__":
    main()
