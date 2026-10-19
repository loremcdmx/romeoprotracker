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

`npm run dev` and `npm run build` automatically copy `data/*.json` into `public/data` so local builds work without hitting GitHub raw URLs.

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

The client compares freshness (`max(meta.lastUpdated, meta.postsChangedAt)`) across successful sources and keeps the freshest payload instead of trusting the first response. That avoids stale Vercel assets when code deploys and scraper commits move at different cadences.

How that works in `src/storage.js`:

- **Cold load / changed data.** Every source downloads `meta.json` and `posts.min.json` in parallel. The first complete source starts a settle window (1.4 s) for the others; slower sources are then aborted so a stalled host cannot hold the page up. The exception is a source whose already-downloaded `meta.json` is newer than the winner's: it is awaited past the settle window, up to an overall cap of 8 s from the start of the load. A slower but fresher source therefore wins over a stale first responder instead of being aborted on every poll; if it never delivers, the winner is used when the cap runs out. When two sources have the same content freshness, the one with the newer `meta.lastScrapeRun` wins instead of the first to answer, so a stale same-origin snapshot cannot hide the scraper's latest run time from the footer.
- **Warm revalidation.** A cache older than 60 s (`CACHE_TTL`) is revalidated by probing only `meta.json`. The probe does not wait for the slowest source: it stops as soon as one answer shows newer data than the cache, or one settle window after the first answer. A cache whose timestamp lies in the future (more than 5 s ahead, i.e. written by a clock that was wrong) counts as stale.
- **Timeouts.** Each request has 6.5 s to start answering. The timer stays armed while the body is read: `meta.json` has another 6.5 s after the headers, the multi-MB posts payload 30 s, so a connection that stalls mid-download fails the attempt instead of hanging every later poll and Retry.
- **Heartbeat-only scraper commits** change just `meta.lastScrapeRun`. They do not count as newer data (the posts are not downloaded again), but the probe carries the newest `lastScrapeRun` into the cached meta in memory so the footer's "scraper ran" time and dot stay current.

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

### Recovering from a given-up BR session

Every Romeo post with screenshots is read by Claude vision. The answer is only written to `meta.brHistory` / `meta.bankroll` after `validateBrExtraction` (`scripts/lib/br-extraction.mjs`) accepts it. Per-post state lives in `data/posts.json`:

| field | meaning |
| --- | --- |
| `brAttempts` | Number of *unusable* answers so far: not JSON, rejected by the validator, or a 400/413 about the images themselves. API trouble (5xx, 429, 401/402/403, low credit, network error, missing key) never counts. |
| `brChecked` | `true` = stop retrying this post. Also set when the model says a screenshot has no BR data (normal, not an error). |
| `brGaveUp` | ISO time. Set together with `brChecked` when `brAttempts` reaches 6. The session is **not** in `brHistory`, so the bankroll and chart skip it. |

Giving up is loud and happens once per post: `::error::BR extraction gave up on post <id>` in the run log, the optional failure webhook fires, and that run ends red (later runs are green again because `brChecked` stays set). List the affected posts:

```bash
node -e "const p=require('./data/posts.json');console.log(p.filter(x=>x.brGaveUp).map(x=>[x.id,x.brGaveUp,x.url].join(' ')).join('\n'))"
```

The reason is in the run log right before the `::error::` line (`Claude API answer rejected: ...` or `Claude API parse error`).

**The answer was unreadable or wrong** (not JSON, a misread digit, a bad screenshot): delete `brChecked`, `brGaveUp` and `brAttempts` from that post in `data/posts.json`. The next run reads it again with a fresh budget of 6.

**The answer was right but outside the plausibility limits.** The validator rejects:

- a session ratio `brAfter / brBefore` outside **0.2 .. 5** (`implausible session swing`);
- a chain ratio `brBefore / previous session's brAfter` outside **0.5 .. 2** (`does not follow the previous session's brAfter`), where "previous" is the chronologically previous entry of `brHistory`;
- any bankroll that is not positive or is above **1e8**, room values below 0 or above 1e8, session counts above 10 000, total tournaments above 1 000 000;
- `totalTournaments` below the previous entry's or above the next entry's.

The limits are wide on purpose (live data: session ratios 0.55..1.95), so a real swing beyond them is rare, but it happens. Deleting the flags does **not** help then: the same answer is rejected again and, after 6 more attempts, the run goes red again. `reextract` does not help either, it uses the same validator and aborts at that post. The fix is a manual `brHistory` edit. Do it for the *earliest* given-up post first: later sessions are checked against the last *accepted* entry, so one rejected swing makes every session after it fail the chain check and get given up in turn.

1. `git pull --rebase origin main` (the scraper commits every few minutes, so keep the time between pull and push short).
2. Open the post (its `url` is in `data/posts.json`) and read the numbers from the screenshot: bankroll before/after, per room, tournaments in the session, total tournaments.
3. In `data/meta.json` add an object to `brHistory` (order does not matter, the scraper sorts by `timestamp`):

   ```json
   {
     "id": "8314162",
     "date": "19 октября, 05:12",
     "timestamp": 1792379549,
     "brBefore": 436927,
     "brAfter": 448853,
     "sessionResult": 11926,
     "rooms": {
       "before": { "gg": 435490, "ps": 1188, "king": 232, "coin": 17, "lux": 0 },
       "after": { "gg": 447416, "ps": 1188, "king": 232, "coin": 17, "lux": 0 }
     },
     "url": "https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p=8314162",
     "tournaments": 156,
     "totalTournaments": 40665
   }
   ```

   `id` is the post id as a string; `timestamp` (unix seconds), `date` and `url` are copied from the post; `sessionResult` is `brAfter - brBefore` (recomputed on the next run anyway); `rooms` has all five keys `gg, ps, king, coin, lux` (0 for a room that is not shown); `tournaments` is a number or `null`; keep `totalTournaments` non-decreasing across entries (the validator relies on it and the data-integrity smoke fails on a decrease).
4. In `data/meta.json` make the headline agree with the history: set `bankroll` to the `brAfter` of the chronologically **last** entry of `brHistory` and `totalTournaments` to that last entry's `totalTournaments` (if it has none, leave `totalTournaments` as it is). These are the two values the integrity smoke (step 7) compares with the history; if you do not touch them it fails with `meta.bankroll X does not match last brAfter Y` and `meta.totalTournaments X does not match last BR total Y`. An entry you added in the middle of the history changes neither value. `meta.day` needs no edit (it comes from the latest `Day N` label among the posts, which the scraper has already read); if the smoke does complain about it, set it to the number it prints. The next scraper run would set all three from the history and the posts on its own; this step only keeps the commit you push consistent.
5. In `data/posts.json` delete `brGaveUp` and `brAttempts` on that post (`brChecked` may stay: a post that is in `brHistory` is never retried). Do not hand-edit the post's `brBefore` / `brAfter` / `sessionResult`: the next run sorts the history, recomputes `sessionResult` and copies the three onto the post; that lands with the next 30-minute heartbeat commit at the latest.
6. For every *later* given-up post delete `brChecked`, `brGaveUp` and `brAttempts` as in the first case, so it is read again, now against the new entry. If one of them is itself outside the limits, repeat from step 2 for it.
7. `node scripts/data-integrity-smoke.mjs` must pass (it is part of `npm run check`). Commit `data/meta.json` and `data/posts.json` and push to `main`.

**Re-running `reextract` safely.** `npm run scrape:reextract` rebuilds the whole history from the screenshots of *every* Romeo post (about 190 paid vision calls), replaces `brHistory` and resets `brChecked` / `brAttempts` / `brGaveUp` on all posts (posts whose screenshots hold no BR data are marked checked again). It writes nothing unless every post resolved; the first API error, unreadable answer or validator rejection aborts the run with the data untouched. It also throws away manual `brHistory` entries, which only come back if the model's answers pass the validator. So:

- do not start it from the Actions tab for this: that run commits and pushes straight to `main`;
- run it locally on a freshly pulled, clean tree, without pushing: `git pull --rebase origin main && ANTHROPIC_API_KEY=... npm run scrape:reextract -- --no-push` (`--no-push` writes `data/*` locally and skips git pull / commit / push; `--dry-run` makes the same API calls but writes nothing, handy to see whether it would abort);
- review before publishing: `git diff --stat data/`, the `brHistory` entry count (the log warns when it shrinks) and `node scripts/data-integrity-smoke.mjs`; then commit and push by hand. To throw the result away: `git checkout -- data/`.

**API-level failures need no recovery.** A dead key, no access or no credit (HTTP 401, 402, 403, or a 400 that talks about the credit balance / API key) is not the post's fault: no attempt is spent and nothing is given up. The run stays green, the data is untouched and the posts simply stay queued. To make this visible the run emits a single `::warning::BR extraction is blocked at the API level ...` annotation (once per run, in the run summary). Fix the key or the credit and the next run catches up by itself. A missing `ANTHROPIC_API_KEY` stays a plain log line, because forks legitimately run without one.

## Data Files

- `data/posts.json` — full post payload
- `data/posts.min.json` — compact payload used by the client
- `data/meta.json` — bankroll summary, scraper metadata, bankroll history

## Fork / Deploy Notes

1. Fork the repo.
2. Connect it to Vercel.
3. Add `ANTHROPIC_API_KEY` if you want screenshot extraction and translations.
4. Keep scraper automation on `main`; do feature work on separate branches.

There is no application backend in this repo. The deployed app is static and reads JSON data produced by the scraper.
