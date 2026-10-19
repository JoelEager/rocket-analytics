# Rocket Analytics

A vibe coded rocket launch analytics dashboard. Implemented in Python, it queries 
the [Launch Library 2](https://thespacedevs.com/llapi) API and builds static HTML
using Jinja2. Hosted on GitHub Pages and automatically updated via GitHub 
Actions every 6 hours.

[See it here](https://joeleager.github.io/rocket-analytics/)

## Usage

```bash
pip install -r requirements.txt
python main.py            # builds into site/
python main.py --refresh  # ignore the API response cache
```

Fetched launch data is cached in `launch_cache.json` (gitignored) so
repeated builds during development don't re-hit the rate-limited API.
The number of pages fetched per endpoint is set by `PAST_LAUNCH_PAGES`
and `UPCOMING_LAUNCH_PAGES` at the top of `main.py` (100 launches per page).

Open `site/index.html` in a browser to preview.

## How it works

- `main.py` fetches upcoming and previous launches, computes stats, and
  renders `templates/index.html` into `site/`.
- `static/` is copied to `site/static/`.
- The GitHub Actions workflow in `.github/workflows/deploy.yml` rebuilds
  the site on every push to `master`, every 6 hours on a schedule, and on
  manual dispatch, then deploys it to GitHub Pages.
