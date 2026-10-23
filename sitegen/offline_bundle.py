"""Produce the portable single-file offline build."""

import base64
import hashlib
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO

import requests
from PIL import Image

from .config import (CSS_FILE, IMAGE_CACHE_DIR, IMAGE_QUALITY, JS_FILES,
                     OFFLINE_FILE, PATCH_IMAGE_PX, ROCKET_IMAGE_PX)


def inline_safe(code):
    """Escape closing tags so inlined code can't terminate its own element."""
    return re.sub(r"</(script|style)", r"<\\/\1", code, flags=re.IGNORECASE)


# Remote URL fields stripped from the offline build's embedded data —
# nothing it references should need a network connection.
EXTERNAL_FIELDS = {"image", "infographic", "mission_patches", "profile_image",
                   "info_url", "wiki_url", "map_url", "links", "mission_links"}

# Context keys holding detail/entity payloads that need scrubbing.
SCRUB_KEYS = {"upcoming_detail", "previous_detail", "entities"}


def scrub_external(value):
    """Recursively remove remote image and link URLs from detail/entity data."""
    if isinstance(value, dict):
        return {k: scrub_external(v) for k, v in value.items()
                if k not in EXTERNAL_FIELDS}
    if isinstance(value, list):
        return [scrub_external(v) for v in value]
    return value


def fetch_data_uri(url, max_px):
    """Download an image, downscale it, and return a data URI — or None."""
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content))
        img.thumbnail((max_px, max_px), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, "WEBP", quality=IMAGE_QUALITY)
    except Exception as e:
        print(f"Warning: Failed to fetch image from {url}: {e}")
        return None
    return ("data:image/webp;base64,"
            + base64.b64encode(buf.getvalue()).decode())


def image_cache_path(url, max_px):
    """Cache file for a processed image. The key covers every input that
    affects the output, so new size/quality settings invalidate old files."""
    key = hashlib.sha1(f"{url}|{max_px}|{IMAGE_QUALITY}".encode()).hexdigest()
    return IMAGE_CACHE_DIR / f"{key}.txt"


def embed_images(urls_px):
    """Return {url: data_uri}. Results are cached on disk, so repeat
    builds only download and compress images that are new."""
    images = {}
    misses = {}
    for url, px in urls_px.items():
        try:
            images[url] = image_cache_path(url, px).read_text(
                encoding="utf-8")
        except OSError:
            misses[url] = px

    if misses:
        print(f"Fetching {len(misses)} images "
              f"({len(images)} already cached)...")
        IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(fetch_data_uri, url, px): url
                       for url, px in misses.items()}
            for fut in as_completed(futures):
                uri = fut.result()
                if not uri:
                    # Failures stay uncached and retry on the next build.
                    continue
                url = futures[fut]
                images[url] = uri
                try:
                    image_cache_path(url, misses[url]).write_text(
                        uri, encoding="utf-8")
                except OSError:
                    pass

    # Drop cache files no longer referenced — launches churn off the feed
    # and size/quality changes mint new keys — so the dir can't grow
    # unbounded. Best-effort: a locked file just survives to next build.
    live = {image_cache_path(url, px) for url, px in urls_px.items()}
    pruned = 0
    for f in IMAGE_CACHE_DIR.glob("*.txt"):
        if f not in live:
            try:
                f.unlink()
                pruned += 1
            except OSError:
                pass
    if pruned:
        print(f"Pruned {pruned} stale image cache files.")
    return images


def offline_context(context):
    """Offline variant of the context: remote URLs stripped, except mission
    patches and rocket images, which are embedded as data URIs."""
    # Collect the images worth inlining before scrub_external removes them.
    wanted = {}
    for d in context["upcoming_detail"] + context["previous_detail"]:
        wanted.update((u, PATCH_IMAGE_PX)
                      for u in d.get("mission_patches") or [])
    for rocket in context["entities"]["rockets"].values():
        if rocket.get("image"):
            wanted[rocket["image"]] = ROCKET_IMAGE_PX

    # Data URIs go in one shared map (the data-images JSON block) so a
    # patch reused across launches is embedded once, not per launch.
    print("Fetching mission patch and rocket images...")
    images = embed_images(wanted)
    print(f"Embedded {len(images)}/{len(wanted)} images "
          f"({sum(len(u) for u in images.values()) // 1024} KB after compression)")

    offline = {k: scrub_external(v) if k in SCRUB_KEYS else v
               for k, v in context.items()}
    # Re-add just the embedded images to the scrubbed structures.
    for group in ("upcoming_detail", "previous_detail"):
        for src, dst in zip(context[group], offline[group]):
            patches = [u for u in src.get("mission_patches") or []
                       if u in images]
            if patches:
                dst["mission_patches"] = patches
    for rid, rocket in context["entities"]["rockets"].items():
        if rocket.get("image") in images:
            offline["entities"]["rockets"][rid]["image"] = rocket["image"]
    offline["images"] = images
    return offline


def build_offline_bundle(template, context):
    """Render the site again as one offline HTML file with CSS, JS, and
    key images inlined."""
    try:
        js = "\n".join(f.read_text(encoding="utf-8") for f in JS_FILES)
        css = CSS_FILE.read_text(encoding="utf-8")
    except OSError:
        print(f"Warning: Skipping {OFFLINE_FILE}.")
        return
    offline = offline_context(context)
    html = template.render(offline, offline=True,
                           inline_css=inline_safe(css),
                           inline_js=inline_safe(js))
    OFFLINE_FILE.write_text(html, encoding="utf-8")
    print(f"Offline single-file build written to {OFFLINE_FILE}")
