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

`npm run dev` and `npm run build` regenerate the recent snapshot and copy the deployable JSON files into `public/data`, providing a same-origin source alongside GitHub raw.

## Frontend Architecture

Main application files:

- `src/App.jsx` — primary UI composition, charts, and feed
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

Full-feed loads compare small metadata responses first, then normally download only the freshest source's compact posts file. Freshness includes `lastUpdated`, `postsChangedAt`, and history/tournament markers. Slower metadata remains eligible during the selected body download and its grace window. Failed compact files retain the full-file and alternate-source fallbacks; inactive streams time out without cutting off downloads that are still progressing.

At entry widths up to 980px, the app instead loads only `posts.recent.min.json`: the latest 300 posts with remapped avatars, explicit coverage, and complete marathon metadata. Session/bankroll charts retain their full history. Search, filters, and top posts are labelled as recent-only; full forum activity appears after the user selects **Load full history**. Polling stays in recent mode, and resizing never silently downloads or discards history. Recent and full caches/requests are separate; an explicit upgrade cannot replace newer recent data with an older full snapshot.

The scraper publishes the recent snapshot in the same commit as its source data. `node scripts/generate-recent-data.mjs` regenerates it locally; the data integrity check verifies exact agreement with `posts.min.json` and `meta.json`.

Vercel uses `scripts/vercel-ignore-build.mjs` as its ignored build step. Data-only scraper commits are skipped on Vercel because the deployed client can read fresher JSON directly from GitHub raw; source, dependency, config, and public asset changes still build normally.

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

- scheduled every 5 minutes: `normal` (GitHub delivers cron best-effort — observed anywhere from ~60 to 4 runs/day)
- every 12 hours: `full`
- manual dispatch: `normal`, `full`, `reextract`, or `translate`

Translation helpers are isolated in `scripts/lib/translation.mjs` so scraper-specific API logic is no longer mixed into the forum parsing flow.

## Data Files

- `data/posts.json` — full post payload
- `data/posts.min.json` — compact payload used by the client
- `data/posts.recent.min.json` — latest 300 compact posts, complete metadata, and coverage for the light mobile feed
- `data/meta.json` — bankroll summary, scraper metadata, bankroll history

## Fork / Deploy Notes

1. Fork the repo.
2. Connect it to Vercel.
3. Add `ANTHROPIC_API_KEY` if you want screenshot extraction and translations.
4. Keep scraper automation on `main`; do feature work on separate branches.

There is no application backend in this repo. The deployed app is static and reads JSON data produced by the scraper.
