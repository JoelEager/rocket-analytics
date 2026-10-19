"""Build the rocket-analytics static site.

Fetches orbital launch data from the free Launch Library 2 API
(https://ll.thespacedevs.com) and renders a static HTML site into the
site/ directory, ready to be served by GitHub Pages.
"""

from __future__ import annotations

import argparse
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests
from jinja2 import Environment, FileSystemLoader, select_autoescape

API_BASE = "https://ll.thespacedevs.com/2.2.0"
SITE_DIR = Path("site")
TEMPLATES_DIR = Path("templates")
STATIC_DIR = Path("static")


def fetch_launches(endpoint: str, limit: int) -> list[dict]:
    """Fetch launches from LL2. `endpoint` is 'upcoming' or 'previous'.

    Paginates (100 per request, the API maximum) until `limit` is reached.
    """
    ordering = "net" if endpoint == "upcoming" else "-net"
    results: list[dict] = []
    while len(results) < limit:
        response = requests.get(
            f"{API_BASE}/launch/{endpoint}/",
            params={
                "limit": min(100, limit - len(results)),
                "offset": len(results),
                "ordering": ordering,
                "mode": "detailed",
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        results.extend(data["results"])
        if not data.get("next"):
            break
    return results


def compute_stats(launches: list[dict]) -> dict:
    """Compute summary analytics from a list of launch objects."""
    by_year: Counter[str] = Counter()
    by_provider: Counter[str] = Counter()
    by_status: Counter[str] = Counter()
    by_pad: Counter[str] = Counter()

    for launch in launches:
        net = launch.get("net") or ""
        if len(net) >= 4:
            by_year[net[:4]] += 1
        provider = launch.get("launch_service_provider") or {}
        by_provider[provider.get("name") or "Unknown"] += 1
        status = launch.get("status") or {}
        by_status[status.get("name") or "Unknown"] += 1
        pad = launch.get("pad") or {}
        by_pad[pad.get("name") or "Unknown"] += 1

    return {
        "total": len(launches),
        "by_year": dict(sorted(by_year.items())),
        "by_provider": dict(by_provider.most_common(10)),
        "by_status": dict(by_status.most_common()),
        "top_pads": dict(by_pad.most_common(10)),
    }


def build_site(upcoming: list[dict], previous: list[dict], output_dir: Path) -> None:
    """Render templates and copy static assets into `output_dir`."""
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(("html",)),
    )

    try:
        shutil.rmtree(output_dir)
    except OSError:
        # Directory may be in use (e.g. a local dev server); overwrite in place.
        pass
    output_dir.mkdir(parents=True, exist_ok=True)

    if STATIC_DIR.exists():
        shutil.copytree(STATIC_DIR, output_dir / "static", dirs_exist_ok=True)

    # Tells GitHub Pages not to run the site through Jekyll.
    (output_dir / ".nojekyll").touch()

    template = env.get_template("index.html")
    html = template.render(
        upcoming=upcoming,
        previous=previous,
        stats=compute_stats(previous),
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )
    (output_dir / "index.html").write_text(html, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=300,
                        help="launches to fetch per endpoint (default: 300)")
    parser.add_argument("--output", type=Path, default=SITE_DIR,
                        help="output directory (default: site/)")
    args = parser.parse_args()

    print(f"Fetching up to {args.limit} upcoming launches...")
    upcoming = fetch_launches("upcoming", args.limit)
    print(f"Fetching up to {args.limit} previous launches...")
    previous = fetch_launches("previous", args.limit)

    build_site(upcoming, previous, args.output)
    print(f"Site built in {args.output}/")


if __name__ == "__main__":
    main()
