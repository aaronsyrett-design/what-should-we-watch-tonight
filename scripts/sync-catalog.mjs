#!/usr/bin/env node
/*
 * Daily Angel lineup sync.
 *
 * Pulls Angel Studios titles from The Movie Database (TMDB) and writes data/catalog.json,
 * which the game merges into its hand-curated lineup at load time.
 *
 * Two sources are combined:
 *   1. Seeds: every title already in the game's hand-curated CATALOG (index.html), looked up by
 *      title and year, so those titles gain posters, keywords and cast without losing their
 *      hand-set mood tags.
 *   2. Discovery: every movie and series TMDB credits to an "Angel Studios" company.
 *
 * Env:
 *   TMDB_TOKEN  TMDB "API Read Access Token" (long) or v3 "API Key" (32 hex chars). Required.
 *   TMDB_BASE   API base URL (default https://api.themoviedb.org/3). Used by tests.
 *   OUT         Output path (default data/catalog.json).
 *
 * No dependencies. Node 18+.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.TMDB_BASE || 'https://api.themoviedb.org/3').replace(/\/$/, '');
const TOKEN = (process.env.TMDB_TOKEN || '').trim();
const OUT = resolve(ROOT, process.env.OUT || 'data/catalog.json');
const IMG = 'https://image.tmdb.org/t/p/w500';
const COMPANY_QUERY = 'Angel Studios';
// TMDB company names we treat as Angel. "VidAngel Studios" is Angel's former name and holds the Dry Bar
// comedy library. Other companies that merely contain "Angel" (or an unrelated studio abroad) are left out.
const ANGEL_COMPANIES = /^(angel studios|vidangel studios)$/i;

/* ---------- TMDB client ---------- */
const isV3Key = /^[0-9a-f]{32}$/i.test(TOKEN);
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function tmdb(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  if (isV3Key) url.searchParams.set('api_key', TOKEN);
  const headers = { accept: 'application/json' };
  if (!isV3Key) headers.authorization = 'Bearer ' + TOKEN;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 401) throw new Error('TMDB rejected the token (401). Check the TMDB_TOKEN secret.');
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`);
    await sleep(40); // stay well under TMDB's rate limit
    return res.json();
  }
  throw new Error(`TMDB kept rate-limiting ${path}`);
}
export async function allPages(path, params, max = 20) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const r = await tmdb(path, { ...params, page });
    if (!r) break;
    out.push(...(r.results || []));
    if (page >= (r.total_pages || 1)) break;
  }
  return out;
}

/* ---------- the game's hand-curated lineup (seeds) ---------- */
function readSeeds() {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const ANGEL = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('Could not find the ANGEL lineup in index.html');
  return Function('"use strict";return (' + m[1] + ')')();
}

/* ---------- mapping TMDB data onto the game's fields ---------- */
const G = { action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18, family: 10751,
  fantasy: 14, history: 36, horror: 27, music: 10402, mystery: 9648, romance: 10749, scifi: 878, thriller: 53, war: 10752, western: 37,
  tvActionAdventure: 10759, tvKids: 10762, tvNews: 10763, tvReality: 10764, tvSciFiFantasy: 10765, tvWarPolitics: 10768 };
const kwHas = (kws, ...words) => kws.some(k => words.some(w => k.includes(w)));
const FAITH = ['christian', 'faith', 'bible', 'biblical', 'jesus', 'god', 'church', 'religio', 'pastor', 'gospel', 'prayer', 'worship', 'apostle', 'nun', 'priest'];
const TRUE = ['based on true story', 'true story', 'biography', 'based on real', 'historical figure', 'biographical'];
const STANDUP = ['stand-up', 'stand up comedy', 'standup'];
const HEAVY = ['human trafficking', 'sex trafficking', 'holocaust', 'nazi', 'murder', 'war', 'school shooting', 'death', 'suicide', 'abuse', 'kidnapping'];
const GRIEF = ['grief', 'loss of', 'death of', 'tearjerker', 'cancer', 'illness', 'adoption', 'foster'];
// Dry Bar style stand-up specials are titled "First Last: Special Name" and rarely carry a stand-up keyword.
const COMIC_TITLE = /^[A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+){1,2}\s*(?::|\s[-–]\s)\s*\S/;
function looksLikeSpecial(title, type, gids, kws, runtime) {
  return type === 'movie' && COMIC_TITLE.test(title || '')
    && gids.length > 0 && gids.every(id => id === G.comedy || id === G.drama)
    && (!runtime || runtime <= 95)
    && kws.every(k => /comedy|comedian|stand.?up/.test(k));
}
const UPLIFT = ['inspirational', 'hope', 'overcoming', 'redemption', 'forgiveness', 'underdog', 'perseverance', 'courage'];

function ageFrom(cert) {
  const c = String(cert || '').toUpperCase();
  if (['G', 'TV-Y', 'TV-Y7', 'TV-G'].includes(c)) return 'all';
  if (['PG', 'TV-PG'].includes(c)) return 'kids';
  if (['PG-13', 'TV-14'].includes(c)) return 'teen';
  if (['R', 'NC-17', 'TV-MA'].includes(c)) return 'adult';
  return 'teen'; // unrated: hold it back from kids-only rooms until someone checks
}
export function mapTitle(d, type) {
  const gids = (d.genres || []).map(g => g.id);
  const has = (...ids) => ids.some(id => gids.includes(id));
  const kws = ((type === 'tv' ? d.keywords?.results : d.keywords?.keywords) || []).map(k => k.name.toLowerCase());
  const title = type === 'tv' ? d.name : d.title;
  const date = type === 'tv' ? d.first_air_date : d.release_date;
  const runtime = type === 'tv' ? (d.episode_run_time || [])[0] : d.runtime;
  const standup = kwHas(kws, ...STANDUP) || looksLikeSpecial(title, type, gids, kws, runtime);
  const faith = kwHas(kws, ...FAITH);
  const trueStory = kwHas(kws, ...TRUE) || has(G.history);
  const heavy = kwHas(kws, ...HEAVY) || has(G.war, G.crime, G.horror);

  // certification (US)
  let cert = '';
  if (type === 'tv') cert = (d.content_ratings?.results || []).find(r => r.iso_3166_1 === 'US')?.rating || '';
  else cert = ((d.release_dates?.results || []).find(r => r.iso_3166_1 === 'US')?.release_dates || []).map(r => r.certification).find(Boolean) || '';

  // genre buckets the game asks about
  const g = [];
  if (has(G.comedy) || standup) g.push('comedy');
  if (has(G.drama, G.romance)) g.push('drama');
  if (has(G.thriller, G.action, G.crime, G.mystery, G.tvActionAdventure, G.war)) g.push('thriller');
  if (has(G.family, G.animation, G.tvKids)) g.push('family');
  if (trueStory) g.push('true');
  if (faith) g.push('faith');
  if (has(G.documentary, G.tvNews, G.tvReality) || has(G.music) && !has(G.drama)) g.push('docs');
  if (has(G.scifi, G.fantasy, G.tvSciFiFantasy)) g.push('scifi');
  if (has(G.horror)) g.push('horror');
  if (has(G.romance)) g.push('romance');
  if (!g.length) g.push('drama');

  // mood tags, weighted so the strongest signal comes first
  const w = {};
  const add = (t, n) => { w[t] = (w[t] || 0) + n; };
  if (has(G.comedy) || standup) add('funny', standup ? 3 : 2);
  if (has(G.thriller, G.action, G.crime, G.mystery, G.horror, G.war, G.tvActionAdventure)) add('thrill', 2);
  if (has(G.horror)) add('scare', 2.5);
  if (has(G.adventure, G.fantasy, G.scifi, G.western, G.tvSciFiFantasy)) add('adventure', 2);
  if (has(G.documentary, G.history) || trueStory) add('learn', has(G.documentary) ? 2 : 1);
  if (kwHas(kws, ...UPLIFT) || trueStory) add('inspire', 1.5);
  if (kwHas(kws, ...GRIEF) || (has(G.drama) && heavy)) add('cry', 1.5);
  if (has(G.drama, G.romance, G.family)) add('heart', 1);
  if (has(G.family, G.animation, G.tvKids)) add('family', 1.5);
  if (faith) add('faith', 1.5);
  if (has(G.history, G.war) || (runtime || 0) >= 140 || has(G.fantasy) && has(G.adventure)) add('epic', 1);
  if (standup || has(G.romance) && has(G.comedy)) add('cozy', 1);
  const tags = Object.entries(w).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 4);
  if (!tags.length) tags.push('heart');

  // intensity 1 (light) to 5 (heavy)
  let i = 2;
  if (has(G.thriller, G.action, G.crime, G.war, G.horror)) i += 1;
  if (heavy) i += 1;
  if (has(G.comedy, G.family, G.animation, G.tvKids) || standup) i -= 1;
  if (['R', 'TV-MA'].includes(cert)) i += 1;
  i = Math.max(1, Math.min(5, i));

  const kind = standup ? 'Special' : has(G.documentary) ? 'Documentary' : type === 'tv' ? 'Series' : has(G.animation) ? 'Animated' : 'Movie';
  const len = type === 'tv' || standup || (runtime && runtime < 60) ? 'short' : (runtime || 0) >= 140 ? 'epic' : 'movie';
  const people = type === 'tv' ? (d.aggregate_credits?.cast || d.credits?.cast || []) : (d.credits?.cast || []);
  const overview = (d.overview || '').trim();
  return {
    tmdb: `${type}/${d.id}`,
    t: title,
    y: date ? Number(date.slice(0, 4)) : null,
    k: kind,
    age: ageFrom(cert),
    cert: cert || null,
    g: [...new Set(g)],
    tags,
    i,
    len,
    cast: people.slice(0, 4).map(p => p.name),
    b: overview.length > 200 ? overview.slice(0, 197).replace(/\s+\S*$/, '') + '…' : overview,
    keywords: kws.slice(0, 20),
    poster: d.poster_path ? IMG + d.poster_path : null
  };
}

/* ---------- lookups ---------- */
const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export async function details(type, id, more = '') {
  const extra = (type === 'tv' ? 'keywords,aggregate_credits,content_ratings' : 'keywords,credits,release_dates') + (more ? ',' + more : '');
  return tmdb(`/${type}/${id}`, { append_to_response: extra, language: 'en-US' });
}
async function findSeed(seed) {
  // Series in the game are TV on TMDB; everything else is a movie (concerts and specials included).
  const order = seed.k === 'Series' ? ['tv', 'movie'] : ['movie', 'tv'];
  const wanted = norm(seed.t);
  const short = norm(seed.t.split(':').pop());
  // "Comic: Special Name" titles are often listed on TMDB under the special's name alone.
  const queries = seed.t.includes(':') ? [seed.t, seed.t.split(':').pop().trim()] : [seed.t];
  for (const type of order) for (const query of queries) {
    const results = await tmdb(`/search/${type}`, { query, include_adult: 'false' });
    const list = results?.results || [];
    const yearOf = r => Number(((type === 'tv' ? r.first_air_date : r.release_date) || '').slice(0, 4)) || null;
    const nameOf = r => norm(type === 'tv' ? r.name : r.title);
    const hit = list.find(r => nameOf(r) === wanted && (!seed.y || !yearOf(r) || Math.abs(yearOf(r) - seed.y) <= 1))
             || list.find(r => (nameOf(r) === wanted || nameOf(r) === short) && (!seed.y || Math.abs((yearOf(r) || seed.y) - seed.y) <= 1))
             // TMDB often adds a subtitle ("Bonhoeffer: Pastor. Spy. Assassin."), so allow a prefix match in the right year
             || list.find(r => nameOf(r).startsWith(wanted + ' ') && seed.y && Math.abs((yearOf(r) || 0) - seed.y) <= 1)
             // an exact full title is trusted even when TMDB's year disagrees
             || (wanted.split(' ').length >= 3 ? list.find(r => nameOf(r) === wanted) : null);
    if (hit) return { type, id: hit.id };
  }
  return null;
}

/* ---------- main ---------- */
async function main() {
  if (!TOKEN) {
    console.log('::warning::TMDB_TOKEN is not set, so the lineup was not refreshed. Add it under Settings > Secrets and variables > Actions.');
    return;
  }
  const seeds = readSeeds();
  const out = new Map(); // key: tmdb "type/id"
  const misses = [];

  for (const seed of seeds) {
    const found = await findSeed(seed);
    if (!found) { misses.push(seed.t); continue; }
    const d = await details(found.type, found.id);
    if (!d) { misses.push(seed.t); continue; }
    const m = mapTitle(d, found.type);
    out.set(m.tmdb, { id: seed.id, ...m });
  }

  const companies = ((await tmdb('/search/company', { query: COMPANY_QUERY }))?.results || [])
    .filter(c => ANGEL_COMPANIES.test(c.name.trim()));
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set([...out.values()].map(t => norm(t.t)));
  if (companies.length) {
    const ids = companies.map(c => c.id).join('|');
    for (const type of ['tv', 'movie']) { // series first, so a series wins over a movie cut of the same title
      const found = await allPages(`/discover/${type}`, { with_companies: ids, include_adult: 'false', sort_by: type === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc' });
      for (const r of found) {
        const key = `${type}/${r.id}`;
        if (out.has(key)) continue;
        const d = await details(type, r.id);
        if (!d) continue;
        const date = (type === 'tv' ? d.first_air_date : d.release_date) || '';
        if (!date || date > today) continue; // skip announcements and titles that haven't come out yet
        if (d.original_language && d.original_language !== 'en') continue; // another studio's film abroad, not Angel's lineup
        const m = mapTitle(d, type);
        const name = norm(m.t);
        if (seen.has(name)) continue; // same title already listed (e.g. a film cut of a series, or a hand-curated title)
        seen.add(name);
        out.set(key, { id: 'tmdb-' + type + '-' + r.id, ...m });
      }
    }
  }

  const titles = [...out.values()].sort((a, b) => (a.id.startsWith('tmdb-') - b.id.startsWith('tmdb-')) || a.t.localeCompare(b.t));
  const doc = {
    source: 'TMDB',
    notice: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    companies: companies.map(c => ({ id: c.id, name: c.name })),
    unmatched: misses,
    titles
  };
  const json = JSON.stringify(doc, null, 2) + '\n';
  const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  mkdirSync(dirname(OUT), { recursive: true });
  if (json !== before) writeFileSync(OUT, json);
  const added = titles.filter(t => t.id.startsWith('tmdb-')).length;
  console.log(`${titles.length} titles (${titles.length - added} hand-curated matched, ${added} found through Angel Studios). ${misses.length} hand-curated titles not found on TMDB${misses.length ? ': ' + misses.join(', ') : ''}. ${json === before ? 'No changes.' : 'Catalog updated.'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('::error::' + e.message); process.exit(1); });
}
