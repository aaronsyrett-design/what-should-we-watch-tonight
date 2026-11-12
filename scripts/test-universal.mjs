#!/usr/bin/env node
/* Runs the streaming lineup sync against a fake TMDB server and checks the output. `node scripts/test-universal.mjs` */
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const run = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kw = (...names) => ({ keywords: names.map((name, id) => ({ id, name })) });
const us = (o) => ({ 'watch/providers': { results: { US: o } } });
const rated = c => ({ release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: c }] }] } });
const MOVIES = {
  1: { id: 1, title: 'Space Heist', release_date: '2021-05-01', runtime: 118, popularity: 300, vote_average: 7.4, poster_path: '/heist.jpg',
    genres: [{ id: 878 }, { id: 28 }], overview: 'A crew robs a space station.', keywords: kw('heist'), credits: { cast: [{ name: 'Pedro Pascal' }] },
    ...rated('PG-13'), ...us({ flatrate: [{ provider_id: 8 }, { provider_id: 1899 }], rent: [{ provider_id: 2 }] }) },
  2: { id: 2, title: 'The Creaking', release_date: '2019-10-01', runtime: 95, popularity: 120, vote_average: 6.8,
    genres: [{ id: 27 }], overview: 'Something lives in the attic.', keywords: kw('haunted house'), credits: { cast: [] },
    ...rated('R'), ...us({ ads: [{ provider_id: 73 }] }) },
  3: { id: 3, title: 'Rent Only Romance', release_date: '2018-02-14', runtime: 104, popularity: 80, vote_average: 6.1,
    genres: [{ id: 10749 }, { id: 35 }], overview: 'Two rivals fall for each other.', keywords: kw(), credits: { cast: [] },
    ...rated('PG-13'), ...us({ rent: [{ provider_id: 2 }], buy: [{ provider_id: 2 }] }) },
  4: { id: 4, title: 'Nowhere Film', release_date: '2017-01-01', runtime: 90, popularity: 500, genres: [{ id: 18 }], keywords: kw(), credits: { cast: [] },
    ...rated(''), 'watch/providers': { results: { GB: { flatrate: [{ provider_id: 8 }] } } } },
  5: { id: 5, title: 'Coming Soon', release_date: '2099-01-01', runtime: 90, popularity: 900, genres: [{ id: 18 }], keywords: kw(), credits: { cast: [] },
    ...rated(''), ...us({ flatrate: [{ provider_id: 8 }] }) },
  6: { id: 6, title: 'Pup Squad', release_date: '2022-07-01', runtime: 88, popularity: 150, vote_average: 7.0, genres: [{ id: 16 }, { id: 10751 }],
    overview: 'Puppies save the town.', keywords: kw(), credits: { cast: [] }, ...rated('G'),
    ...us({ flatrate: [{ provider_id: 337 }, { provider_id: 9999 }] }) }
};
const SHOWS = {
  50: { id: 50, name: 'Office Party', first_air_date: '2010-01-01', episode_run_time: [22], popularity: 200, vote_average: 8.1,
    genres: [{ id: 35 }], overview: 'Coworkers, chaos.', keywords: { results: [] }, aggregate_credits: { cast: [] },
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] }, ...us({ flatrate: [{ provider_id: 2303 }, { provider_id: 386 }] }) }
};
const PROVIDERS = [
  { provider_id: 8, provider_name: 'Netflix', logo_path: '/nflx.png' },
  { provider_id: 1899, provider_name: 'Max', logo_path: '/max.png' },
  { provider_id: 337, provider_name: 'Disney Plus', logo_path: '/dis.png' },
  { provider_id: 73, provider_name: 'Tubi TV', logo_path: '/tubi.png' },
  { provider_id: 2303, provider_name: 'Paramount Plus Premium', logo_path: '/pp2.png' },
  { provider_id: 386, provider_name: 'Peacock Premium', logo_path: '/pea.png' },
  { provider_id: 4242, provider_name: 'Angel Studios', logo_path: '/angel.png' },
  { provider_id: 2, provider_name: 'Apple TV', logo_path: '/apple-store.png' }
];
let sawRegion = true, sawProviderFilter = false;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const p = u.pathname;
  if (p.startsWith('/watch/providers/')) return send({ results: PROVIDERS });
  if (p.startsWith('/discover/')) {
    if (u.searchParams.get('watch_region') !== 'US') sawRegion = false;
    const wp = (u.searchParams.get('with_watch_providers') || '').split('|');
    if (wp.includes('4242')) sawProviderFilter = true; // Angel Studios found by name
    const pool = p === '/discover/movie' ? MOVIES : SHOWS;
    return send({ results: Object.values(pool).map(x => ({ id: x.id, popularity: x.popularity })), total_pages: 1 });
  }
  let m = p.match(/^\/movie\/(\d+)$/); if (m && MOVIES[m[1]]) return send(MOVIES[m[1]]);
  m = p.match(/^\/tv\/(\d+)$/); if (m && SHOWS[m[1]]) return send(SHOWS[m[1]]);
  send({ status_message: 'not found' }, 404);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const out = join(mkdtempSync(join(tmpdir(), 'uni-')), 'universal.json');
const env = { ...process.env, TMDB_TOKEN: 'test-token', TMDB_BASE: `http://127.0.0.1:${server.address().port}`, OUT_UNIVERSAL: out };
const log1 = (await run(process.execPath, [join(ROOT, 'scripts/sync-universal.mjs')], { env, timeout: 60000 })).stdout;
const log2 = (await run(process.execPath, [join(ROOT, 'scripts/sync-universal.mjs')], { env, timeout: 60000 })).stdout;
server.close();

const doc = JSON.parse(readFileSync(out, 'utf8'));
const by = Object.fromEntries(doc.titles.map(t => [t.id, t]));
assert.ok(sawRegion, 'every discover call is scoped to the US');
assert.ok(sawProviderFilter, 'services found by name (Angel Studios) are searched too');
assert.match(doc.notice, /not endorsed or certified by TMDB/);
assert.match(doc.notice, /JustWatch/);
assert.equal(doc.services.find(s => s.key === 'netflix').logo, 'https://image.tmdb.org/t/p/w92/nflx.png');
assert.equal(doc.services.find(s => s.key === 'angel').logo, 'https://image.tmdb.org/t/p/w92/angel.png');
// where it streams
assert.deepEqual(by['movie-1'].on, ['netflix', 'max']);
assert.equal(by['movie-1'].rent, true);
assert.equal(by['movie-1'].tmdb, 'movie/1');
assert.equal(by['movie-1'].poster, 'https://image.tmdb.org/t/p/w500/heist.jpg');
assert.ok(by['movie-1'].g.includes('scifi') && by['movie-1'].g.includes('thriller'));
assert.ok(!('keywords' in by['movie-1']), 'keywords are left out to keep the file small');
assert.deepEqual(by['movie-2'].on, ['free'], 'ad-supported Tubi counts as free');
assert.equal(by['movie-2'].tags[0], 'scare', 'horror reads as a scare');
assert.ok(by['movie-2'].g.includes('horror'));
assert.equal(by['movie-2'].age, 'adult');
assert.deepEqual(by['movie-3'].on, [], 'rent-only titles have no services');
assert.equal(by['movie-3'].rent, true);
assert.ok(by['movie-3'].g.includes('romance'));
assert.deepEqual(by['movie-6'].on, ['disney'], 'unknown providers are ignored');
assert.equal(by['movie-6'].age, 'all');
assert.deepEqual(by['tv-50'].on, ['peacock', 'paramount']);
assert.equal(by['tv-50'].k, 'Series');
assert.ok(!by['movie-4'], 'not watchable in the US: skipped');
assert.ok(!by['movie-5'], 'unreleased: skipped');
assert.equal(doc.titles[0].id, 'movie-1', 'most popular first');
assert.match(log2, /No changes\./);
console.log(log1.trim());
console.log('streaming lineup test passed');
