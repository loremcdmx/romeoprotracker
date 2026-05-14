# RomeoPro Tracker

Tracker for [Romeopro's GipsyTeam thread](https://forum.gipsyteam.ru/index.php?viewtopic=181676): bankroll progress, session history, and the full post feed around the marathon.

**Live site:** [romeo.fish](https://romeo.fish)

## Stack

- React 18 + Vite
- Static deployment on Vercel
- GitHub Actions scraper for forum updates
- Claude API for bankroll screenshot extraction and Romeo post translations
- Compact JSON payloads with client-side caching

## Local Commands

```bash
npm ci
npm run dev
npm run build
npm run test
npm run check
```

Scraper commands:

```bash
npm run scrape
npm run scrape:dry-run
npm run scrape:no-push
npm run scrape:full
npm run scrape:reextract
npm run scrape:translate
```

Leaderboard probes:

```bash
npm run leaderboards:ggwf
npm run leaderboards:coin
```

`leaderboards:ggwf` fetches the public GGWF leaderboard group and searches the
default Romeo candidate nick `R Romanovskyi`. `leaderboards:coin` checks the
public CoinPoker CoinMasters leaderboard page for the known Romeo aliases. Both
commands are diagnostic only; they do not write app data unless `--write` is
passed.

For the app widget:

```bash
npm run leaderboards:ggwf -- --write data/leaderboards.json
```

`npm run dev` and `npm run build` automatically copy `data/*.json` into `public/data` so local builds work without hitting GitHub raw URLs.

## Frontend Architecture

Main application files:

- `src/App.jsx` — primary UI composition, charts, feed, and topic views
- `src/hooks/usePostsData.js` — loading, polling, new-post detection, refresh flow
- `src/hooks/usePersistentState.js` — typed `localStorage` persistence wrapper
- `src/storage.js` — public data loader, cache, compact payload expansion
- `src/i18n.js` — UI dictionary and date helpers
- `src/utils.js` — formatting, chart helpers, and bankroll history deduplication

The app is still a single-screen SPA, but state handling and data loading are no longer buried directly inside `App.jsx`.

## Data Loading Strategy

Runtime data is resolved from multiple sources:

1. `VITE_DATA_BASE_URL` if explicitly configured
2. Same-origin `/data/*` files generated during local builds
3. `raw.githubusercontent.com/<repo>/main/data/*`

The client compares `meta.lastUpdated` across successful sources and keeps the freshest payload instead of trusting the first response. That avoids stale Vercel assets when code deploys and scraper commits move at different cadences.

## Scraper

The scraper lives in `scripts/scrape.mjs`.

Modes:

- `normal` — scan recent pages, add new posts, refresh recent likes
- `full` — full thread scan, refresh likes across the whole dataset
- `reextract` — rebuild bankroll history from Romeo screenshot posts
- `translate` — backfill missing English and Spanish translations

Safety switches:

- `--dry-run` / `SCRAPE_DRY_RUN=1` — hit the forum and compute changes without writing files or running git
- `--no-push` / `SCRAPE_NO_PUSH=1` — update local `data/*.json` files but skip git pull / commit / push

GitHub Actions:

- every 5 minutes: `normal`
- every 12 hours: `full`
- manual dispatch: `normal`, `full`, `reextract`, or `translate`

Translation helpers are isolated in `scripts/lib/translation.mjs` so scraper-specific API logic is no longer mixed into the forum parsing flow.

## Data Files

- `data/posts.json` — full post payload
- `data/posts.min.json` — compact payload used by the client
- `data/meta.json` — bankroll summary, scraper metadata, bankroll history
- `data/leaderboards.json` — GGWF leaderboard snapshot used by the leaderboard widget

## Fork / Deploy Notes

1. Fork the repo.
2. Connect it to Vercel.
3. Add `ANTHROPIC_API_KEY` if you want screenshot extraction and translations.
4. Keep scraper automation on `main`; do feature work on separate branches.

There is no application backend in this repo. The deployed app is static and reads JSON data produced by the scraper.
