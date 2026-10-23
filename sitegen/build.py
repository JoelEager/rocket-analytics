"""Render the site templates and produce the offline bundle."""

import re
import shutil

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .config import (BUNDLE_FILE, CHARTJS_FILE, SITE_DIR, STATIC_DIR,
                     TEMPLATES_DIR)
from .details import collect_entities, launch_detail
from .stats import compute_stats


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
        shutil.copytree(STATIC_DIR, SITE_DIR / "static", dirs_exist_ok=True)

    # Tell GitHub Pages not to run the site through Jekyll.
    (SITE_DIR / ".nojekyll").touch()

    entities = collect_entities(upcoming + previous)
    # Suborbital launches have no orbital attempt counts; use the latest
    # orbital launch for the orbital stat cards.
    latest = next((l for l in previous
                   if l.get("orbital_launch_attempt_count") is not None), {})

    template = env.get_template("index.html")
    context = dict(
        upcoming=upcoming,
        previous=previous,
        orbital_total=latest.get("orbital_launch_attempt_count"),
        orbital_year=latest.get("orbital_launch_attempt_count_year"),
        orbital_year_label=(latest.get("net") or "")[:4],
        upcoming_detail=[launch_detail(launch) for launch in upcoming],
        previous_detail=[launch_detail(launch) for launch in previous],
        entities=entities,
        rocket_rows=sorted(
            entities["rockets"].items(),
            key=lambda kv: (-(kv[1].get("launches") or 0),
                            -(kv[1].get("launch_mass") or 0),
                            kv[1].get("name") or ""),
        ),
        stats=compute_stats(entities["rockets"], previous),
        data_updated=data_updated,
    )
    (SITE_DIR / "index.html").write_text(template.render(context),
                                         encoding="utf-8")
    print(f"Site built in {SITE_DIR}/")

    build_bundle(template, context)


def inline_safe(code):
    """Escape closing tags so inlined code can't terminate its own element."""
    return re.sub(r"</(script|style)", r"<\\/\1", code, flags=re.IGNORECASE)


EXTERNAL_FIELDS = {"image", "infographic", "mission_patches", "profile_image",
                   "info_url", "wiki_url", "map_url", "links", "mission_links"}


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
        chartjs = CHARTJS_FILE.read_text(encoding="utf-8")
        css = (STATIC_DIR / "style.css").read_text(encoding="utf-8")
    except OSError:
        print(f"Warning: Skipping {BUNDLE_FILE}.")
        return
    offline = {k: scrub_external(v) if k.endswith("detail") or k == "entities"
               else v for k, v in context.items()}
    bundle = template.render(offline, offline=True,
                             inline_css=inline_safe(css),
                             inline_js=inline_safe(chartjs))
    BUNDLE_FILE.write_text(bundle, encoding="utf-8")
    print(f"Portable single-file build written to {BUNDLE_FILE}")
