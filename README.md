# What Should We Watch Tonight?

A multiplayer movie-night party game. One person hosts, friends join free on their own phones with a 4-letter code, everyone takes a quick mood check, nominates titles with a swipe deck, and votes in a secret-ballot bracket until one title wins.

## Two editions

- **Everything streaming (default).** Every popular movie and series streaming in the US. The host ticks the services the room has (Netflix, Prime Video, Disney+, Max, Hulu, Apple TV+, Peacock, Paramount+, Angel Studios, free-with-ads apps) and can allow rentals, so the game only pitches titles you can press play on. The winner screen shows where it streams.
- **Angel Studios edition.** The original Angel Guild game: Angel's lineup, Guild-member hosting and Angel branding. Pick it on the host setup screen, or open the page with `?edition=angel` to start in it.

A studio edition is a skin (colors, copy, links) plus a catalog, set in `EDITIONS` in `index.html`, so another studio could slot in the same way.

This repo starts from the working prototype first built as a claude.ai artifact (October 2026).

## Run it

It is one self-contained file. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Outside claude.ai the game runs in **Solo test mode**: everything works on one device, and the host can add "test friends" (bots) to play a full round. Live multiplayer sync and the uploaded poster art come from the claude.ai artifact platform, so they are not available yet when the file runs on its own. Titles without art show a styled title card instead.

## How it is built

- One HTML file, vanilla JavaScript, no build step.
- Fonts: Big Shoulders Display, Figtree, JetBrains Mono (Google Fonts).
- State lives in a Firestore-style store at `S.db` (`doc`, `collection`, `get`, `set`, `update`, `onSnapshot`). On claude.ai it is the artifact's shared database; elsewhere it falls back to the in-memory store in `makeLocalDB()`. Moving to a real backend (Firebase or similar) means swapping `S.db`.
- The host's device is the authority: it advances stages, builds the bracket, resolves matches, and drives the test bots.

See [docs/CONTEXT.md](docs/CONTEXT.md) for the game flow, data model, scoring, and the list of known limits and next ideas.

## Daily lineup refresh

Every morning a GitHub Action (`.github/workflows/sync-lineup.yml`) refreshes both lineups from [TMDB](https://www.themoviedb.org/):

- `data/universal.json` (`scripts/sync-universal.mjs`): up to 900 of the most popular and best-loved movies and series on each US service, plus family picks and all-time favorites, with the services each one streams on and whether it can be rented. Where-to-watch data is JustWatch's, through TMDB.
- `data/catalog.json` (`scripts/sync-catalog.mjs`): Angel Studios titles for the Angel edition.

Opened straight from disk, the universal edition plays with a built-in starter lineup of 48 well-loved titles. When the game is served over the web it loads `data/universal.json` instead. For the Angel edition:

- Hand-curated titles keep their mood tags and gain TMDB posters, keywords and any missing details.
- New Angel titles join the swipe deck, with mood tags, intensity and age fit inferred from TMDB genres, keywords and US ratings.

**Setup (one time):**
1. Create a free TMDB account and request an API key at https://www.themoviedb.org/settings/api.
2. Copy the **API Read Access Token** (the long one).
3. In this repo, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `TMDB_TOKEN`, and paste the token.
4. Go to **Actions → Refresh lineups → Run workflow** to run it once now. After that it runs daily.

Until the secret exists, the job exits quietly without changing anything. Test both syncs locally against a fake TMDB with `node scripts/test-sync.mjs` and `node scripts/test-universal.mjs`.

This product uses the TMDB API but is not endorsed or certified by TMDB. Where-to-watch data is provided by JustWatch and must be credited wherever it is shown (the game does this on the winner screen and the home screen). TMDB's API is free for non-commercial use; a commercial launch needs a TMDB commercial agreement, and JustWatch asks commercial users of its data to partner with it directly.
