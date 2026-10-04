# Changelog

## Unreleased

## 1.14.0 — 2026-10-04

- Faster feed loading, cache reuse and chart rendering; author counts are indexed once per archive update.
- Improved responsive layouts, long-link wrapping and reduced-motion behavior.
- Activity bars cover the full marathon; dense May markers keep important turns and complete session tooltips readable.
- Pace chart steps: 1k, 2k, 5k or 10k MTT. Marathon charts switch between sessions and calendar months, with monthly and cumulative MTT distance.
- Pace trend values appear in a legend above the plot.
- Removed BR-update/session counts and the footer's interface date; session-MTT averages are blue and the footer credits the author.
- FirstFund banner updated to $100M.
- Includes PR #88 and PR #89.

## 1.13.11 — 2026-09-03

- Pace titles and pills use loaded Inter weight 700, avoiding synthetic bold.

## 1.13.10 — 2026-09-03

- Tempo values and session-profit tooltips use loaded Roboto Mono weight 700.

## 1.13.9 — 2026-09-03

- Progress and rate chips use loaded weight 700; crowded mobile dots no longer touch.

## 1.13.8 — 2026-09-03

- Loaded Roboto Mono 600/700 and Inter 800; capped monospace weights at 700.
- Updated label-width estimates and hover date plates to fit the larger chart fonts.
- Thinned overlapping minor dots and disabled cluster fans under the six-session cap.

## 1.13.7 — 2026-09-03

- Pace charts leave space for partial-tail ticks.
- Larger, brighter chart text uses loaded weights without blurry shadows; minor dots are brighter.

## 1.13.5 — 2026-09-02

- Scraper syncs with main before reading data, preventing stale in-memory overwrites.
- Content-based `postsChangedAt` covers rating, image and date edits; no-op polls avoid redundant renders.
- Removed unused code and CSS, including the unreachable tooltip cap.
- Added CI permissions/concurrency and corrected workflow ignores and freshness/check documentation.

## 1.13.4 — 2026-09-02

- Fixed hook order when revealing ignored posts, preventing blank-page crashes.
- Restored visible session dots; minor dots are muted and rings appear on hover.
- Session and period MTT averages follow the cumulative-first rule used by pace and hero counters.
- Trend lines span the plot while fitting completed chunks only.
- Removed the current-date X-axis subtitle; hover tags show dates.

## 1.13.3 — 2026-08-20

- Month labels centre on each month's span; boundary ticks stay at its first session.

## 1.13.2 — 2026-08-20

- Every session group has a dot, with smaller minor dots that grow on hover.
- Both grouping passes cap markers at six sessions.
- Tighter marker spacing retains a quiet zone around the latest point.
- Overlapping minor dots are thinned; tooltips and totals still cover all sessions.

## 1.13.1 — 2026-08-20

- Hovered marathon points have an anchor coloured by profit, halo, crosshair and axis date tag.
- MTT charts for each session gained sparse date ticks and a highlighted per-day tooltip with volume, average deviation and profit.
- The latest session's gold value moved to a labelled header chip.

## 1.13.0 — 2026-08-20

- Marathon tooltips show BR and cumulative MTT; desktop hovering works across the plot with stable anchors and closes on exit.
- Peak callouts avoid smaller milestone plates.
- Week/month charts zoom to the visible BR range; labels stop overlapping and dense-tail X spacing follows MTT.
- Grouped tooltips show every session in the merged point.
- Pace, chart and hero MTT counters share cumulative totals.
- Added MTT bars for each session with an average guide and chip for the latest value, using the shared period filter.
- English and Spanish hide Russian-only controls, search translations, localize dates, registration details and ratings, and update HTML language; ignore no longer silently hides posts.
- Improved light-theme contrast across charts, tooltips, progress, banners and footer freshness.
- Lightbox dialog supports Escape; images/activity bars support keyboards, profile menus close on Escape, and scrolling respects reduced motion.
- Likes and translation updates reach open tabs; cold loads avoid duplicate post downloads.
- Missing assets/data return 404; footer dates use Warsaw time and freshness matches scraper cadence.
- Scraper reports failed pushes, retries after rebase and safely passes commit messages; updated undici/postcss and removed stale branches.

## 1.12.0 — 2026-07-02

- BR updates are tracked separately from marathon days; pace trends fit completed MTT chunks.
- Added Day/BR/MTT/duplicate integrity checks, versioned caches and tested data helpers.

## 1.11.0 — 2026-05-23

- Cleaner dollars earned per tournament chart uses a green trend and 2k-MTT points; partial chunks are muted and the graph starts at zero.
- Narrow layouts keep BR and profit readable without the stats rail.
- Restored GipsyTeam avatars and Romeo's avatar favicon.

## 1.10.0 — 2026-05-15

- Moved forum activity below the feed.

## 1.9.0 — 2026-05-09

- Refreshed Romeo's posts, separated author/thread stats from BR, and added a cleaner $10M progress widget and avatar favicon.
- Marathon labels mark milestones, major wins/losses, start, peak and latest point.
- Larger mobile charts use the actual BR scale without horizontal scrolling.
- Dense streaks group into readable markers with full session tooltips; smaller halos and clamped labels improve clarity.
- Removed the mobile bottom bar and gave charts more vertical room.
- Added chart, tooltip, activity-edge and forum-stat coverage; verified scraping and deployment.

## 1.8.0 — 2026-04-19

- Hover popups stay beside their anchors and coordinate so only one remains open; MTT uses a neutral spade icon.
- Extracted translations, persistence/data hooks and scraper translation logic.
- Loader chooses the freshest source and retains cache over older network data; local dev/build sync public JSON.
- Fixed chart hook order for retry/empty transitions.
- Added test/watch/check commands and CI for builds and tests; scraper uses clean installs, concurrency, timeouts and manual translation.
- Added tests for source freshness, cache and JSON fallback, locale time and BR deduplication coverage, and tests for translations, hooks, popups, polling and scraper helpers.
- App tests cover retry, language switching and filters.

## 1.4.0 — 2026-04-09

- New-post notifications jump to the first addition.
- Sidebar quotes appear inline; screenshot BR is exact and API failures retry.
- Smaller compact payloads retain full text and correctly ordered avatars; added local caching with a short TTL and render optimizations.
- Scraper uses pacing, parallel HEAD checks and early exits; pulls before pushes to avoid update conflicts.
- Chart sizing/ticks fit the first screen; tooltips close on outside clicks.
- Removed quoted images from posts/sidebar/popups, retained reply context and resynced stale images.

## 1.3.0 — 2026-04-08

- Refactored the app with a light theme, animated BR, full texts, room icons, image previews and mobile stats.
- Added scheduled scraping and screenshot BR recognition through Claude Vision.

## 1.2.0 — 2026-04-07

- Animated marathon chart and mobile layout.

## 1.1.0 — 2026-04-06

- Daily activity, top-10 posts and automatic refresh.

## 1.0.0 — 2026-04-05

- Initial feed, quotes, pagination, marathon chart, favorites and filters.
