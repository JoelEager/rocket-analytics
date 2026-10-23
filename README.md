# Rocket Analytics

A vibe coded rocket launch analytics dashboard. Implemented in Python, it queries 
the [Launch Library 2](https://thespacedevs.com/llapi) API and builds static HTML
using Jinja2. Hosted on GitHub Pages and automatically updated via GitHub 
Actions every 6 hours.

[See it here](https://krocketcoding.github.io/rocket-analytics/)

## Usage

```bash
pip install -r requirements.txt
python main.py                    # builds into site/
python main.py --refresh          # ignore the API response cache
python main.py --max-cache-age 5  # refetch if the cache is over 5 hours old
```

Fetched launch data is cached in `launch_cache.json` (git ignored) and
reused regardless of age unless `--refresh` or `--max-cache-age` says
otherwise, so repeated builds during development don't re-hit the
rate-limited API. If a fetch fails, the script falls back to the stale
cache rather than failing the build.
The number of pages fetched per endpoint is set by `PAST_LAUNCH_PAGES`
and `UPCOMING_LAUNCH_PAGES` at the top of `main.py` (100 launches per page).

Open `site/index.html` in a browser to preview.

Each build also produces `site/rocket-analytics-offline.html`, a portable
single-file version of the site with the stylesheet and Chart.js inlined
and remote image URLs and external links stripped out — it can be opened in 
any browser without an internet connection. Chart.js is vendored in
`static/chart.js` and used by both versions of the site; the bundle is
skipped if a static file is missing.

## How it works

- `main.py` fetches upcoming and previous launches, computes stats, and
  renders `templates/index.html` into `site/` — once as `index.html` and
  once as `rocket-analytics-offline.html`, a self-contained single-file
  build with all resources inlined.
- `static/` is copied to `site/static/`.
- The GitHub Actions workflow in `.github/workflows/deploy.yml` rebuilds
  and deploys the site in a single job on every push to `master`, every
  6 hours on a schedule, and on manual dispatch.
- The workflow runs `main.py --max-cache-age 5` and persists
  `launch_cache.json` between runs via `actions/cache`, so push-triggered
  rebuilds within 5 hours of the last fetch skip the API entirely while
  the 6-hourly schedule always refreshes.
- Workflow runs share a `pages` concurrency group: pushes cancel any
  in-progress run so the newest commit deploys promptly, while scheduled
  and manual runs queue instead.

## Useful Links
- Launch Library 2 API
  - [Documentation](https://ll.thespacedevs.com/docs/)
  - [FAQ](https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_LL2.md)
- Chart.js (v4.5.1)
  - [Documentation](https://www.chartjs.org/docs/4.5.1/)
  - [Sample charts](https://www.chartjs.org/docs/4.5.1/samples/)
