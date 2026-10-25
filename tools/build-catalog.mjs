// Builds catalog.json (all audio sources) and refreshes the "Listen in app" links in youtube.json.
//
// Usage:  node tools/build-catalog.mjs            (from the repo root; Node 18+; no packages needed)
//         node tools/build-catalog.mjs --check    (build in memory, print the summary, write nothing)
//
// Idempotent: re-running with no upstream changes leaves both files byte-for-byte unchanged, so a
// daily job can run it and commit only files whose content changed. If a source can't be reached,
// its entries from the existing catalog.json are kept (and the failure is reported), never dropped.
//
// Audio is never downloaded or re-hosted. Only metadata and the ORIGINAL public audio URL are stored
// (podcast enclosure URLs and SermonIndex's own file URLs). Mixlr links expire, so for Mixlr only the
// recording id is stored and the app fetches a fresh link from Mixlr at play time.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  SOURCES, SOURCE_BY_KEY, MIXLR_SOURCES, mixlrListUrl, catalogEntryFromMixlr, isPlayableRecording,
  categorise, isGenericTitle, parseSeries, partSeries, coreTitle, dedupe, matchYouTube, speakerFromTitle,
  yearOf, dateOf, byDateDesc, podcastKeep, CATEGORIES, UNCATEGORISED,
} from '../js/logic.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHECK = process.argv.includes('--check');
const UA = { 'user-agent': 'Mozilla/5.0 (Seedline catalog builder; +https://fikayomi2009.github.io/Seedline/)' };
const log = (...a) => console.log(...a);

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const prevCatalog = readJSON('catalog.json', { items: [] });

// Raw (pre-dedupe) entries of the previous build, per source: used when a source is unreachable.
function previousRaw(key) {
  const out = [];
  for (const it of prevCatalog.items || []) {
    const { alts, youtube, ...main } = it;
    if ((main.sourceKey || 'ls-gboko') === key) out.push({ ...main, sourceKey: main.sourceKey || 'ls-gboko' });
    for (const a of alts || []) if (a.sourceKey === key && a.raw) out.push(a.raw);
  }
  return out;
}

async function get(url, { json = false, tries = 3 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return json ? await r.json() : await r.text();
    } catch (e) { err = e; await new Promise((res) => setTimeout(res, 1500 * (i + 1))); }
  }
  throw new Error(`${url}: ${err.message}`);
}

// ---------- Mixlr ----------
async function fetchMixlr(src) {
  const recs = [];
  let url = mixlrListUrl(src.channel), guard = 0;
  while (url && guard++ < 40) {
    const j = await get(url, { json: true });
    recs.push(...(j.data || []));
    url = j.links && j.links.next ? j.links.next.replace('https://api.mixlr.com/', 'https://apicdn.mixlr.com/') : null;
  }
  const skipped = recs.filter((r) => !isPlayableRecording(r)).map((r) => ({ id: src.idPrefix + r.id, title: r.attributes.title, duration: r.attributes.duration, access: r.attributes.access_level }));
  const items = recs.filter(isPlayableRecording).map((r) => catalogEntryFromMixlr(r, src));
  return { items, extra: { totalOnChannel: recs.length, skipped } };
}

// ---------- Podcast RSS ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml); return m ? decode(m[1]).trim() : ''; };
const attr = (xml, name, a) => { const m = new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, 'i').exec(xml); return m ? decode(m[1]) : ''; };
function parseDuration(s) {
  s = String(s || '').trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return +s;
  return s.split(':').map(Number).reduce((acc, x) => acc * 60 + (x || 0), 0);
}
function isoDate(rfc) { const d = new Date(rfc); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }

async function fetchPodcast(src) {
  const xml = await get(src.feed);
  const chan = xml.split(/<item[\s>]/i)[0];
  const showTitle = tag(chan, 'title');
  const showArt = attr(chan, 'itunes:image', 'href') || tag(tag(chan, 'image'), 'url');
  const showLink = tag(chan, 'link');
  const blocks = xml.split(/<item[\s>]/i).slice(1).map((b) => b.split(/<\/item>/i)[0]);
  const items = [];
  let skippedNotHim = 0;
  for (const b of blocks) {
    const title = tag(b, 'title');
    const url = attr(b, 'enclosure', 'url');
    const type = attr(b, 'enclosure', 'type');
    if (!title || !url || (type && !/audio/i.test(type))) continue;
    if (!podcastKeep(src, title)) { skippedNotHim++; continue; }
    const guid = tag(b, 'guid') || url;
    const date = isoDate(tag(b, 'pubDate'));
    const ser = parseSeries(title, date);
    items.push({
      id: `${src.key}:${crypto.createHash('sha1').update(guid).digest('hex').slice(0, 12)}`,
      title,
      genericTitle: isGenericTitle(title),
      speaker: speakerFromTitle(title, 'Bro Gbile Akanni (per podcast)'),
      series: ser.series, episode: ser.episode, subtitle: ser.subtitle,
      date, year: yearOf(date),
      duration: parseDuration(tag(b, 'itunes:duration')),
      categories: categorise(title), categorySource: 'auto-tagged',
      artwork: attr(b, 'itunes:image', 'href') || showArt || null,
      artworkLarge: attr(b, 'itunes:image', 'href') || showArt || null,
      source: src.name, sourceKey: src.key, sourceType: 'podcast', label: src.label,
      sourceUrl: tag(b, 'link') || showLink || src.feed,
      audioUrl: url,
      kind: 'podcast',
    });
  }
  return { items, extra: { feed: src.feed, showTitle, episodesInFeed: blocks.length, skippedNotByHim: skippedNotHim } };
}

// ---------- SermonIndex ----------
function parseISODur(s) { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; }
async function fetchSermonIndex(src) {
  const html = await get(src.speakerPage);
  const links = [...new Set([...html.matchAll(/href="(\/speakers\/gbile-akanni\/[^"#?]+\/)"/g)].map((m) => 'https://sermonindex.net' + m[1]))];
  const prev = new Map(previousRaw(src.key).map((e) => [e.sourceUrl, e]));
  const items = [], failed = [];
  let fetched = 0;
  const queue = links.slice();
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      if (prev.has(url)) { items.push(prev.get(url)); continue; }
      try {
        const h = await get(url);
        fetched++;
        const audio = (/<source src="(https:\/\/[^"]+\.mp3)"/.exec(h) || [])[1];
        let ao = null;
        for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { const j = JSON.parse(m[1]); if (j['@type'] === 'AudioObject') ao = j; } catch {} }
        if (!audio || !ao || !ao.name) { failed.push(url); continue; }
        const title = decode(ao.name).trim();
        const sid = (/SID(\d+)\.mp3/.exec(audio) || [])[1];
        const ser = parseSeries(title, '');
        items.push({
          id: 'si:' + (sid || crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)),
          title,
          genericTitle: isGenericTitle(title),
          speaker: 'Gbile Akanni (as listed by SermonIndex)',
          series: ser.series, episode: ser.episode, subtitle: ser.subtitle,
          date: '', year: null, // SermonIndex shows the same placeholder upload date on every message, so no date is claimed
          duration: parseISODur(ao.duration),
          categories: categorise(title), categorySource: 'auto-tagged',
          artwork: ao.thumbnailUrl || null, artworkLarge: ao.thumbnailUrl || null,
          source: src.name, sourceKey: src.key, sourceType: 'sermonindex', label: src.label,
          sourceUrl: url,
          audioUrl: audio,
          kind: 'sermonindex',
        });
      } catch (e) { failed.push(url); }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const keep = new Set(links);
  return { items: items.filter((i) => keep.has(i.sourceUrl)), extra: { pagesListed: links.length, newlyFetched: fetched, failedPages: failed } };
}

// ---------- Build ----------
const report = {};
let raw = [];
for (const src of SOURCES) {
  const fn = src.type === 'mixlr' ? fetchMixlr : src.type === 'podcast' ? fetchPodcast : fetchSermonIndex;
  try {
    const { items, extra } = await fn(src);
    if (!items.length) throw new Error('no playable entries found');
    raw.push(...items);
    report[src.key] = { ok: true, entries: items.length, ...extra };
  } catch (e) {
    const prev = previousRaw(src.key);
    raw.push(...prev);
    report[src.key] = { ok: false, error: String(e.message || e).slice(0, 200), keptFromPreviousBuild: prev.length };
  }
  log(src.key.padEnd(14), report[src.key].ok ? `${report[src.key].entries} entries` : `FAILED (${report[src.key].error}); kept ${report[src.key].keptFromPreviousBuild} from last build`);
}

// Series from "Part N" titles when 2+ entries share the name (any source).
const partGroups = new Map();
for (const it of raw) {
  if (it.series) continue;
  const p = partSeries(it.title);
  if (!p) continue;
  const k = coreTitle(p.series);
  if (!partGroups.has(k)) partGroups.set(k, []);
  partGroups.get(k).push([it, p]);
}
for (const [, arr] of partGroups) {
  const titles = new Set(arr.map(([it]) => it.title));
  if (titles.size < 2) continue;
  const name = arr[0][1].series;
  for (const [it, p] of arr) { it.series = name; it.episode = p.episode; it.seriesSource = 'title "Part N"'; }
}

const { items: deduped, merged } = dedupe(raw);
// Keep each alternate's full raw entry so a later build can restore it if that source is down.
const rawById = new Map(raw.map((r) => [r.id, r]));
for (const it of deduped) for (const a of it.alts || []) { const r = rawById.get(a.id); if (r) { const { alts, youtube, ...rr } = r; a.raw = rr; } }

// YouTube matches (conservative).
const yt = readJSON('youtube.json', { items: [] });
const matches = matchYouTube(deduped, yt.items || []);
const ytUse = new Map();
for (const [aid, y] of matches) ytUse.set(y.id, (ytUse.get(y.id) || []).concat(aid));
for (const [yid, aids] of ytUse) if (aids.length > 1) for (const a of aids) matches.delete(a); // ambiguous -> no match
for (const it of deduped) {
  const y = matches.get(it.id);
  if (y) it.youtube = { id: y.id, videoId: y.videoId, url: y.url, title: y.title }; else delete it.youtube;
}
const listenBy = new Map([...matches].map(([aid, y]) => [y.id, aid]));
const ytOut = { ...yt, items: (yt.items || []).map((v) => { const { listenId, ...rest } = v; return listenBy.has(v.id) ? { ...rest, listenId: listenBy.get(v.id) } : rest; }) };
ytOut.note = 'Saturday Bible Study videos on YouTube (real titles). Opened on YouTube, never played or ripped in-app. listenId = the same message as audio in Seedline (conservative title match).';

deduped.sort(byDateDesc);
const counts = {};
for (const c of [...CATEGORIES, UNCATEGORISED]) counts[c] = deduped.filter((i) => i.categories.includes(c)).length;
const bySource = {};
for (const s of SOURCES) {
  bySource[s.key] = {
    name: s.name, type: s.type, label: s.label,
    entries: raw.filter((r) => r.sourceKey === s.key).length,
    shownAsMain: deduped.filter((i) => i.sourceKey === s.key).length,
  };
}
const stats = {
  uniqueMessages: deduped.length,
  rawEntries: raw.length,
  mergedDuplicates: merged,
  withAlternates: deduped.filter((i) => i.alts && i.alts.length).length,
  youtubeMatches: matches.size,
  official: deduped.filter((i) => i.label === 'official').length,
  community: deduped.filter((i) => i.label === 'community').length,
  categories: counts,
  bySource,
};

const catalog = {
  generatedAt: new Date().toISOString(),
  note: 'Titles exactly as published by each source. Categories are auto-tagged from title keywords only. Audio streams from the original host: podcast/SermonIndex URLs are the publishers\' own; Mixlr links expire and are fetched fresh at runtime. Not a complete collection of Bro Gbile Akanni\'s teaching.',
  sources: Object.fromEntries(SOURCES.map((s) => [s.key, { name: s.name, type: s.type, label: s.label, home: s.home || null, feed: s.feed || null, ...report[s.key] }])),
  stats,
  items: deduped,
};

// Write only when content (ignoring timestamps) changed.
const stable = (o) => JSON.stringify({ ...o, generatedAt: undefined });
function writeIfChanged(file, obj, prev) {
  const rel = path.join(ROOT, file);
  if (prev && stable(prev) === stable(obj)) { log(`${file}: unchanged`); return false; }
  if (CHECK) { log(`${file}: WOULD change (--check, not written)`); return true; }
  fs.writeFileSync(rel, JSON.stringify(obj, null, 1) + '\n');
  log(`${file}: written`);
  return true;
}
// generatedAt must not differ when nothing else did
if (stable(prevCatalog) === stable(catalog)) catalog.generatedAt = prevCatalog.generatedAt;
writeIfChanged('catalog.json', catalog, prevCatalog);
writeIfChanged('youtube.json', ytOut, yt);

log('\nunique messages', stats.uniqueMessages, '| raw entries', stats.rawEntries, '| merged duplicates', merged, '| YouTube matches', matches.size);
log('official', stats.official, 'community', stats.community);
log('by source', JSON.stringify(Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, `${v.entries} (${v.shownAsMain} main)`]))));
log('categories', JSON.stringify(counts));
log('series', [...new Set(deduped.map((i) => i.series).filter(Boolean))].join(' | '));
const failedSources = Object.entries(report).filter(([, r]) => !r.ok).map(([k]) => k);
if (failedSources.length) { log('\nFAILED sources (kept previous entries):', failedSources.join(', ')); process.exitCode = 2; }
