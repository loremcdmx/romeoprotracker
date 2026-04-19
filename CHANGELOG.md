# Changelog

## Unreleased

## 1.8.0 — 2026-04-19

### New features
- hover popups are positioned next to the hovered element again instead of being pinned to the top edge of the screen
- hover popups now coordinate with each other so opening one closes the others instead of showing stray duplicates
- replaced the `Сыграно МТТ` icon with a neutral spade icon

### Architecture
- extracted UI translations into `src/i18n.js`
- extracted persistent state and public-data loading into dedicated hooks
- moved scraper translation logic into `scripts/lib/translation.mjs`

### Reliability
- client now compares `meta.lastUpdated` across all configured public data sources and keeps the freshest payload
- stale client cache is preferred over older network data instead of being overwritten blindly
- local `predev` / `prebuild` sync copies tracked JSON data into `public/data`
- fixed conditional hook order in chart components so retry / empty-state transitions do not blow up React renders

### Tooling
- added `npm test`, `npm test:watch`, and `npm run check`
- added CI workflow for build + tests
- hardened scraper workflow with `npm ci`, concurrency control, timeouts, and manual `translate` mode

### Tests
- added storage loader coverage for source freshness, cache fallback, and compact/full JSON fallback
- expanded utility coverage for locale-aware relative time and bankroll history deduplication
- added dedicated tests for `i18n`, persistent state, hover-popup coordination, poll-based post loading, and scraper translation helpers
- added App-level coverage for retry, language switching, and filter flows

## 1.4.0 — 2026-04-09

### New features
- Like/dislike posts on GipsyTeam directly from the tracker (thumbs up/down emoji buttons with optimistic UI + verification)
- "N new posts!" notification bubble — click to jump to the first new post
- Short quotes shown fully inline in top posts sidebar (no need to hover)
- Exact bankroll data from screenshots (no rounding), auto-retry on API failures

### Performance
- Compact data format (`posts.min.json`) — 57% smaller payload with avatar dedup, null stripping, short keys
- localStorage caching with 2-min TTL to avoid redundant fetches
- Memoized style constants and extracted event handlers
- Scraper: 500ms delay, parallel HEAD requests, early exit when no new posts

### Fixes
- Marathon chart: cleaner Y-axis ticks, reduced vertical stretch, fits first screen
- Chart tooltip stays visible when moving mouse from dot to tooltip, closes on outside click
- Scraper: images from `<blockquote>` no longer appear in post images
- Scraper: git pull before push to avoid rebase conflicts on concurrent updates
- Avatar dedup uses Map to preserve insertion order (fixes avatar mismatch)
- Full post text preserved in compact format (no truncation)
- Quote context shown in top posts sidebar (author, reply text)
- Quoted images hidden in sidebar/popup for reply posts

### Scraper
- Cron frequency increased to every 15 min (was 30 min)
- Rescrape syncs images to remove stale quoted images

## 1.3.0 — 2026-04-08

- Full refactoring, light theme, animated BR counter
- Auto-scraper via GitHub Actions (cron every 30 min)
- Claude Vision API for bankroll screenshot recognition
- Full post texts, room icons in tooltip, top post image previews
- Mobile stats adaptation

## 1.2.0 — 2026-04-07

- Marathon chart with monotone bezier curves and animation
- Mobile layout

## 1.1.0 — 2026-04-06

- Activity widget by day, top-10 posts, auto-refresh

## 1.0.0 — 2026-04-05

- Initial release — feed, quotes, pagination, marathon chart, topics, favorites, filters
