# Project context

## What it is
A multiplayer group movie-picking party game for Angel Studios Guild members, built as a vibe-coded prototype (Aaron Syrett, October 2026). A Guild member hosts; friends join free on their own phones with a 4-letter code, take a mood check, nominate Angel titles, and vote in a secret-ballot bracket until one title wins.

Business thesis: hosting is the Guild "superpower". Guests play the full game free and join the Guild to host the next one (a Tupperware-party growth loop). Fun first, never a sales demo.

## Current build
- One self-contained HTML file (`index.html`), vanilla JS, no framework.
- Fonts: Big Shoulders Display (display), Figtree (body), JetBrains Mono (numbers).
- Palette: dark purple night `#15112A`, gold `#FFC145`, coral `#FF6F59`, mint `#5CE1B0`.
- Multiplayer sync uses the claude.ai artifact `db` capability (Firestore-like). Falls back to an in-memory store ("Solo test mode") when sync is unavailable.
- The host's client is the authority: it advances stages, builds the bracket, resolves matches, and drives "test friend" bots.

## Data model
- `games/{CODE}`: host, hostName, hostGuild, expected (player count), audience (`little|kids|teens|adults`), party `{occasion, honoree, when}` or null, stage (`lobby → mood → nominate → bracket → winner`), entries `{id: {id,t,y,k,age,by[],custom?,wild?}}`, rounds `[[ids], ...]`, cur `{r,m}`, pending, lastResult `{key,winner,tally,tie}`, winner.
- `games/{CODE}/players/{id}`: name, bot?, joinedAt, done `{mood,nominate}`, answers `{vibe,want,len,actor,snack,drink,playlist,genres[]}`, noms `[ids]`, customs `[{id,t}]` (write-ins), votes `{"r0m1": entryId}`.
- `art/titles`, `art/people`: maps of title id or person slug to an uploaded image asset id (`/_blob/<id>`). Admin-write only. 47 of 48 titles have poster art (Dry Bar Comedy missing). No actor photos yet (initials fallback).
- `data/users/{uid}/contact`: optional guest email plus separate marketing consent (saved, not sent).

## Game flow
1. **Host setup:** name, number watching, "Who's in the room?" age filter (all ages / 8+ / 13+ / adults), optional Movie Party (occasion, honoree, when, with a copyable invite and WhatsApp share), Guild-member switch (stand-in for real Guild sign-in; required to host).
2. **Lobby:** code tiles, player chips, gold "Guild host" tag, add test friends, start.
3. **Mood check (8 questions):** energy/vibe, what the movie should do, time, hangout actor (Kevin James, Owen Wilson, Alan Ritchson, Tony Hale, Neal McDonough, Zachary Levi, Woody Harrelson, Ben Kingsley), snack, drink (alcohol-free), road-trip playlist, genres (up to 3). Each answer maps to mood tags. A personal "read" is shown after.
4. **Nominate:** swipe deck (right = nominate, left = pass, plus ✓/✕ buttons and arrow keys), poster art, cast chips, match %, a plain "why" line; up to 3 picks including write-ins.
5. **Bracket:** 4 or 8 slots ranked by (nominators × 4 + group mood score + write-in bonus), filled with age-safe wildcards; secret ballot; ties break by group mood fit; 2.2s reveal per match; the bracket grid scrolls horizontally.
6. **Winner:** confetti, title, standings, badges and share kit, snack and drink recipe pairing (scaled to room size, copyable shopping list), optional email card, "host your own" call to action for guests.

## Scoring
Catalog entries: `{id, age, guild?, t, k, y, g[genres], tags[primary-first], i (intensity 1–5), len (short|movie|epic), cast[], b (blurb), unverified?}`.

Score = genre match (2.5 each, max 2) + want tag (4 × weight; primary tag weight 1, others 0.6) + vibe tags (1.2×) + intensity fit (each vibe has a comfortable range; −1.8 per step outside, +1 inside; extra −2 for heavy titles when wanting a laugh) + length fit + actor (+3 if in cast, + 0.8 × actor's tags) + snack/drink/playlist tags (0.6×). `matchPct = score / max possible`.

### Room fit (group picks)
Each person's fit for a title is where it lands in their own ranking of the lineup (1 = their top pick, 0 = their last), so nobody counts more for answering more questions. Room score = 0.55 × average fit + 0.45 × lowest fit − 0.06 per person for whom the title is a dealbreaker (bottom fifth of their list). This "least misery" blend favors titles that work for everyone over ones half the room loves and half dreads.

Room fit drives the bracket seeding (nominations × 4 + 12 × room score − 3 per dealbreaker + write-in bonus), the wildcards, tiebreaks, the "best bet for everyone" line in the room read, the swipe deck order once others have answered (65% personal, 35% room), the "Room favorite" / "Works for everyone" / "Risky" labels, the room fit % on bracket cards, and the "Why it works for this room" panel on the winner screen. Explanations count people and never name them, so ballots stay secret.

In 200 simulated 5-person rooms with random answers, the top room pick keeps the same average happiness as the old sum-of-scores pick (0.80) while lifting the least-happy person from 0.47 to 0.59, and the share of nights where someone gets a bottom-fifth movie drops from about 1 in 10 to 0.

## Standings and badges
Points: +3 per matchup your nominee wins, +5 if it wins the night, +1 per correct call.

Badges: Movie Mogul, Tastemaker, Perfect Read, The Oracle, Write-in Legend, Rebel With a Remote, Box Office Contender, Good Sport (everyone gets at least one). The badge image is drawn on canvas (1080×1350) with Save/Copy image, caption copy, and one-tap share links (X, Facebook, Threads, Bluesky, LinkedIn, WhatsApp, Reddit). Instagram/TikTok = save image + copy caption. Letterboxd = open film search + copy review. Share URL placeholder: `https://www.angel.com/guild` (swap for a tracked link).

## Catalog
48 Angel titles (The Chosen removed: no longer in the library), including Sound of Freedom, Cabrini, Bonhoeffer, The King of Kings, David, Sketch, Solo Mio, Animal Farm, Young Washington, Runner, The Wayfinders, Testament, Guarded, and 8 stand-up specials. Age fits are hand-set guides, **not** official ratings. Young Warriors and 2nd Greatest have no verified details.

## Known limits and next ideas
- No real accounts, Guild auth, live catalog, official ratings, or deep links into playback.
- Votes are hidden in the UI but readable in the shared db (not sealed).
- Ideas queued: quick-round mode with a vote timer, TV mode (big screen + phone controllers), season standings and streaks, a "did the pick land?" next-morning check, tracked share links, a theatrical "what are we seeing" mode, Angel brand styling.
- Past bug to avoid: a `.round` CSS class collided between the swipe buttons and the bracket columns.
