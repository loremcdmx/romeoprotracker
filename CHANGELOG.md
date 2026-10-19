# Changelog

## Unreleased

## 1.14.15 — 2026-10-19

- Light theme: the remaining text below readable contrast is fixed (the "last" session chip, the partial pace labels, phone Y-axis labels, the sidebar top-posts period buttons and the footer version tags); the activity chart's period buttons are real classes with the deeper red in light.
- The dark theme is unchanged.

## 1.14.14 — 2026-10-19

- Scraper: a persistent Anthropic API refusal (invalid key, no credit) now raises a GitHub warning annotation once per run instead of staying silent; the README explains how to recover a given-up bankroll session.
- On a cold load, when two data sources are equally fresh, the one with the newer scraper heartbeat wins, so the footer shows the true last-run time.
- A failed refresh over a loaded dashboard shows a small dismissible strip with Retry instead of replacing the whole page with an error screen.

## 1.14.13 — 2026-10-19

- Numbers that are not finite in a bankroll report (for example 1e999) no longer draw NaN charts or print "Infinity"; a count below one tournament counts as no data.
- A bust state (BR 0) no longer prints a stray "0" at the top of the page.
- The trusted-total tie case now settles by the reported session counts instead of always preferring the later report.

## 1.14.12 — 2026-10-19

- Jumps inside the page (day rows, the "N new posts" bubble, pagination) now land below the pinned header on desktop and phones instead of hiding the top of the target post.
- On phones held sideways only the top bar stays pinned; the progress bar scrolls away so the header no longer takes more than a third of the screen.

## 1.14.11 — 2026-10-19

- Light theme: ratings, likes and the chart pills now reach readable contrast; the period pills, filter pill, hero badge and the active page / mobile menu buttons use a deeper red that carries white text; resting feed actions, the hourly-rate hint and the empty pace card are readable.
- The dark theme is unchanged (checked pixel by pixel at four widths).

## 1.14.10 — 2026-10-19

- Monthly distances no longer inflate when one cumulative total is too low (same trusted-run rule the pace widgets use); real-data months are identical.
- The pace split can no longer freeze the page on an absurd per-session count; a malformed (non-object) bankroll-history row no longer crashes the app.
- The English projection unit reads "MTT" for exactly one tournament; the monthly chart cannot throw on a bad language tag; a zero bankroll no longer shows a stale number next to a different profit.

## 1.14.9 — 2026-10-19

- One definition of "MTT per session" everywhere (sidebar, mobile strip, week/month stats, session chart): sessions with a counted tournament total. The all-time figure moves from 215 to 219.
- Pace widget: a week or month with no reports shows an empty card instead of disappearing; rates read "$/MTT" in English and Spanish; Russian projection unit declines correctly; the trend note says "completed steps only"; the tail step never repeats the previous step's label; the tempo counter no longer jumps back mid-animation.
- Monthly chart keeps the selected month through background refreshes and shows an accurate message for empty windows.
- Footer dates are zero-padded; Spanish dates read "7 de abril".
- One bad cumulative total or a report without a bankroll no longer distorts the pace numbers or the hero.

## 1.14.8 — 2026-10-19

- Money is formatted correctly at any size: exact amounts group every thousand (1 234 567$), compact labels switch to millions ($1.23M, never "1000.0k"), including chart axes, the peak badge and milestone labels.
- The monthly chart's Y axis sizes its gutter to the longest label.
- Month labels and date tags get a short year once the shown range crosses a calendar year (MAR 26 ... MAR 27), so months no longer repeat ambiguously.

## 1.14.7 — 2026-10-19

- Tooltips and labels stay inside the screen and their cards: the phone long-press tooltip no longer loses its date header, the "tournaments per session" tooltip no longer sticks out of the card, and the activity and top-posts popups are placed again once their images load.
- The PEAK badge never covers a milestone plate, and the pace chart's value labels no longer collide with the axis labels.

## 1.14.6 — 2026-10-19

- On phones the top bar and progress bar stay pinned while you scroll again; the "N new posts" bubble sits just below them.
- Tablets and narrow windows (721-980 px) get the stat strip and the top-liked posts list instead of losing them.
- Light theme: key numbers, rates and chart tooltips reach readable contrast, hidden chart dots stay hidden, the active page button and the top-posts period pill keep their red fill.
- The image viewer stays inside the screen on very wide displays and opens above hover popups.

## 1.14.5 — 2026-10-19

- Ignored authors are hidden everywhere the same way: feed, chart hover tooltip, expanded day lists and top-author picks; matching ignores case and surrounding spaces.
- Rows in the expanded day list on desktop now open the post (switching feed page); a post hidden by your filters opens on the forum instead of doing nothing.

## 1.14.4 — 2026-10-19

- Feed: a search or filter that leaves 21-40 results opens page 1 (it used to jump to page 2); starring or ignoring a post keeps your page.
- Auto-refresh no longer drags you back to the saved reading position; the position is restored once, on load.
- Switching language from a deep page lands on a valid page instead of an empty feed.
- The "N new posts" bubble counts only posts your current filters actually show, and hides when there are none.

## 1.14.3 — 2026-10-19

- The page no longer goes blank when the browser blocks site data or a saved setting is corrupt; a friendly error screen with Reload and Reset-settings buttons catches any other crash.
- Favourites, ignore list and filters no longer get overwritten by an older open tab; changes made in one tab now reach the others.
- Loading is bounded: a stalled download times out, a fresher source is no longer cut off after 1.4 s (waits up to 8 s), and a hung mirror no longer delays every returning visit.
- The footer's "scraper ran" time follows scraper heartbeat commits; a cache stamped by a clock that was ahead (or holding invalid data) is ignored.
- "Retry" on the error screen shows the loader instead of an empty dashboard; Google Fonts no longer block the first paint.

## 1.14.2 — 2026-10-19

- Scraper: only the exact `Romeopro` account counts as the marathon author; look-alike nicks can no longer set the day, bankroll or BR history.
- "Day N" is read only from the start of the author's own post (quotes ignored).
- A bankroll session is no longer dropped after API outages: 429/5xx/network errors do not use up the retry budget, and giving up now flags the post and turns the run red.
- `reextract` aborts before wiping anything when the API key is missing and writes nothing if extraction fails; model output is validated before it reaches the history.
- Edited forum posts now update the stored text; a full scan removes posts deleted on the forum (capped at 50 or 1%, never Romeo's own); a page that parses to zero posts fails the run instead of stamping a fresh heartbeat.
- Embedded videos are limited to https players from an allow-list, checked by both scraper and page.

## 1.14.1 — 2026-10-19

- The deploy ignore step now builds when the last deployed commit is unknown and counts deleted or renamed files, so a code change can no longer be skipped as "data only".
- `robots.txt` has real line breaks (it contained a literal `\n`).
- The scraper workflow passes the optional alert secrets through; nothing changes until they are set.
- New tests pin Warsaw time conversion across the 2026-10-25 DST change, the footer "today" logic and the Y-axis gutter width.

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
