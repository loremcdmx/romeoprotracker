# Changelog

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
