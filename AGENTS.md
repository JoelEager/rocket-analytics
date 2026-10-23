# Agent notes

## Comments

- Add explanatory comments to all non-trivial sections — the goal is for a
  reader new to the codebase to follow the data flow without guesswork.
- Explain the *why*, not the *what*: non-obvious data shapes (e.g. what
  `per_year` holds), spec/format conventions (with a concrete example),
  edge cases (e.g. a malformed cache timestamp counts as stale), and
  API quirks (e.g. why upcoming and previous use different orderings).
- Skip comments that merely restate the code.

## README

- Keep it friendly to a novice software engineer. It includes a
  "Project layout" section with a file-by-file tour, an ASCII data-flow
  diagram, and a suggested reading order through the pipeline.
- Keep it accurate when refactoring: path references (e.g. constants in
  `sitegen/config.py`), module names, and usage examples must match the
  actual code.

## Verifying changes

- Install deps with `pip install -r requirements.txt`, then run
  `python main.py` to smoke-test the build. A plain run reuses
  `launch_cache.json` and never hits the API, so it's safe to run
  repeatedly; `--refresh` forces a fresh fetch.
- `site/` is generated output and gitignored — never commit it.
