#!/usr/bin/env node
/* Runs the lineup sync against a fake TMDB server and checks the output. `node scripts/test-sync.mjs` */
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kw = (...names) => ({ keywords: names.map((name, id) => ({ id, name })) });
const MOVIES = {
  101: { id: 101, title: 'Sound of Freedom', release_date: '2023-07-04', runtime: 131, poster_path: '/sof.jpg',
    genres: [{ id: 53 }, { id: 18 }], overview: 'A federal agent embarks on a mission to rescue children from traffickers.',
    keywords: kw('human trafficking', 'based on true story', 'rescue mission'), credits: { cast: [{ name: 'Jim Caviezel' }, { name: 'Mira Sorvino' }] },
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] } },
  102: { id: 102, title: 'Sketch', release_date: '2025-08-06', runtime: 92, poster_path: '/sketch.jpg',
    genres: [{ id: 10751 }, { id: 35 }, { id: 14 }], overview: 'A girl’s drawings come to life.', keywords: kw('grief', 'monster'),
    credits: { cast: [{ name: 'Tony Hale' }] }, release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }] } },
  900: { id: 900, title: 'A Brand New Angel Film', release_date: '2026-10-01', runtime: 104, poster_path: '/new.jpg',
    genres: [{ id: 18 }], overview: 'A pastor rebuilds a small-town church after a storm.', keywords: kw('christian', 'hope', 'small town'),
    credits: { cast: [{ name: 'Someone Famous' }] }, release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }] } },
  901: { id: 901, title: 'Untitled Angel Project', release_date: '', genres: [], keywords: kw(), credits: { cast: [] }, release_dates: { results: [] } },
  // unrelated foreign film credited to a same-named studio
  902: { id: 902, title: 'Bommai', original_language: 'ta', release_date: '2023-06-16', runtime: 150, genres: [{ id: 18 }], keywords: kw(), credits: { cast: [] }, release_dates: { results: [] } },
  // Dry Bar style comedy special with no stand-up keyword and an odd "drama" genre
  903: { id: 903, title: 'Kristin Key: Crafty', original_language: 'en', release_date: '2019-05-01', runtime: 62, genres: [{ id: 18 }], keywords: kw(), credits: { cast: [] }, release_dates: { results: [] } },
  // dated but not out yet
  904: { id: 904, title: 'Rode to Ruin', original_language: 'en', release_date: '2099-03-01', runtime: 100, genres: [{ id: 18 }], keywords: kw(), credits: { cast: [] }, release_dates: { results: [] } },
  // film cut of a series that is also listed
  905: { id: 905, title: 'Young David', original_language: 'en', release_date: '2024-04-01', runtime: 45, genres: [{ id: 16 }], keywords: kw('bible'), credits: { cast: [] }, release_dates: { results: [] } },
  // looks like "Name: Title" but is a feature drama, not a comedy special
  906: { id: 906, title: 'Zero A.D.: The Birth of Christ', original_language: 'en', release_date: '2026-03-01', runtime: 110, genres: [{ id: 18 }, { id: 53 }], keywords: kw('biblical'), credits: { cast: [] }, release_dates: { results: [] } },
  // hand-curated "Bonhoeffer" is listed on TMDB with a subtitle
  907: { id: 907, title: 'Bonhoeffer: Pastor. Spy. Assassin.', original_language: 'en', release_date: '2024-11-22', runtime: 132, genres: [{ id: 18 }, { id: 36 }], keywords: kw('nazi'), credits: { cast: [] }, release_dates: { results: [] } }
};
const SHOWS = {
  201: { id: 201, name: 'Tuttle Twins', first_air_date: '2021-09-01', episode_run_time: [22], poster_path: '/tuttle.jpg',
    genres: [{ id: 16 }, { id: 10762 }, { id: 35 }], overview: 'Twins learn big ideas.', keywords: { results: [{ name: 'economics' }] },
    aggregate_credits: { cast: [] }, content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-Y7' }] } },
  202: { id: 202, name: 'Young David', original_language: 'en', first_air_date: '2023-06-01', episode_run_time: [10], genres: [{ id: 16 }, { id: 10751 }],
    overview: 'A shepherd boy and his songs.', keywords: { results: [{ name: 'bible' }] }, aggregate_credits: { cast: [] }, content_ratings: { results: [] } }
};
let requests = 0, sawAuth = true;
const server = http.createServer((req, res) => {
  requests++;
  const u = new URL(req.url, 'http://x');
  if (req.headers.authorization !== 'Bearer test-token') sawAuth = false;
  const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const q = (u.searchParams.get('query') || '').toLowerCase();
  const p = u.pathname;
  if (p === '/search/movie') return send({ results: Object.values(MOVIES).filter(m => m.title.toLowerCase().startsWith(q)), total_pages: 1 });
  if (p === '/search/tv') return send({ results: Object.values(SHOWS).filter(m => m.name.toLowerCase() === q), total_pages: 1 });
  if (p === '/search/company') return send({ results: [{ id: 7, name: 'Angel Studios' }, { id: 8, name: 'Angel Films Ltd' }, { id: 9, name: 'VidAngel Studios' }, { id: 10, name: 'Fallen Angel Studios' }] });
  if (p === '/discover/movie') { assert.equal(u.searchParams.get('with_companies'), '7|9'); return send({ results: [101, 900, 901, 902, 903, 904, 905, 906, 907].map(id => ({ id })), total_pages: 1 }); }
  if (p === '/discover/tv') return send({ results: [{ id: 201 }, { id: 202 }], total_pages: 1 });
  let m = p.match(/^\/movie\/(\d+)$/); if (m && MOVIES[m[1]]) return send(MOVIES[m[1]]);
  m = p.match(/^\/tv\/(\d+)$/); if (m && SHOWS[m[1]]) return send(SHOWS[m[1]]);
  send({ status_message: 'not found' }, 404);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const out = join(mkdtempSync(join(tmpdir(), 'sync-')), 'catalog.json');
const env = { ...process.env, TMDB_TOKEN: 'test-token', TMDB_BASE: `http://127.0.0.1:${server.address().port}`, OUT: out };
const log1 = (await run(process.execPath, [join(ROOT, 'scripts/sync-catalog.mjs')], { env, timeout: 60000 })).stdout;
const log2 = (await run(process.execPath, [join(ROOT, 'scripts/sync-catalog.mjs')], { env, timeout: 60000 })).stdout;
server.close();

const doc = JSON.parse(readFileSync(out, 'utf8'));
const by = Object.fromEntries(doc.titles.map(t => [t.id, t]));
assert.ok(sawAuth, 'every request carries the bearer token');
assert.ok(requests > 10);
// hand-curated titles keep their game id and gain TMDB data
assert.equal(by.sof.tmdb, 'movie/101');
assert.equal(by.sof.poster, 'https://image.tmdb.org/t/p/w500/sof.jpg');
assert.deepEqual(by.sof.cast, ['Jim Caviezel', 'Mira Sorvino']);
assert.equal(by.sof.age, 'teen');
assert.ok(by.sof.g.includes('true') && by.sof.g.includes('thriller'));
assert.equal(by.sof.tags[0], 'thrill');
assert.ok(by.sof.i >= 4, 'trafficking thriller reads as heavy');
assert.equal(by.sketch.age, 'kids');
assert.ok(by.sketch.tags.includes('funny') && by.sketch.tags.includes('family'));
assert.equal(by.tuttle.tmdb, 'tv/201');
assert.equal(by.tuttle.age, 'all');
assert.equal(by.tuttle.len, 'short');
assert.equal(by.tuttle.k, 'Series');
// discovered titles are added once, undated announcements are skipped
assert.equal(doc.titles.filter(t => t.tmdb === 'movie/101').length, 1, 'no duplicate for a seed found again through discovery');
assert.equal(by['tmdb-movie-900'].t, 'A Brand New Angel Film');
assert.ok(by['tmdb-movie-900'].g.includes('faith'));
assert.ok(!by['tmdb-movie-901'], 'undated titles are skipped');
assert.ok(!doc.titles.some(t => t.tmdb === 'tv/201' && t.id !== 'tuttle'), 'discovered series that matches a seed keeps the seed id');
// only real Angel Studios companies, attribution present, unmatched listed
assert.deepEqual(doc.companies, [{ id: 7, name: 'Angel Studios' }, { id: 9, name: 'VidAngel Studios' }]);
// cleanup rules from the first live run
assert.ok(!by['tmdb-movie-902'], 'non-English film from an unrelated studio is skipped');
assert.ok(!by['tmdb-movie-904'], 'unreleased titles are skipped');
assert.equal(by['tmdb-movie-903'].k, 'Special', 'comedian special is recognized by its title');
assert.equal(by['tmdb-movie-903'].tags[0], 'funny');
assert.equal(by['tmdb-movie-903'].len, 'short');
assert.equal(by['tmdb-movie-906'].k, 'Movie', 'a "Name: Title" drama is not mistaken for a special');
assert.equal(doc.titles.filter(t => t.t === 'Young David').length, 1, 'same title listed once');
assert.ok(by['tmdb-tv-202'], 'the series wins over its film cut');
assert.equal(by.bonhoeffer.tmdb, 'movie/907', 'hand-curated title matches TMDB title with a subtitle');
assert.ok(!by['tmdb-movie-907'], 'no duplicate for the subtitled seed');
assert.match(doc.notice, /not endorsed or certified by TMDB/);
assert.ok(doc.unmatched.includes('Cabrini'));
// second run is a no-op
assert.match(log2, /No changes\./);
console.log(log1.trim());
console.log('sync test passed');
