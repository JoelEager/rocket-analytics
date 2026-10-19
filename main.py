"""Build the rocket-analytics static site."""

import argparse
import json
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests
from jinja2 import Environment, FileSystemLoader, select_autoescape

PAST_LAUNCH_PAGES = 10
UPCOMING_LAUNCH_PAGES = 2
API_BASE = "https://ll.thespacedevs.com/2.2.0"
MAX_ATTEMPTS = 2
SITE_DIR = Path("site")
TEMPLATES_DIR = Path("templates")
STATIC_DIR = Path("static")
CACHE_FILE = Path("launch_cache.json")


def make_request(endpoint, params):
    """
    Make a request to the LL2 API with retry logic.
    
    Args:
        endpoint: The API endpoint to request
        params: The parameters to pass to the API
        
    Returns:
        The response from the API
    """
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = requests.get(f"{API_BASE}/launch/{endpoint}/", params=params, timeout=30)
            response.raise_for_status()
            return response
        except requests.RequestException as e:
            print(f"Attempt {attempt + 1} failed: {e}")
    
    raise Exception("Failed to fetch data from API")


def fetch_launches(endpoint, pages):
    """
    Fetch launches from the LL2 API.
    
    Args:
        endpoint: The API endpoint to request
        pages: The number of pages to fetch
        
    Returns:
        A list of launches
    """
    ordering = "net" if endpoint == "upcoming" else "-net"
    results = []

    for i in range(pages):
        response = make_request(endpoint, {
            "limit": 100,
            "offset": i * 100,
            "ordering": ordering,
            "mode": "detailed",
            **({"hide_recent_previous": "true"} if endpoint == "upcoming" else {})
        })
        print(f"Got page {i + 1}")
        data = response.json()
        results.extend(data["results"])

        if not data.get("next"):
            print("No more pages to fetch.")
            break

    return results


def load_cache():
    """Return cached (upcoming, previous) lists, or None if unavailable."""
    try:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print("Warning: Could not load cache file.")
        return None

    upcoming, previous = data.get("upcoming", []), data.get("previous", [])

    if not upcoming or not previous:
        print("Warning: Cache file is missing data.")
        return None

    return upcoming, previous, data.get("last_updated")


def save_cache(upcoming, previous):
    """Save the upcoming and previous launches to the cache file."""
    try:
        CACHE_FILE.write_text(
            json.dumps({
                "upcoming": upcoming, 
                "previous": previous, 
                "last_updated": datetime.now(timezone.utc).isoformat()
            }, indent=2),
            encoding="utf-8",
        )
        print("Cache saved successfully.")
    except OSError:
        print("Warning: Could not save cache file.")


def compute_stats(launches):
    """Compute summary analytics from a list of launch objects."""
    by_year = Counter()
    by_provider = Counter()
    by_status = Counter()

    for launch in launches:
        net = launch.get("net") or ""
        if len(net) >= 4:
            by_year[net[:4]] += 1
        provider = launch.get("launch_service_provider") or {}
        by_provider[provider.get("name") or "Unknown"] += 1
        status = launch.get("status") or {}
        by_status[status.get("name") or "Unknown"] += 1

    return {
        "total": len(launches),
        "by_year": dict(sorted(by_year.items())),
        "by_provider": dict(by_provider.most_common(10)),
        "by_status": dict(by_status.most_common()),
    }


def build_site(upcoming, previous):
    """Render templates and copy static assets."""
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(("html",)),
    )

    # Remove the site directory if it exists
    try:
        shutil.rmtree(SITE_DIR)
    except OSError:
        # Directory may be in use (e.g. a local dev server)
        print("Warning: Unable to remove site directory; overwriting in place.")
    SITE_DIR.mkdir(parents=True, exist_ok=True)

    # Copy static assets
    if STATIC_DIR.exists():
        shutil.copytree(STATIC_DIR, SITE_DIR / "static", dirs_exist_ok=True)

    # Tell GitHub Pages not to run the site through Jekyll.
    (SITE_DIR / ".nojekyll").touch()

    # Render the HTML template
    template = env.get_template("index.html")
    html = template.render(
        upcoming=upcoming,
        previous=previous,
        stats=compute_stats(previous),
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )
    (SITE_DIR / "index.html").write_text(html, encoding="utf-8")
    print(f"Site built in {SITE_DIR}/")


def main():
    """Entry point for the script."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true",
                        help="load fresh data from the API")
    args = parser.parse_args()

    cached = None if args.refresh else load_cache()
    if cached:
        upcoming, previous, last_updated = cached
        print(f"Using cached data: {len(upcoming)} upcoming, "
              f"{len(previous)} previous launches from {last_updated}")
    else:
        print(f"Fetching upcoming launches ({UPCOMING_LAUNCH_PAGES} pages)...")
        upcoming = fetch_launches("upcoming", UPCOMING_LAUNCH_PAGES)
        print(f"Fetching previous launches ({PAST_LAUNCH_PAGES} pages)...")
        previous = fetch_launches("previous", PAST_LAUNCH_PAGES)

        save_cache(upcoming, previous)

    build_site(upcoming, previous)


if __name__ == "__main__":
    main()
