"""Shared configuration for the rocket-analytics site build."""

from pathlib import Path

PAST_LAUNCH_PAGES = 12
UPCOMING_LAUNCH_PAGES = 2
PAGE_SIZE = 100
MAX_ATTEMPTS = 2

API_BASE = "https://ll.thespacedevs.com/2.2.0"
SITE_DIR = Path("site")
TEMPLATES_DIR = Path("templates")
STATIC_DIR = Path("static")
CACHE_FILE = Path("launch_cache.json")

# Alternate output: a portable single-file build with all resources inlined.
BUNDLE_FILE = SITE_DIR / "rocket-analytics-offline.html"
CHARTJS_FILE = STATIC_DIR / "chart.js"
