# CLAUDE.md

This repository hosts the RomeoPro Tracker frontend and the scraper that produces its public JSON dataset.

## Commands

- `npm run dev` — start the local Vite dev server
- `npm run build` — build production assets
- `npm run preview` — preview the production build
- `npm run test` — run Vitest once
- `npm run check` — production build, tests, data-integrity smoke and vercel-ignore-build smoke
- `npm run scrape` — normal scraper pass
- `npm run scrape:dry-run` — network + parse validation without writing files or touching git
- `npm run scrape:no-push` — update local scraper outputs without git pull / commit / push
- `npm run scrape:full` — full thread scan
- `npm run scrape:reextract` — rebuild bankroll history from screenshots
- `npm run scrape:translate` — backfill missing en/es translations

## Architecture

Frontend:

- `src/App.jsx` — main screen assembly and view-level logic
- `src/hooks/usePostsData.js` — polling, refresh, unseen-post tracking
- `src/hooks/usePersistentState.js` — `localStorage` persistence helper
- `src/storage.js` — multi-source public data loader and cache
- `src/i18n.js` — translation dictionary and locale-aware helpers
- `src/utils.js` — formatting, chart math, and common parsing helpers

Scraper:

- `scripts/scrape.mjs` — forum scrape orchestration, data merge, git commit/push
- scraper also supports `--dry-run` and `--no-push` for safe local verification
- `scripts/lib/translation.mjs` — translation signature and Anthropic translation client
- `scripts/sync-static-data.mjs` — copies tracked JSON data into `public/data` for local builds

## Data Flow

1. The scraper updates `data/posts.json`, `data/posts.min.json`, and `data/meta.json`.
2. Local dev/build runs sync those files into `public/data`.
3. The client loads data from configured public sources and picks the freshest payload by `max(meta.lastUpdated, meta.postsChangedAt)`.
4. Client cache is short-lived and falls back to stale cached data only when every network source fails or is older.

## Deployment Notes

- The production app is a static Vercel deployment.
- Vercel runs `scripts/vercel-ignore-build.mjs` before builds. Data-only scraper
  commits are intentionally skipped because the client also reads fresh JSON from
  GitHub raw; code/config/dependency changes still build.
- Scraper automation is defined in `.github/workflows/scrape.yml`.
- CI checks are defined in `.github/workflows/ci.yml`.
- Feature work should happen on non-`main` branches; scraper automation is intended to run on `main`.
