"""Compute summary analytics from the launch and entity data."""

from collections import Counter, defaultdict

from .config import PAGE_SIZE, PAST_LAUNCH_PAGES
from .details import pick

# The API reports agency country as an alpha-3 code ('USA') with no name
# field, so chart tooltips resolve codes through this table. Covers every
# code seen in the data, including each member of ESA's compound code.
COUNTRY_NAMES = {
    "USA": "United States", "CHN": "China", "RUS": "Russia",
    "IND": "India", "JPN": "Japan", "KOR": "South Korea",
    "PRK": "North Korea", "IRN": "Iran", "ISR": "Israel",
    "FRA": "France", "DEU": "Germany", "ITA": "Italy", "ESP": "Spain",
    "GBR": "United Kingdom", "IRL": "Ireland", "PRT": "Portugal",
    "NLD": "Netherlands", "BEL": "Belgium", "LUX": "Luxembourg",
    "CHE": "Switzerland", "AUT": "Austria", "POL": "Poland",
    "CZE": "Czechia", "HUN": "Hungary", "ROU": "Romania",
    "GRC": "Greece", "DNK": "Denmark", "SWE": "Sweden", "NOR": "Norway",
    "FIN": "Finland", "EST": "Estonia", "SVN": "Slovenia",
    "UKR": "Ukraine", "AUS": "Australia", "NZL": "New Zealand",
    "SGP": "Singapore", "KAZ": "Kazakhstan", "BRA": "Brazil",
    "GUF": "French Guiana", "OMN": "Oman",
}


def country_name(code):
    """Expand a country code to a name for the chart tooltip.

    A few agencies report comma-separated member states ('AUS,SGP'), so
    each part resolves individually; unlisted codes — and the API's own
    '???' placeholder — read 'Unknown'."""
    return ", ".join(COUNTRY_NAMES.get(part.strip(), "Unknown")
                     for part in code.split(","))


def compute_stats(rockets, previous):
    """Compute summary analytics from the deduplicated rocket set.

    Yearly stats are tallied from the fetched launches, since the API has
    no per-rocket yearly counts."""
    by_rocket = {}
    by_manufacturer = Counter()
    # Country groups by the rocket manufacturer's country, not the launch
    # pad's: lifetime counts are per-rocket, and one rocket can fly from
    # pads in several countries.
    by_country = Counter()
    # Chart labels use the manufacturer abbreviation; keep the full name
    # around so the frontend can show it too.
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
        if r.get("manufacturer_country"):
            by_country[r["manufacturer_country"]] += r["launches"]

    # Tally launches per calendar year — the API's own per-rocket counts
    # are lifetime-only. Each year gets a Counter per chart grouping:
    # rockets, manufacturers, and countries.
    per_year = defaultdict(lambda: [Counter(), Counter(), Counter()])
    for launch in previous:
        launch_year = (launch.get("net") or "")[:4]
        if not launch_year:
            continue
        rocket_counts, mfr_counts, country_counts = per_year[launch_year]
        config = pick(launch.get("rocket"), "configuration") or {}
        if name := config.get("full_name") or config.get("name"):
            rocket_counts[name] += 1
        manufacturer = config.get("manufacturer") or {}
        if manufacturer.get("name"):
            label = manufacturer.get("abbrev") or manufacturer["name"]
            mfr_counts[label] += 1
            manufacturer_names[label] = manufacturer["name"]
        if country := manufacturer.get("country_code"):
            country_counts[country] += 1

    years = sorted(per_year, reverse=True)
    # Results are fetched newest-first and may be cut off mid-year at the
    # page cap, so the oldest year is complete only when the API ran out
    # of launches before the cap was hit.
    if len(previous) >= PAST_LAUNCH_PAGES * PAGE_SIZE:
        years = years[:-1]

    def top(counter):
        """Counter -> dict ordered by descending count, for the charts."""
        return dict(counter.most_common())

    # Tooltip names for every code the chart can show, resolved once here
    # so the axis labels can stay as the short codes.
    country_codes = set(by_country) | {
        c for _, _, counts in per_year.values() for c in counts}

    return {
        "rocket_count": len(rockets),
        "total": sum(by_rocket.values()),
        "successful": sum(r.get("successful") or 0 for r in rockets.values()),
        "by_rocket": dict(sorted(by_rocket.items(), key=lambda kv: kv[1],
                                 reverse=True)),
        "by_manufacturer": top(by_manufacturer),
        "by_country": top(by_country),
        "yearly": {
            year: {"rockets": top(per_year[year][0]),
                   "manufacturers": top(per_year[year][1]),
                   "countries": top(per_year[year][2])}
            for year in years
        },
        "manufacturer_names": manufacturer_names,
        "country_names": {code: country_name(code) for code in country_codes},
    }
