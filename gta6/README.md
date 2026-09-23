# Leonida Files — personal GTA VI encyclopedia

Unofficial, personal fan site. Static React app hosted on GitHub Pages at **https://amast126.github.io/gta6/** with a GitHub Actions job that rebuilds `news.json` every ~30 minutes. Not affiliated with Rockstar Games or Take-Two.

## What's in the repo

| Path | What it is |
|---|---|
| `index.html` | Shell page. Holds the cache-buster (`app.js?v=N`) — bump it on every deploy. |
| `app.js` | The built app (React, bundled by esbuild from `src/`). Don't edit by hand. |
| `src/app.jsx`, `src/data.js`, `src/styles.css` | App source. `./build.sh` rebuilds `app.js`. |
| `content/*.json` | **The encyclopedia.** One file per section, plus `sections.json` (section list) and `sources.json` (reusable sources). |
| `news.json` | Live feed, written by the Action. Keep the seeded one in the first upload. |
| `.github/workflows/news.yml` | The scheduled news job. |
| `.github/news-state.json` | Remembers the Newswire GraphQL query URL between runs (fast path, no browser needed). |
| `scripts/fetch-news.mjs` | Fetches Newswire (Playwright fallback), YouTube RSS, Google News RSS, r/GTA6; writes `news.json`; pushes to ntfy. |
| `scripts/check-content.mjs` | Validates content JSON (ids, links, sources). Runs as part of `./build.sh`. |
| `scripts/screenshot.mjs` | Headless-browser walkthrough at phone width; fails on console errors. |
| `scripts/test-fetch-news.mjs` | Offline tests for the news script with fixture feeds. |
| `manifest.webmanifest`, `icon-*.png`, `icon.svg` | Home-screen app metadata and the (original) icon. |

## One-time setup (you do these; no tokens needed by Claude)

1. **Create the repo** `amast126/gta6` (public) and upload the zip contents at
   https://github.com/amast126/gta6/upload/main — upload everything including the `.github` folder
   (if the web uploader drops dotfolders, add `.github/workflows/news.yml` and `.github/news-state.json` with "Add file → Create new file" and paste them in).
2. **Turn on Pages:** Settings → Pages → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
3. **Let the Action commit:** Settings → Actions → General → *Workflow permissions* → **Read and write permissions** → Save.
4. **Push alerts (optional but recommended):**
   - Install the **ntfy** app (iOS/Android) and subscribe to a topic. Use a long random name, e.g. `gta6-leonida-<random 16+ chars>` — topics are public, so the name is the only secret.
   - Settings → Secrets and variables → Actions → **New repository secret** → Name `NTFY_TOPIC`, Value = the topic name.
   - Without the secret the job still runs; it just doesn't push.
5. **First run:** Actions tab → *Update news feed* → *Run workflow*. It runs on its own every 30 minutes after that.
6. **Phone:** open the site in Safari/Chrome → Share → *Add to Home Screen*.

## Deploy routine (every time the app or content changes)

1. Claude builds and sends a zip; you upload it at `https://github.com/amast126/gta6/upload/main` (overwriting).
2. Claude verifies the upload landed (file sizes on `raw.githubusercontent.com`).
3. Claude bumps the cache-buster in `index.html` (`app.js?v=N` → `v=N+1` and `__BUILD`) in the GitHub web editor and commits. **Required**, or phones keep the old bundle.
4. Wait 1–3 minutes for Pages, then load the live site and confirm `build vN` on the Settings page.

Content-only changes (`content/*.json`) don't strictly need the bump — the app fetches them with `cache: 'no-cache'` — but bumping never hurts.

## Adding entries

Add an object to the right `content/<section>.json`:

```json
{
  "id": "unique-kebab-id",
  "name": "Display name",
  "subtitle": "One-line role/date",
  "tags": ["free", "form"],
  "spoiler": false,
  "video": "YouTubeVideoId (optional)",
  "date": "2026-11-19 (optional, used to sort videos)",
  "summary": "Two or three sentences in your own words.",
  "facts": [
    { "text": "One fact.", "status": "official", "src": "rsg-vi-site" },
    { "text": "Another, from press.", "status": "reported", "src": "gamesradar-guide", "spoiler": true },
    { "text": "Inline source instead of a key.", "status": "rumor", "source": { "label": "Who said it", "url": "https://…", "date": "2026-10-01" } }
  ],
  "links": ["other-entry-ids"]
}
```

- `status` is `official` (Rockstar/Take-Two), `reported` (press) or `rumor` (leaks, insiders).
- `src` keys live in `content/sources.json`; add new sources there.
- `links` are entry ids from any section; backlinks are computed automatically.
- Timeline items (`content/timeline.json`) are `{ "date", "title", "text", "status", "src", "links" }`.
- New section: add a file and a line in `content/sections.json`.
- `node scripts/check-content.mjs` catches typos in ids, links and source keys.

## Local build / test

```bash
npm install
./build.sh                              # validates content, bundles app.js
node scripts/screenshot.mjs shots/      # phone-width walkthrough + screenshots, fails on console errors
node scripts/test-fetch-news.mjs        # offline tests for the news job
node scripts/fetch-news.mjs             # real run (needs network; uses Playwright only if the fast path fails)
```

## How the news job works

- **Rockstar Newswire** has no public feed. The page loads posts from `graph.rockstargames.com` using a persisted-query hash. The job reuses the last known query URL (`.github/news-state.json`) with a plain fetch; if Rockstar rotates the hash it opens the Newswire in headless Chromium, captures the new GraphQL response, and saves the new URL. Only posts whose title/tags/URL mention GTA VI are kept.
- **YouTube:** `https://www.youtube.com/feeds/videos.xml?channel_id=UC6VcWc1rAoWdBCM0JxrRQ3A` (Rockstar Games), GTA VI titles only. New videos push via ntfy and show up on the home page as the newest video.
- **Google News RSS** search for "GTA 6" / "Grand Theft Auto VI" → the *Press* tab.
- **r/GTA6** RSS is attempted; Reddit often blocks GitHub's IPs, in which case it's marked unavailable and hidden.
- Each source keeps its previous items if a fetch fails; `news.json` is only rewritten when items change (or every 12 h), so the repo isn't committed to every half hour.
