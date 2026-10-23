"""Fetch launch data from the Launch Library 2 API."""

import requests

from .config import API_BASE, MAX_ATTEMPTS, PAGE_SIZE


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
