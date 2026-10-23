"""Compute summary analytics from the launch and entity data."""

from collections import defaultdict

from .config import PAGE_SIZE, PAST_LAUNCH_PAGES
from .details import pick

# The API reports agency country as an alpha-3 code ('USA') with no name
# field, so chart tooltips resolve codes through this table. Covers every
# code seen in the data, including each member of ESA's compound code.
COUNTRY_NAMES = {
    "USA": "United States", "CHN": "China", "RUS": "Russia", "IND": "India", "JPN": "Japan",
    "KOR": "South Korea", "PRK": "North Korea", "IRN": "Iran", "ISR": "Israel",
    "FRA": "France", "DEU": "Germany", "ITA": "Italy", "ESP": "Spain", "GBR": "United Kingdom",
    "IRL": "Ireland", "PRT": "Portugal", "NLD": "Netherlands", "BEL": "Belgium", "LUX": "Luxembourg",
    "CHE": "Switzerland", "AUT": "Austria", "POL": "Poland", "CZE": "Czechia", "HUN": "Hungary",
    "ROU": "Romania", "GRC": "Greece", "DNK": "Denmark", "SWE": "Sweden", "NOR": "Norway",
    "FIN": "Finland", "EST": "Estonia", "SVN": "Slovenia", "UKR": "Ukraine", "AUS": "Australia",
    "NZL": "New Zealand", "SGP": "Singapore", "KAZ": "Kazakhstan", "BRA": "Brazil",
    "GUF": "French Guiana", "OMN": "Oman",
}


def country_name(code):
    """Expand a country code to a name for the chart tooltip.

    A few agencies report comma-separated member states ('AUS,SGP'), so each part resolves
    individually; unlisted codes — and the API's own '???' placeholder — read 'Unknown'."""
    return ", ".join(COUNTRY_NAMES.get(part.strip(), "Unknown") for part in code.split(","))


# Stacked-chart categories: failures are their own segment, and the rest
# split by whether the mission targeted orbit — 'Sub' is the only
# suborbital orbit the API reports (and exactly the launches where
# orbital_launch_attempt_count is null).
FAILED_ABBREVS = ("Failure", "Partial Failure")


def launch_category(launch):
    """Classify a fetched launch as 'orbital', 'suborbital', or 'failed'."""
    if (launch.get("status") or {}).get("abbrev") in FAILED_ABBREVS:
        return "failed"
    orbit = pick(pick(launch.get("mission"), "orbit"), "abbrev")
    return "suborbital" if orbit == "Sub" else "orbital"


def new_cat():
    """Empty {'orbital', 'suborbital', 'failed'} counter dict."""
    return {"orbital": 0, "suborbital": 0, "failed": 0}


def top_cat(cats):
    """{name: cat dict} -> same shape ordered by descending total."""
    return dict(sorted(cats.items(), key=lambda kv: -sum(kv[1].values())))


def compute_stats(rockets, previous):
    """Compute summary analytics from the deduplicated rocket set.

    Yearly stats are tallied from the fetched launches, since the API has no per-rocket yearly counts."""
    # Chart labels use the manufacturer abbreviation; keep the full name
    # around so the frontend can show it too.
    manufacturer_names = {}
    # Rocket name -> manufacturer country, for the chart's country filter.
    rocket_countries = {}
    # Tally fetched launches per calendar year. Each year gets a
    # name -> category dict per chart grouping: rockets, manufacturers,
    # and countries.
    per_year = defaultdict(lambda: [defaultdict(new_cat), defaultdict(new_cat), defaultdict(new_cat)])
    for launch in previous:
        launch_year = (launch.get("net") or "")[:4]
        if not launch_year:
            continue
        cat = launch_category(launch)
        rocket_counts, mfr_counts, country_counts = per_year[launch_year]
        config = pick(launch.get("rocket"), "configuration") or {}
        name = config.get("full_name") or config.get("name")
        if name:
            rocket_counts[name][cat] += 1
        manufacturer = config.get("manufacturer") or {}
        if manufacturer.get("name"):
            label = manufacturer.get("abbrev") or manufacturer["name"]
            mfr_counts[label][cat] += 1
            manufacturer_names[label] = manufacturer["name"]
        if country := manufacturer.get("country_code"):
            country_counts[country][cat] += 1

    # Lifetime success/failure pools per grouping. The API has no
    # lifetime orbital/suborbital breakdown, so 'all time' stacks as
    # success + failed rather than showing estimated segments.
    mfr_pool = defaultdict(lambda: {"success": 0, "failed": 0})
    country_pool = defaultdict(lambda: {"success": 0, "failed": 0})
    by_rocket = {}
    for r in rockets.values():
        name = r.get("name")
        if not r.get("launches"):
            continue
        # Only rockets that can appear in the charts get a country
        # mapping — otherwise dead codes like the API's '???' (on
        # never-launched "Unknown Launch Vehicle") end up as filter
        # options that can only produce an empty chart.
        if r.get("manufacturer_country") and name:
            rocket_countries[name] = r["manufacturer_country"]
        cats = {"success": r.get("successful") or 0, "failed": r.get("failed") or 0}
        if name:
            by_rocket[name] = cats
        # Country groups by the rocket manufacturer's country, not the
        # launch pad's: one rocket can fly from pads in several countries.
        pools = []
        if r.get("manufacturer"):
            label = r.get("manufacturer_abbrev") or r["manufacturer"]
            pools.append(mfr_pool[label])
            manufacturer_names[label] = r["manufacturer"]
        if r.get("manufacturer_country"):
            pools.append(country_pool[r["manufacturer_country"]])
        for pool in pools:
            pool["success"] += cats["success"]
            pool["failed"] += cats["failed"]

    years = sorted(per_year, reverse=True)
    # Results are fetched newest-first and may be cut off mid-year at the
    # page cap, so the oldest year is complete only when the API ran out
    # of launches before the cap was hit.
    if len(previous) >= PAST_LAUNCH_PAGES * PAGE_SIZE:
        years = years[:-1]

    # Tooltip names for every code the chart can show, resolved once here
    # so the axis labels can stay as the short codes. rocket_countries is
    # included so the country filter can name codes like '???' (Unknown)
    # that belong to rockets with no recorded launches.
    country_codes = (set(country_pool) | set(rocket_countries.values()) |
                     {c for _, _, counts in per_year.values() for c in counts})

    yearly = {}
    for year in years:
        rocket_c, mfr_c, country_c = per_year[year]
        yearly[year] = {"rockets": top_cat(rocket_c),
                        "manufacturers": top_cat(mfr_c),
                        "countries": top_cat(country_c)}

    return {
        "rocket_count": len(rockets),
        "total": sum(sum(c.values()) for c in by_rocket.values()),
        "successful": sum(r.get("successful") or 0 for r in rockets.values()),
        "by_rocket": top_cat(by_rocket),
        "by_manufacturer": top_cat(mfr_pool),
        "by_country": top_cat(country_pool),
        "yearly": yearly,
        "manufacturer_names": manufacturer_names,
        "country_names": {code: country_name(code) for code in country_codes},
        "rocket_countries": rocket_countries,
    }
