"""Build the rocket-analytics static site."""

import argparse
from datetime import timedelta

from sitegen.api import fetch_launches
from sitegen.build import build_site
from sitegen.cache import load_cache, save_cache
from sitegen.config import PAST_LAUNCH_PAGES, UPCOMING_LAUNCH_PAGES


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
            # A failed build is worse than stale data: fall back to
            # whatever cache exists, no matter its age.
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
