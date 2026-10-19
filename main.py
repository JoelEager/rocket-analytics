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


def compute_stats(rockets):
    """Compute summary analytics from the deduplicated rocket set."""
    by_rocket = {r["name"]: r["launches"] for r in rockets.values()
                 if r.get("launches") and r.get("name")}
    by_manufacturer = Counter()
    manufacturer_names = {}
    for r in rockets.values():
        if r.get("manufacturer") and r.get("launches"):
            label = r.get("manufacturer_abbrev") or r["manufacturer"]
            by_manufacturer[label] += r["launches"]
            manufacturer_names[label] = r["manufacturer"]

    return {
        "rocket_count": len(rockets),
        "total": sum(by_rocket.values()),
        "successful": sum(r.get("successful") or 0 for r in rockets.values()),
        "by_rocket": dict(sorted(by_rocket.items(),
                                 key=lambda kv: kv[1], reverse=True)[:10]),
        "by_manufacturer": dict(by_manufacturer.most_common(10)),
        "manufacturer_names": manufacturer_names,
    }


def pick(value, key):
    """Get `key` from a dict, or return a plain value unchanged."""
    return value.get(key) if isinstance(value, dict) else value


def agency_detail(agency):
    """Curated fields for a provider or mission agency."""
    return {
        "name": agency.get("name"),
        "abbrev": agency.get("abbrev"),
        "type": pick(agency.get("type"), "name"),
        "country": agency.get("country_code"),
        "description": agency.get("description"),
        "administrator": agency.get("administrator"),
        "founded": agency.get("founding_year"),
        "launchers": agency.get("launchers"),
        "spacecraft": agency.get("spacecraft"),
        "launches": agency.get("total_launch_count"),
        "successful": agency.get("successful_launches"),
        "failed": agency.get("failed_launches"),
        "pending": agency.get("pending_launches"),
        "streak": agency.get("consecutive_successful_launches"),
        "landings_attempted": agency.get("attempted_landings"),
        "landings_successful": agency.get("successful_landings"),
        "landings_failed": agency.get("failed_landings"),
        "landing_streak": agency.get("consecutive_successful_landings"),
        "image": pick(agency.get("image_url") or agency.get("image"), "image_url"),
        "info_url": agency.get("info_url"),
        "wiki_url": agency.get("wiki_url"),
    }


def rocket_detail(config):
    """Curated fields for a rocket configuration."""
    manufacturer = config.get("manufacturer") or {}
    return {
        "name": config.get("full_name") or config.get("name"),
        "family": config.get("family"),
        "variant": config.get("variant"),
        "manufacturer": manufacturer.get("name"),
        "manufacturer_abbrev": manufacturer.get("abbrev"),
        "active": config.get("active"),
        "reusable": config.get("reusable"),
        "description": config.get("description"),
        "length": config.get("length"),
        "diameter": config.get("diameter"),
        "launch_mass": config.get("launch_mass"),
        "leo_capacity": config.get("leo_capacity"),
        "gto_capacity": config.get("gto_capacity"),
        "thrust": config.get("to_thrust"),
        "maiden_flight": config.get("maiden_flight"),
        "launch_cost": config.get("launch_cost"),
        "alias": config.get("alias"),
        "min_stage": config.get("min_stage"),
        "max_stage": config.get("max_stage"),
        "apogee": config.get("apogee"),
        "vehicle_range": config.get("vehicle_range"),
        "launches": config.get("total_launch_count"),
        "successful": config.get("successful_launches"),
        "failed": config.get("failed_launches"),
        "pending": config.get("pending_launches"),
        "streak": config.get("consecutive_successful_launches"),
        "landings_attempted": config.get("attempted_landings"),
        "landings_successful": config.get("successful_landings"),
        "landings_failed": config.get("failed_landings"),
        "landing_streak": config.get("consecutive_successful_landings"),
        "image": config.get("image_url"),
        "info_url": config.get("info_url"),
        "wiki_url": config.get("wiki_url"),
    }


def pad_detail(pad):
    """Curated fields for a launch pad."""
    location = pad.get("location") or {}
    return {
        "name": pad.get("name"),
        "location": location.get("name"),
        "description": pad.get("description"),
        "latitude": pad.get("latitude"),
        "longitude": pad.get("longitude"),
        "map_url": pad.get("map_url"),
        "info_url": pad.get("info_url"),
        "wiki_url": pad.get("wiki_url"),
        "launches": pad.get("total_launch_count"),
    }


def collect_entities(launches):
    """Deduplicate entity objects observed across launches, keyed by id."""
    providers, rockets, agencies, pads = {}, {}, {}, {}
    for launch in launches:
        provider = launch.get("launch_service_provider") or {}
        if provider.get("id") is not None:
            providers.setdefault(provider["id"], agency_detail(provider))
        rocket = (launch.get("rocket") or {}).get("configuration") or {}
        if rocket.get("id") is not None:
            rockets.setdefault(rocket["id"], rocket_detail(rocket))
        for agency in (launch.get("mission") or {}).get("agencies") or []:
            if agency.get("id") is not None:
                agencies.setdefault(agency["id"], agency_detail(agency))
        pad = launch.get("pad") or {}
        if pad.get("id") is not None:
            pads.setdefault(pad["id"], pad_detail(pad))
    return {"providers": providers, "rockets": rockets,
            "agencies": agencies, "pads": pads}


def launch_detail(launch):
    """Pick the fields worth showing in the details modal."""
    mission = launch.get("mission") or {}
    image = launch.get("image") or {}
    return {
        "name": launch.get("name"),
        "net": launch.get("net"),
        "status": (launch.get("status") or {}).get("name"),
        "window_start": launch.get("window_start"),
        "window_end": launch.get("window_end"),
        "probability": launch.get("probability"),
        "mission_name": mission.get("name"),
        "mission_type": mission.get("type"),
        "orbit": (mission.get("orbit") or {}).get("abbrev"),
        "mission_description": mission.get("description"),
        "image": pick(image, "image_url"),
        "infographic": pick(launch.get("infographic"), "image_url"),
        "mission_patches": [
            pick(p, "image_url") for p in launch.get("mission_patches") or []
            if pick(p, "image_url")
        ],
        "webcast_live": launch.get("webcast_live"),
        "failreason": launch.get("failreason"),
        "holdreason": launch.get("holdreason"),
        "weather_concerns": launch.get("weather_concerns"),
        "program": [pick(p, "name") for p in launch.get("program") or []],
        "attempts_location": launch.get("location_launch_attempt_count"),
        "attempts_location_year": launch.get("location_launch_attempt_count_year"),
        "pad_turnaround": launch.get("pad_turnaround"),
        "provider_id": (launch.get("launch_service_provider") or {}).get("id"),
        "rocket_id": ((launch.get("rocket") or {}).get("configuration") or {}).get("id"),
        "pad_id": (launch.get("pad") or {}).get("id"),
        "agency_ids": [a.get("id") for a in mission.get("agencies") or []
                       if a.get("id") is not None],
        "updates": [
            {"comment": u.get("comment"), "info_url": u.get("info_url"),
             "created_on": u.get("created_on"), "created_by": u.get("created_by"),
             "profile_image": u.get("profile_image")}
            for u in launch.get("updates") or []
        ],
        "links": [
            {"url": pick(u, "url"), "label": pick(u.get("type"), "name"),
             "title": u.get("title") or u.get("source")}
            for u in (launch.get("infoURLs") or []) + (launch.get("vidURLs") or [])
            if pick(u, "url")
        ],
        "mission_links": [
            {"url": pick(u, "url"), "label": pick(u.get("type"), "name"),
             "title": u.get("title") or u.get("source")}
            for u in (mission.get("info_urls") or []) + (mission.get("vid_urls") or [])
            if pick(u, "url")
        ],
    }


def build_site(upcoming, previous):
    """Render templates and copy static assets."""
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(("html",)),
    )
    # Preserve dict order (sorted by count) instead of tojson's alphabetical keys.
    env.policies["json.dumps_kwargs"]["sort_keys"] = False

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

    latest = previous[0] if previous else {}

    # Render the HTML template
    template = env.get_template("index.html")
    html = template.render(
        upcoming=upcoming,
        previous=previous,
        orbital_total=latest.get("orbital_launch_attempt_count"),
        orbital_year=latest.get("orbital_launch_attempt_count_year"),
        orbital_year_label=(latest.get("net") or "")[:4],
        upcoming_detail=[launch_detail(launch) for launch in upcoming],
        previous_detail=[launch_detail(launch) for launch in previous],
        entities=(entities := collect_entities(upcoming + previous)),
        stats=compute_stats(entities["rockets"]),
        generated_at=datetime.now(timezone.utc).isoformat(),
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
