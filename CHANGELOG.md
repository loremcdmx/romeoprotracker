# Changelog

## Unreleased

## 1.12.0 — 2026-07-02

### UI
- renamed marathon chart counters from sessions to BR updates so they no longer conflict with Romeo's Day number
- recalculated the dollar-per-tournament trend from completed 2k-MTT chunks only

### Reliability
- added marathon data integrity checks for Day, bankroll, MTT totals, and duplicate BR updates
- hardened client cache versioning and split trend/data helpers into focused tested modules

## 1.11.0 — 2026-05-23

### UI
- rebuilt the dollar-per-tournament widget with calmer typography, cleaner chart lines, a green trend line, and 2k-MTT chart points
- incomplete chart chunks are shown as muted partial points, while the graph now starts from zero
- improved narrow-screen layout by hiding the right stats rail and keeping bankroll/profit cards readable

### Fixes
- restored real GipsyTeam avatars instead of letter fallbacks when the forum default avatar URL appears
- restored Romeo's avatar favicon

## 1.10.0 — 2026-05-15

### New features
- added a GGWF leaderboard widget with three readable columns for Low, Medium, and High
- each visible board shows the leaders, Romeo's current place, points, prize, and the gap to the next target
- added a countdown to the end of the GGWF leaderboard period
- added a points tooltip with the formula and approximate scoring examples

### Data
- added `data/leaderboards.json` as the app snapshot for GGWF leaderboard data
- added a repeatable GGWF leaderboard fetcher and a GitHub Actions workflow to refresh it automatically
- refreshed forum data from a full scan: new posts, latest likes, and compact payloads are updated

### UI polish
- rebuilt the leaderboard cards with stronger tier accents, cleaner prize chips, and a dedicated Romeo panel
- moved forum activity below the feed so the leaderboard widget owns the post-chart slot

### Reliability
- client data loading now carries leaderboard snapshots separately from forum post freshness
- added tests for the leaderboard widget and independent leaderboard freshness selection

## 1.9.0 — 2026-05-09

### New features
- added fresh Romeo marathon data from the latest forum posts
- forum stats are now separated from bankroll stats and include unique authors in the thread
- progress to `$10M` has its own cleaner progress widget based on bankroll progress
- favicon now uses Romeo's forum avatar

### Chart
- rebuilt marathon chart typography and axis labels for a cleaner dark-mode look
- X-axis labels now mark meaningful events instead of random spacing: bankroll milestones, large wins/losses, start, peak, and latest point
- mobile marathon chart is larger, uses the real bankroll scale, and avoids horizontal scroll
- dense plus/minus streaks are grouped into readable session points without hiding the real session breakdown
- grouped-point tooltip now shows the individual sessions inside the combined point
- reduced marker halos and kept edge labels inside the chart bounds

### Mobile
- removed the lower feed/topics/settings bar from the mobile layout for now
- tuned the chart proportions so the graph has more vertical room and less diagonal compression

### Reliability
- added coverage for event-based chart labels, grouped session tooltips, activity edge labels, and forum stats
- verified the scraper update path and production deployment after the chart changes

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
