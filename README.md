# rocket-analytics

A Python script that builds a static rocket-launch analytics site and
deploys it to GitHub Pages. Data comes from the free
[Launch Library 2](https://thespacedevs.com/llapi) API — no API key required.

## Usage

```bash
pip install -r requirements.txt
python main.py            # builds into site/
python main.py --limit 25 # fetch fewer launches (faster)
python main.py --refresh  # ignore the API response cache
```

Fetched launch data is cached in `.launch_cache.json` (gitignored) so
repeated builds during development don't re-hit the rate-limited API.
The cache is reused whenever it covers the requested `--limit`.

Open `site/index.html` in a browser to preview.

## How it works

- `main.py` fetches upcoming and previous launches, computes stats, and
  renders `templates/index.html` (Jinja2) into `site/`.
- `static/` is copied into the output directory.
- The GitHub Actions workflow in `.github/workflows/deploy.yml` rebuilds
  the site on every push to `master`, every 6 hours on a schedule, and on
  manual dispatch, then deploys it to GitHub Pages.

## Enabling GitHub Pages

After pushing, in the repo on GitHub: **Settings → Pages → Source →
GitHub Actions**. The next workflow run will publish the site.
