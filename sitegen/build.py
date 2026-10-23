"""Render the site templates and produce the offline bundle."""

import re
import shutil

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .config import (APPJS_FILE, BUNDLE_FILE, CHARTJS_FILE, CSS_FILE,
                     SITE_DIR, STATIC_DIR, TEMPLATES_DIR)
from .details import collect_entities, launch_detail
from .stats import compute_stats

# Script files in load order: app.js depends on Chart being defined first.
JS_FILES = [CHARTJS_FILE, APPJS_FILE]

# Asset URLs as index.html will see them — relative to site/, matching
# where the static directory is copied below.
CSS_HREF = f"{STATIC_DIR.name}/{CSS_FILE.name}"
JS_SRCS = [f"{STATIC_DIR.name}/{f.name}" for f in JS_FILES]
BUNDLE_HREF = BUNDLE_FILE.name


def build_context(upcoming, previous, entities, data_updated):
    """Assemble the Jinja template context from launches and entities."""
    # Suborbital launches have no orbital attempt counts; use the latest
    # orbital launch for the orbital stat cards.
    latest = next((launch for launch in previous
                   if launch.get("orbital_launch_attempt_count") is not None),
                  {})
    return dict(
        upcoming=upcoming,
        previous=previous,
        orbital_total=latest.get("orbital_launch_attempt_count"),
        orbital_year=latest.get("orbital_launch_attempt_count_year"),
        orbital_year_label=(latest.get("net") or "")[:4],
        upcoming_detail=[launch_detail(launch) for launch in upcoming],
        previous_detail=[launch_detail(launch) for launch in previous],
        entities=entities,
        # Rocket table rows ordered by launch count, then mass, then name.
        rocket_rows=sorted(
            entities["rockets"].items(),
            key=lambda kv: (-(kv[1].get("launches") or 0),
                            -(kv[1].get("launch_mass") or 0),
                            kv[1].get("name") or ""),
        ),
        stats=compute_stats(entities["rockets"], previous),
        data_updated=data_updated,
    )


def build_site(upcoming, previous, data_updated):
    """Render templates and copy static assets into the site directory."""
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(("html",)),
    )
    # Preserve dict order (sorted by count) instead of tojson's sorted keys.
    env.policies["json.dumps_kwargs"]["sort_keys"] = False

    try:
        shutil.rmtree(SITE_DIR)
    except OSError:
        # Directory may be in use (e.g. a local dev server)
        print("Warning: Unable to remove site directory; overwriting in place.")
    SITE_DIR.mkdir(parents=True, exist_ok=True)

    if STATIC_DIR.exists():
        shutil.copytree(STATIC_DIR, SITE_DIR / STATIC_DIR.name,
                        dirs_exist_ok=True)

    # Tell GitHub Pages not to run the site through Jekyll.
    (SITE_DIR / ".nojekyll").touch()

    entities = collect_entities(upcoming + previous)
    template = env.get_template("index.html")
    context = build_context(upcoming, previous, entities, data_updated)
    (SITE_DIR / "index.html").write_text(
        template.render(context, css_href=CSS_HREF, js_srcs=JS_SRCS,
                        bundle_href=BUNDLE_HREF),
        encoding="utf-8")
    print(f"Site built in {SITE_DIR}/")

    build_bundle(template, context)


def inline_safe(code):
    """Escape closing tags so inlined code can't terminate its own element."""
    return re.sub(r"</(script|style)", r"<\\/\1", code, flags=re.IGNORECASE)


# Remote URL fields stripped from the offline bundle's embedded data —
# nothing the bundle references should need a network connection.
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


def build_bundle(template, context):
    """Render the site again with CSS and JS inlined into one HTML file."""
    try:
        js = "\n".join(f.read_text(encoding="utf-8") for f in JS_FILES)
        css = CSS_FILE.read_text(encoding="utf-8")
    except OSError:
        print(f"Warning: Skipping {BUNDLE_FILE}.")
        return
    offline = {k: scrub_external(v) if k in SCRUB_KEYS else v
               for k, v in context.items()}
    bundle = template.render(offline, offline=True,
                             inline_css=inline_safe(css),
                             inline_js=inline_safe(js))
    BUNDLE_FILE.write_text(bundle, encoding="utf-8")
    print(f"Portable single-file build written to {BUNDLE_FILE}")
