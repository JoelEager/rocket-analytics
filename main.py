"""Build the rocket-analytics static site."""

import argparse
import json
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from jinja2 import Environment, FileSystemLoader, select_autoescape

PAST_LAUNCH_PAGES = 10
UPCOMING_LAUNCH_PAGES = 2
PAGE_SIZE = 100
MAX_ATTEMPTS = 2

API_BASE = "https://ll.thespacedevs.com/2.2.0"
SITE_DIR = Path("site")
TEMPLATES_DIR = Path("templates")
STATIC_DIR = Path("static")
CACHE_FILE = Path("launch_cache.json")


def get_json(endpoint, params):
    """GET an LL2 launch endpoint with retries; return the decoded JSON."""
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = requests.get(f"{API_BASE}/launch/{endpoint}/",
                                    params=params, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            print(f"Attempt {attempt + 1} failed: {e}")
    raise RuntimeError("Failed to fetch data from the API")


def fetch_launches(endpoint, pages):
    """Fetch up to `pages` pages of launches from an endpoint."""
    params = {"limit": PAGE_SIZE, "mode": "detailed"}
    if endpoint == "upcoming":
        params.update(ordering="net", hide_recent_previous="true")
    else:
        params["ordering"] = "-net"

    results = []
    for i in range(pages):
        data = get_json(endpoint, {**params, "offset": i * PAGE_SIZE})
        print(f"Got page {i + 1}")
        results.extend(data["results"])
        if not data.get("next"):
            print("No more pages to fetch.")
            break
    return results


def load_cache(max_age=None):
    """Return cached (upcoming, previous, last_updated), or None.
    If `max_age` (a timedelta) is given, reject caches older than that."""
    try:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print("Warning: Could not load cache file.")
        return None

    upcoming, previous = data.get("upcoming", []), data.get("previous", [])
    if not upcoming or not previous:
        print("Warning: Cache file is missing data.")
        return None

    last_updated = data.get("last_updated")
    if max_age is not None:
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(last_updated)
        except (TypeError, ValueError):
            age = None
        if age is None or age > max_age:
            print(f"Cache is stale ({last_updated}); refreshing.")
            return None
    return upcoming, previous, last_updated


def save_cache(upcoming, previous):
    """Save the fetched launches to the cache file; return last_updated."""
    last_updated = datetime.now(timezone.utc).isoformat()
    try:
        CACHE_FILE.write_text(
            json.dumps({
                "upcoming": upcoming,
                "previous": previous,
                "last_updated": last_updated,
            }, indent=2),
            encoding="utf-8",
        )
        print("Cache saved successfully.")
    except OSError:
        print("Warning: Could not save cache file.")
    return last_updated


def pick(value, key):
    """Return value[key] if value is a dict, else the value itself."""
    return value.get(key) if isinstance(value, dict) else value


def pull(source, spec):
    """Copy fields from a dict. Spec items are 'key' for same-named copies
    or (dest, 'key' | 'key.subkey') to rename/unwrap."""
    out = {}
    for item in spec:
        if isinstance(item, str):
            out[item] = source.get(item)
        else:
            dest, path = item
            key, _, sub = path.partition(".")
            out[dest] = pick(source.get(key), sub) if sub else source.get(key)
    return out


# Launch-record stats shared by agency and rocket detail payloads.
RECORD_FIELDS = [
    ("launches", "total_launch_count"),
    ("successful", "successful_launches"),
    ("failed", "failed_launches"),
    ("pending", "pending_launches"),
    ("streak", "consecutive_successful_launches"),
    ("landings_attempted", "attempted_landings"),
    ("landings_successful", "successful_landings"),
    ("landings_failed", "failed_landings"),
    ("landing_streak", "consecutive_successful_landings"),
]

AGENCY_FIELDS = [
    "name", "abbrev", ("type", "type.name"), ("country", "country_code"),
    "description", "administrator", ("founded", "founding_year"),
    "launchers", "spacecraft", "info_url", "wiki_url",
    *RECORD_FIELDS,
]

ROCKET_FIELDS = [
    "family", "variant", "active", "reusable", "description",
    "length", "diameter", "launch_mass", "leo_capacity", "gto_capacity",
    ("thrust", "to_thrust"), "maiden_flight", "launch_cost", "alias",
    "min_stage", "max_stage", "apogee", "vehicle_range",
    ("image", "image_url"), "info_url", "wiki_url",
    *RECORD_FIELDS,
]

PAD_FIELDS = [
    "name", "description", "latitude", "longitude", "map_url", "info_url",
    "wiki_url", ("launches", "total_launch_count"),
]

LAUNCH_FIELDS = [
    "name", "net", ("status", "status.name"), "window_start", "window_end",
    "probability", ("image", "image.image_url"),
    ("infographic", "infographic.image_url"), "webcast_live",
    "failreason", "holdreason", "weather_concerns",
    ("attempts_location", "location_launch_attempt_count"),
    ("attempts_location_year", "location_launch_attempt_count_year"),
    "pad_turnaround",
]

UPDATE_FIELDS = ["comment", "info_url", "created_on", "created_by",
                 "profile_image"]


def agency_detail(agency):
    """Curated fields for a provider or mission agency."""
    detail = pull(agency, AGENCY_FIELDS)
    detail["image"] = pick(agency.get("image_url") or agency.get("image"),
                           "image_url")
    return detail


def rocket_detail(config):
    """Curated fields for a rocket configuration."""
    manufacturer = config.get("manufacturer") or {}
    return {
        "name": config.get("full_name") or config.get("name"),
        "manufacturer": manufacturer.get("name"),
        "manufacturer_abbrev": manufacturer.get("abbrev"),
        "manufacturer_id": manufacturer.get("id"),
        **pull(config, ROCKET_FIELDS),
    }


def pad_detail(pad):
    """Curated fields for a launch pad."""
    detail = pull(pad, PAD_FIELDS)
    detail["location"] = pick(pad.get("location"), "name")
    return detail


def link_details(*url_lists):
    """Normalize info/vid URL entries, which may be dicts or bare strings."""
    links = []
    for entries in url_lists:
        for entry in entries or []:
            url = pick(entry, "url")
            if not url:
                continue
            if isinstance(entry, dict):
                links.append({
                    "url": url,
                    "label": pick(entry.get("type"), "name"),
                })
            else:
                links.append({"url": url})
    return links


def launch_detail(launch):
    """Pick the fields worth showing in the details modal."""
    mission = launch.get("mission") or {}
    return {
        **pull(launch, LAUNCH_FIELDS),
        "mission_name": mission.get("name"),
        "mission_type": mission.get("type"),
        "orbit": pick(mission.get("orbit"), "abbrev"),
        "mission_description": mission.get("description"),
        "mission_patches": [
            url for p in launch.get("mission_patches") or []
            if (url := pick(p, "image_url"))
        ],
        "program": [pick(p, "name") for p in launch.get("program") or []],
        "provider_id": pick(launch.get("launch_service_provider"), "id"),
        "rocket_id": pick(pick(launch.get("rocket"), "configuration"), "id"),
        "pad_id": pick(launch.get("pad"), "id"),
        "agency_ids": [a.get("id") for a in mission.get("agencies") or []
                       if a.get("id") is not None],
        "updates": [pull(u, UPDATE_FIELDS)
                    for u in launch.get("updates") or []],
        "links": link_details(launch.get("infoURLs"), launch.get("vidURLs")),
        "mission_links": link_details(mission.get("info_urls"),
                                      mission.get("vid_urls")),
    }


def collect_entities(launches):
    """Deduplicate entity objects observed across launches, keyed by id."""
    entities = {"providers": {}, "rockets": {}, "agencies": {}, "pads": {}}

    def add(group, obj, detail_fn):
        if obj and obj.get("id") is not None:
            entities[group].setdefault(obj["id"], detail_fn(obj))

    for launch in launches:
        add("providers", launch.get("launch_service_provider"), agency_detail)
        add("rockets", pick(launch.get("rocket"), "configuration"),
            rocket_detail)
        for agency in pick(launch.get("mission"), "agencies") or []:
            add("agencies", agency, agency_detail)
        add("pads", launch.get("pad"), pad_detail)
    return entities


def compute_stats(rockets, previous):
    """Compute summary analytics from the deduplicated rocket set.

    Yearly stats are tallied from the fetched launches, since the API has
    no per-rocket yearly counts."""
    by_rocket = {}
    by_manufacturer = Counter()
    manufacturer_names = {}
    for r in rockets.values():
        if not r.get("launches"):
            continue
        if r.get("name"):
            by_rocket[r["name"]] = r["launches"]
        if r.get("manufacturer"):
            label = r.get("manufacturer_abbrev") or r["manufacturer"]
            by_manufacturer[label] += r["launches"]
            manufacturer_names[label] = r["manufacturer"]

    # Results are fetched newest-first and cut off mid-year at the page
    # cap, so the oldest year in the set is complete only when the API
    # ran out of launches before the cap was hit.
    per_year = defaultdict(lambda: [Counter(), Counter()])
    for launch in previous:
        launch_year = (launch.get("net") or "")[:4]
        if not launch_year:
            continue
        rocket_counts, mfr_counts = per_year[launch_year]
        config = pick(launch.get("rocket"), "configuration") or {}
        if name := config.get("full_name") or config.get("name"):
            rocket_counts[name] += 1
        manufacturer = config.get("manufacturer") or {}
        if manufacturer.get("name"):
            label = manufacturer.get("abbrev") or manufacturer["name"]
            mfr_counts[label] += 1
            manufacturer_names[label] = manufacturer["name"]

    years = sorted(per_year, reverse=True)
    if len(previous) >= PAST_LAUNCH_PAGES * PAGE_SIZE:
        years = years[:-1]
    top = lambda c: dict(c.most_common())
    return {
        "rocket_count": len(rockets),
        "total": sum(by_rocket.values()),
        "successful": sum(r.get("successful") or 0 for r in rockets.values()),
        "by_rocket": dict(sorted(by_rocket.items(), key=lambda kv: kv[1],
                                 reverse=True)),
        "by_manufacturer": top(by_manufacturer),
        "yearly": {
            year: {"rockets": top(per_year[year][0]),
                   "manufacturers": top(per_year[year][1])}
            for year in years
        },
        "manufacturer_names": manufacturer_names,
    }


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

    html = env.get_template("index.html").render(
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
    (SITE_DIR / "index.html").write_text(html, encoding="utf-8")
    print(f"Site built in {SITE_DIR}/")


def main():
    """Entry point for the script."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true",
                        help="load fresh data from the API")
    parser.add_argument("--max-cache-age", type=float, metavar="HOURS",
                        help="refetch if the cache is older than this many "
                             "hours (default: use the cache regardless of age)")
    args = parser.parse_args()

    max_age = (timedelta(hours=args.max_cache_age)
               if args.max_cache_age is not None else None)
    cached = None if args.refresh else load_cache(max_age)
    if cached:
        upcoming, previous, last_updated = cached
        print(f"Using cached data: {len(upcoming)} upcoming, "
              f"{len(previous)} previous launches from {last_updated}")
    else:
        try:
            print(f"Fetching upcoming launches ({UPCOMING_LAUNCH_PAGES} pages)...")
            upcoming = fetch_launches("upcoming", UPCOMING_LAUNCH_PAGES)
            print(f"Fetching previous launches ({PAST_LAUNCH_PAGES} pages)...")
            previous = fetch_launches("previous", PAST_LAUNCH_PAGES)
        except Exception as e:
            stale = load_cache()
            if not stale:
                raise
            upcoming, previous, last_updated = stale
            print(f"Fetch failed ({e}); using stale cache from {last_updated}")
        else:
            last_updated = save_cache(upcoming, previous)

    build_site(upcoming, previous, last_updated)


if __name__ == "__main__":
    main()
