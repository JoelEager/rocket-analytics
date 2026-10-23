"""Compute summary analytics from the launch and entity data."""

from collections import Counter, defaultdict

from .config import PAGE_SIZE, PAST_LAUNCH_PAGES
from .details import pick


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
