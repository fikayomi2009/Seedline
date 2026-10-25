// Generates catalog.json and youtube.json from real data.
// Usage: node tools/build-catalog.mjs <mixlr_snapshot.json> <youtube_merged.json>
import fs from 'fs';
import { catalogEntryFromMixlr, isPlayableRecording, MIXLR_LIST_URL, parseLength, CATEGORIES, UNCATEGORISED } from '../js/logic.js';

const [snapPath, ytPath] = process.argv.slice(2);
let recs = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
// Also pull the live API so the catalog is current at build time.
try {
  let url = MIXLR_LIST_URL, live = [];
  while (url) { const j = await (await fetch(url)).json(); live.push(...j.data); url = j.links && j.links.next; }
  const ids = new Set(recs.map(r => r.id));
  const added = live.filter(r => !ids.has(r.id));
  console.log('live recordings:', live.length, 'not in snapshot:', added.length);
  recs = live; // live is the source of truth
} catch (e) { console.log('live fetch failed, using snapshot only:', e.message); }

const skipped = recs.filter(r => !isPlayableRecording(r));
const items = recs.filter(isPlayableRecording).map(catalogEntryFromMixlr)
  .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
const catalog = {
  generatedAt: new Date().toISOString(),
  source: 'https://living-seed-gboko.mixlr.com (public Mixlr API)',
  note: 'Titles exactly as published on Mixlr. Categories are auto-tagged from title keywords only. Audio URLs are not stored here; they are fetched fresh at runtime.',
  totalOnChannel: recs.length,
  skipped: skipped.map(r => ({ id: r.id, title: r.attributes.title, duration: r.attributes.duration, access: r.attributes.access_level })),
  items,
};
fs.writeFileSync('catalog.json', JSON.stringify(catalog, null, 1));

const yt = JSON.parse(fs.readFileSync(ytPath, 'utf8'));
const seen = new Set();
const ytItems = [];
for (const v of yt) {
  if (!v.video_id || !v.title || seen.has(v.video_id)) continue;
  seen.add(v.video_id);
  ytItems.push({ id: 'yt:' + v.video_id, videoId: v.video_id, title: v.title.trim(), url: `https://www.youtube.com/watch?v=${v.video_id}`, length: v.length || '', duration: parseLength(v.length), kind: 'youtube' });
}
fs.writeFileSync('youtube.json', JSON.stringify({ note: 'Saturday Bible Study videos on YouTube (real titles). Opened on YouTube, not played in-app.', items: ytItems }, null, 1));

const counts = {};
for (const c of [...CATEGORIES, UNCATEGORISED]) counts[c] = items.filter(i => i.categories.includes(c)).length;
console.log('channel total', recs.length, 'included', items.length, 'skipped', skipped.length);
console.log('youtube', ytItems.length, 'of', yt.length);
console.log('categories', counts);
console.log('series', [...new Set(items.map(i => i.series).filter(Boolean))]);
console.log('generic titles', items.filter(i => i.genericTitle).length);
