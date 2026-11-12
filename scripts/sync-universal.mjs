#!/usr/bin/env node
/*
 * Daily "everything streaming" lineup sync.
 *
 * Builds data/universal.json: the most popular and best-loved movies and series streaming in the US
 * on the major subscription and free services, with where each one streams. The game uses it for the
 * default (universal) edition and lets the host filter to the services the room actually has.
 *
 * Where-to-watch data comes from JustWatch through TMDB. Both must be credited wherever it is shown.
 *
 * Env:
 *   TMDB_TOKEN  TMDB "API Read Access Token" (long) or v3 "API Key". Required.
 *   TMDB_BASE   API base URL (default https://api.themoviedb.org/3). Used by tests.
 *   OUT_UNIVERSAL  Output path (default data/universal.json).
 *   REGION      Watch region (default US).
 *   MAX_TITLES  Cap on titles kept (default 900).
 *
 * No dependencies. Node 18+.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmdb, allPages, details, mapTitle } from './sync-catalog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, process.env.OUT_UNIVERSAL || 'data/universal.json');
const REGION = process.env.REGION || 'US';
const MAX_TITLES = Number(process.env.MAX_TITLES) || 900;
const LOGO = 'https://image.tmdb.org/t/p/w92';

/* The services a host can tick. Known TMDB provider ids, plus a name pattern to catch ad tiers and
   renamed providers. Add-on "channels" (e.g. "Paramount Plus Amazon Channel") count as the service. */
export const SERVICES = [
  { key: 'netflix', n: 'Netflix', ids: [8, 1796], re: /^netflix/i },
  { key: 'prime', n: 'Prime Video', ids: [9, 119, 2100], re: /^amazon prime video/i },
  { key: 'disney', n: 'Disney+', ids: [337], re: /^disney (plus|\+)/i },
  { key: 'max', n: 'Max', ids: [1899, 384], re: /^(hbo )?max\b/i },
  { key: 'hulu', n: 'Hulu', ids: [15], re: /^hulu\b/i },
  { key: 'apple', n: 'Apple TV+', ids: [350], re: /^apple tv (plus|\+)/i },
  { key: 'peacock', n: 'Peacock', ids: [386, 387], re: /^peacock/i },
  { key: 'paramount', n: 'Paramount+', ids: [531, 1770, 2303, 2616], re: /^paramount(\+| plus)/i },
  { key: 'angel', n: 'Angel Studios', ids: [], re: /^angel studios/i },
  { key: 'free', n: 'Free with ads', ids: [73, 300, 207, 538, 613], re: /^(tubi|pluto tv|the roku channel|plex|freevee|amazon freevee|youtube \(free\))/i }
];

const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function serviceMap() {
  const byId = new Map(); // provider id -> service key
  const logos = {};
  for (const s of SERVICES) for (const id of s.ids) byId.set(id, s.key);
  for (const type of ['movie', 'tv']) {
    const list = (await tmdb(`/watch/providers/${type}`, { watch_region: REGION, language: 'en-US' }))?.results || [];
    for (const p of list) {
      const s = SERVICES.find(x => x.ids.includes(p.provider_id)) || SERVICES.find(x => x.re.test(p.provider_name || ''));
      if (!s) continue;
      byId.set(p.provider_id, s.key);
      // the service's main provider gives the logo
      if (p.logo_path && (!logos[s.key] || s.ids[0] === p.provider_id)) logos[s.key] = LOGO + p.logo_path;
    }
  }
  return { byId, logos };
}

/* Where a title streams in the region: subscription, free and ad-supported only. Rent/buy is a flag. */
export function whereFrom(d, byId) {
  const r = d['watch/providers']?.results?.[REGION];
  if (!r) return { on: [], rent: false };
  const on = new Set();
  for (const p of [...(r.flatrate || []), ...(r.free || []), ...(r.ads || [])]) {
    const k = byId.get(p.provider_id);
    if (k) on.add(k);
  }
  return { on: SERVICES.map(s => s.key).filter(k => on.has(k)), rent: !!((r.rent || []).length || (r.buy || []).length) };
}

async function main() {
  if (!(process.env.TMDB_TOKEN || '').trim()) {
    console.log('::warning::TMDB_TOKEN is not set, so the streaming lineup was not refreshed.');
    return;
  }
  const { byId, logos } = await serviceMap();
  const providerIds = key => [...byId.entries()].filter(([, k]) => k === key).map(([id]) => id);
  const base = { watch_region: REGION, include_adult: 'false', with_watch_monetization_types: 'flatrate|free|ads', language: 'en-US' };

  // Candidates: what is popular on each service, plus family picks and all-time favorites everywhere.
  const cand = new Map(); // "type/id" -> popularity
  const addAll = (type, list) => list.forEach(r => { const k = `${type}/${r.id}`; cand.set(k, Math.max(cand.get(k) || 0, r.popularity || 0)); });
  for (const s of SERVICES) {
    const ids = providerIds(s.key);
    if (!ids.length) continue;
    const w = { ...base, with_watch_providers: ids.join('|') };
    addAll('movie', await allPages('/discover/movie', { ...w, sort_by: 'popularity.desc', 'vote_count.gte': 150 }, 3));
    addAll('tv', await allPages('/discover/tv', { ...w, sort_by: 'popularity.desc', 'vote_count.gte': 100 }, 2));
  }
  const all = [...byId.keys()].join('|');
  if (all) {
    const w = { ...base, with_watch_providers: all };
    addAll('movie', await allPages('/discover/movie', { ...w, with_genres: '10751|16', sort_by: 'popularity.desc', 'vote_count.gte': 100 }, 3));
    addAll('tv', await allPages('/discover/tv', { ...w, with_genres: '10762|10751|16', sort_by: 'popularity.desc', 'vote_count.gte': 50 }, 2));
    addAll('movie', await allPages('/discover/movie', { ...w, sort_by: 'vote_average.desc', 'vote_count.gte': 4000 }, 3));
    addAll('tv', await allPages('/discover/tv', { ...w, sort_by: 'vote_average.desc', 'vote_count.gte': 1500 }, 2));
  }

  const keys = [...cand.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const today = new Date().toISOString().slice(0, 10);
  const titles = [], seen = new Set();
  for (const key of keys) {
    if (titles.length >= MAX_TITLES) break;
    const [type, id] = key.split('/');
    const d = await details(type, id, 'watch/providers');
    if (!d) continue;
    const date = (type === 'tv' ? d.first_air_date : d.release_date) || '';
    if (!date || date > today) continue;
    const where = whereFrom(d, byId);
    if (!where.on.length && !where.rent) continue; // can't be watched here
    const m = mapTitle(d, type);
    const name = norm(m.t) + '|' + (m.y || '');
    if (seen.has(name)) continue;
    seen.add(name);
    const { keywords, ...rest } = m;
    titles.push({ id: type + '-' + id, ...rest, on: where.on, rent: where.rent, pop: Math.round(d.popularity || 0), vote: Math.round((d.vote_average || 0) * 10) / 10 });
  }

  titles.sort((a, b) => b.pop - a.pop || a.t.localeCompare(b.t));
  const doc = {
    source: 'TMDB',
    region: REGION,
    notice: 'This product uses the TMDB API but is not endorsed or certified by TMDB. Where-to-watch data provided by JustWatch.',
    services: SERVICES.map(s => ({ key: s.key, n: s.n, logo: logos[s.key] || null })),
    titles
  };
  // one title per line keeps the file small and the daily diffs readable
  const json = '{\n' + Object.entries(doc).map(([k, v]) => k === 'titles'
    ? `"titles": [\n${v.map(t => JSON.stringify(t)).join(',\n')}\n]`
    : `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n';
  const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  mkdirSync(dirname(OUT), { recursive: true });
  if (json !== before) writeFileSync(OUT, json);
  const per = SERVICES.map(s => `${s.n} ${titles.filter(t => t.on.includes(s.key)).length}`).join(', ');
  console.log(`${titles.length} streaming titles (${per}). ${json === before ? 'No changes.' : 'Lineup updated.'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('::error::' + e.message); process.exit(1); });
}
