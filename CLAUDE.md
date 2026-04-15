# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RomeoPro Tracker — a poker marathon tracker for [RomeoPro's thread](https://forum.gipsyteam.ru/index.php?viewtopic=181676) on GipsyTeam forum. Tracks bankroll progress from $10k to $10M across poker rooms (GG, PS, King, Coin).

**Live site:** romeoprotracker.vercel.app

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview production build

No linter, formatter, or test suite is configured.

## Architecture

Single-page React app (~2500 lines in one file `src/App.jsx`) with no router. Everything — components, CSS, helpers, chart logic — lives in App.jsx.

### Key files

- **`src/App.jsx`** — entire UI: topbar, hero stats, marathon chart (custom SVG), activity chart (Recharts), post feed, top posts. All CSS is a template literal injected via `<style>`.
- **`src/storage.js`** — fetches compact `posts.min.json` and `meta.json` from `raw.githubusercontent.com` (main branch, repo hardcoded as `loremcdmx/romeoprotracker`). Has a 1-min localStorage cache.
- **`scripts/scrape.mjs`** — scraper run by GitHub Actions (`.github/workflows/scrape.yml`) every ~5 min. Parses forum HTML with cheerio, extracts BR from Romeo's screenshots via Claude Vision, commits `data/*.json` back to main.
- **`src/main.jsx`** — React entry point, nothing special.

### Data flow

1. Data lives in `data/posts.json`, `data/posts.min.json`, and `data/meta.json` in this repo (committed to `main` branch by the scraper).
2. The frontend fetches `posts.min.json` + `meta.json` from raw.githubusercontent.com at runtime (no backend).
3. New posts are scraped server-side by `scripts/scrape.mjs` running in GitHub Actions.

### Charts

- **Marathon chart** — hand-built SVG with custom bezier path generation (`makeBezierPath`, `makeBezierArea`), tooltips, and animations. Not a library.
- **Activity chart** — uses Recharts (`AreaChart`).

## Deployment

Vercel, auto-deploys from `main` branch. Push/merge to `main` triggers deploy. The `@vercel/analytics` package is included.

## Language

UI text and comments are in Russian. Variable names and code are in English.
