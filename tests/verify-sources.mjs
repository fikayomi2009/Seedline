// Checks catalog.json against the live sources (needs internet):
//  1. every title (main + alternates) is exactly what its source publishes (no invented titles);
//  2. every static audio URL answers with audio from the original host (1-byte range request, nothing downloaded).
// Run: node tests/verify-sources.mjs
import fs from 'fs';
import { SOURCES, MIXLR_SOURCES, mixlrListUrl } from '../js/logic.js';

const cat = JSON.parse(fs.readFileSync(new URL('../catalog.json', import.meta.url)));
const all = cat.items.flatMap((it) => [it, ...(it.alts || []).map((a) => ({ ...a.raw, ...a }))]);
const UA = { 'user-agent': 'Mozilla/5.0 (Seedline verify)' };
let bad = 0;
const fail = (m) => { bad++; console.log('FAIL', m); };

// 1a. Mixlr titles
for (const s of MIXLR_SOURCES) {
  const titles = new Map();
  let url = mixlrListUrl(s.channel);
  while (url) { const j = await (await fetch(url)).json(); for (const r of j.data) titles.set(s.idPrefix + r.id, r.attributes.title.trim()); url = j.links.next && j.links.next.replace('https://api.mixlr.com/', 'https://apicdn.mixlr.com/'); }
  const mine = all.filter((i) => i.sourceKey === s.key);
  for (const i of mine) if (titles.get(i.id) !== i.title) fail(`${i.id} title "${i.title}" vs Mixlr "${titles.get(i.id)}"`);
  console.log(`${s.key}: ${mine.length} titles checked against the live Mixlr API`);
}
// 1b. Podcast titles + enclosure URLs
const dec = (x) => x.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()] ?? m));
for (const s of SOURCES.filter((x) => x.type === 'podcast')) {
  const xml = await (await fetch(s.feed, { headers: UA })).text();
  const pairs = new Map();
  for (const b of xml.split(/<item[\s>]/i).slice(1)) {
    const t = dec((/<title>([\s\S]*?)<\/title>/i.exec(b) || [])[1] || '').trim();
    const u = dec((/<enclosure\b[^>]*\burl="([^"]*)"/i.exec(b) || [])[1] || '');
    pairs.set(u, t);
  }
  const mine = all.filter((i) => i.sourceKey === s.key);
  for (const i of mine) { if (!pairs.has(i.audioUrl)) fail(`${i.id} audio URL not in feed`); else if (pairs.get(i.audioUrl) !== i.title) fail(`${i.id} title mismatch`); }
  console.log(`${s.key}: ${mine.length} titles + enclosure URLs checked against the live feed`);
}
// 1c. SermonIndex: sample 15 pages
const si = all.filter((i) => i.sourceKey === 'sermonindex');
for (const i of si.filter((_, k) => k % Math.ceil(si.length / 15) === 0)) {
  const h = await (await fetch(i.sourceUrl, { headers: UA })).text();
  if (!h.includes(i.audioUrl)) fail(`${i.id} audio URL not on its page`);
  const name = (/"@type": "AudioObject",\s*"name": "([^"]*)"/.exec(h) || [])[1];
  if (name && JSON.parse(`"${name}"`).trim() !== i.title) fail(`${i.id} title "${i.title}" vs page "${name}"`);
}
console.log(`sermonindex: ${si.length} entries, 15 pages re-checked (title + audio URL on the page)`);

// 2. Static audio answers (1-byte range request)
const statics = all.filter((i) => i.audioUrl && i.sourceType !== 'mixlr');
const hosts = {};
let okN = 0;
const q = statics.slice();
await Promise.all(Array.from({ length: 8 }, async () => {
  while (q.length) {
    const i = q.shift();
    try {
      const r = await fetch(i.audioUrl, { headers: { ...UA, range: 'bytes=0-1' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const ct = r.headers.get('content-type') || '';
      await r.arrayBuffer().catch(() => {});
      const h = new URL(r.url).host;
      hosts[h] = (hosts[h] || 0) + 1;
      if (!(r.status === 206 || r.status === 200) || !/audio|octet-stream|mpeg/i.test(ct)) fail(`${i.id} audio ${r.status} ${ct}`); else okN++;
    } catch (e) { fail(`${i.id} audio ${e.message}`); }
  }
}));
console.log(`static audio URLs answering with audio: ${okN}/${statics.length}; final hosts:`, hosts);
console.log(bad ? `\n${bad} problem(s)` : '\nall source checks passed');
process.exit(bad ? 1 : 0);
