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
LAUNCH_CACHE_FILE = Path("launch_cache.json")

# Alternate output: a portable offline single-file build with all
# resources inlined.
OFFLINE_FILE = SITE_DIR / "rocket-analytics-offline.html"
CHARTJS_FILE = STATIC_DIR / "chart.umd.min.js"
APPJS_FILE = STATIC_DIR / "app.js"
CHARTS_FILE = STATIC_DIR / "charts.js"
CSS_FILE = STATIC_DIR / "style.css"
# Script files in load order: charts.js uses globals from app.js and the
# vendored Chart.js library, so it loads last.
JS_FILES = [CHARTJS_FILE, APPJS_FILE, CHARTS_FILE]

# Images embedded in the offline build are downscaled to display size.
PATCH_IMAGE_PX = 128   # mission patches render at 72px
ROCKET_IMAGE_PX = 640  # rocket photos render full-width in the modal
IMAGE_QUALITY = 65     # WebP quality for embedded images
IMAGE_CACHE_DIR = Path("image-cache")
