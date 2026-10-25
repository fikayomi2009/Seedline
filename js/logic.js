// Pure logic shared by the app, the catalog generator and the unit tests.
// No DOM access in this file.

export const MIXLR_CHANNEL = 'living-seed-gboko';
export const MIXLR_LIST_URL =
  'https://apicdn.mixlr.com/v3/channels/living-seed-gboko/recordings?page%5Bnumber%5D=1&page%5Bsize%5D=50';
export const MIXLR_PAGE_URL = (id) => `https://living-seed-gboko.mixlr.com/recordings/${id}`;
export const SOURCE_NAME = 'Living Seed Gboko (Mixlr)';

// Recordings shorter than this are test/blank uploads on the channel (0-63 s clips
// titled only "... on Mixlr"). We skip anything under 60 seconds.
export const MIN_DURATION_SECS = 60;

export const CATEGORIES = ['Discipleship', 'Prayer', 'Holiness', 'Revival', 'Faith', 'Christian Living'];
export const UNCATEGORISED = 'Uncategorised';

// Category = only when the title clearly contains one of these keywords.
export const CATEGORY_RULES = [
  ['Discipleship', /discipl/i],
  ['Prayer', /\bpray|\bprayer|intercess|\baltar\b|\bcommunion\b/i],
  ['Holiness', /\bholy\b|holiness|pure in heart|sanctif|crucified/i],
  ['Revival', /reviv|fresh encounter|\bawake/i],
  ['Faith', /\bfaith\b|\bbeliev/i],
  ['Christian Living', /marriage|husband|\bwife|wifely|destiny mate|\bwoman\b|lifestyle|\bliving\b|beatitude|blessed are|storms of life/i],
];

// Titles that are just Mixlr's automatic names (or not a message title at all).
export function isGenericTitle(title) {
  const t = (title || '').trim();
  return /on mixlr$/i.test(t) || /'s live audio$/i.test(t) || /^[+\d][\d\s,+-]{6,}$/.test(t) || t === '';
}

export function categorise(title) {
  if (isGenericTitle(title)) return [UNCATEGORISED];
  const cats = CATEGORY_RULES.filter(([, re]) => re.test(title)).map(([c]) => c);
  return cats.length ? cats : [UNCATEGORISED];
}

export function yearOf(iso) {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(iso || '');
  return m ? Number(m[1]) : null;
}

// Series only from clear title patterns.
export function parseSeries(title, createdAt) {
  const t = (title || '').trim();
  let m = /^Bible Study\s*(\d+)\s*:\s*(.+?)\s+[-–]\s+(.+)$/i.exec(t);
  if (m) return { series: titleCase(m[2]), episode: Number(m[1]), subtitle: m[3].trim() };
  m = /^Bible Study\s*(\d+)\s*:\s*(.+)$/i.exec(t);
  if (m) return { series: 'Bible Study', episode: Number(m[1]), subtitle: m[2].trim() };
  if (/^MLR\b/i.test(t)) {
    const y = (/\b(20\d\d)\b/.exec(t) || [])[1] || yearOf(createdAt);
    return { series: `MLR ${y}`, episode: null, subtitle: null };
  }
  m = /^UK SOLEMN ASSEMBLY/i.exec(t);
  if (m) {
    const y = (/\b(20\d\d)\b/.exec(t) || [])[1] || yearOf(createdAt);
    return { series: `UK Solemn Assembly ${y}`, episode: null, subtitle: null };
  }
  return { series: null, episode: null, subtitle: null };
}

function titleCase(s) {
  return s.trim().replace(/\s+/g, ' ');
}

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function isPlayableRecording(r) {
  const a = (r && r.attributes) || {};
  return a.access_level === 'public' && Number(a.duration) >= MIN_DURATION_SECS;
}

// Turn one Mixlr API recording into a catalog entry (no audio URL - those expire).
export function catalogEntryFromMixlr(r) {
  const a = r.attributes;
  const s = parseSeries(a.title, a.created_at);
  const art = (a.media && a.media.artwork && a.media.artwork.image) || {};
  return {
    id: 'mx:' + r.id,
    mixlrId: String(r.id),
    title: (a.title || '').trim(),
    genericTitle: isGenericTitle(a.title),
    series: s.series,
    episode: s.episode,
    subtitle: s.subtitle,
    date: (a.created_at || '').slice(0, 10),
    year: yearOf(a.created_at),
    duration: Number(a.duration) || 0,
    categories: categorise(a.title),
    categorySource: 'auto-tagged',
    artwork: art.small || null,
    artworkLarge: art.medium || art.large || null,
    source: SOURCE_NAME,
    sourceUrl: MIXLR_PAGE_URL(r.id),
    kind: 'mixlr',
  };
}

// Merge static catalog with live API results. Live wins for title/artwork; live adds new items.
// Returns { items, urls } where urls maps id -> fresh audio url.
export function mergeLibrary(catalogItems, liveRecordings) {
  const byId = new Map(catalogItems.map((it) => [it.id, { ...it, inLive: false }]));
  const urls = {};
  for (const r of liveRecordings || []) {
    if (!isPlayableRecording(r)) continue;
    const e = catalogEntryFromMixlr(r);
    const old = byId.get(e.id);
    byId.set(e.id, old ? { ...old, title: e.title, artwork: e.artwork || old.artwork, artworkLarge: e.artworkLarge || old.artworkLarge, duration: e.duration || old.duration, inLive: true } : { ...e, inLive: true, notInCatalog: true });
    if (r.attributes.url) urls[e.id] = r.attributes.url;
  }
  const items = [...byId.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  return { items, urls };
}

// Apply admin overrides (from Supabase) onto items.
export function applyOverrides(items, rows) {
  const byMixlr = new Map();
  const extra = [];
  for (const row of rows || []) {
    if (row.mixlr_id) byMixlr.set(String(row.mixlr_id), row);
    else extra.push(row);
  }
  const out = [];
  for (const it of items) {
    const o = it.mixlrId ? byMixlr.get(it.mixlrId) : null;
    if (!o) { out.push(it); continue; }
    if (o.hidden) continue;
    out.push({
      ...it,
      title: o.title || it.title,
      originalTitle: it.title,
      series: o.series || it.series,
      categories: o.category ? [o.category] : it.categories,
      categorySource: o.category ? 'admin' : it.categorySource,
    });
  }
  for (const o of extra) {
    if (o.hidden || !o.title) continue;
    out.push({
      id: 'sb:' + o.id,
      title: o.title,
      series: o.series || null,
      date: (o.recorded_on || o.created_at || '').slice(0, 10),
      year: yearOf(o.recorded_on || o.created_at),
      duration: Number(o.duration_secs) || 0,
      categories: o.category ? [o.category] : [UNCATEGORISED],
      categorySource: 'admin',
      artwork: o.artwork_url || null,
      artworkLarge: o.artwork_url || null,
      source: 'Added by admin',
      sourceUrl: o.source_url || null,
      audioUrl: o.audio_url || null,
      needsPermission: !!o.audio_url,
      kind: 'admin',
    });
  }
  return out;
}

// ---------- Discover new ----------
// lastSeen === null means first run: everything becomes "seen", nothing is new.
export function diffNew(liveIds, lastSeen) {
  if (!Array.isArray(lastSeen)) return { newIds: [], seen: [...liveIds], firstRun: true };
  const seenSet = new Set(lastSeen);
  const newIds = liveIds.filter((id) => !seenSet.has(id));
  return { newIds, seen: lastSeen, firstRun: false };
}

// ---------- Search ----------
export function normalise(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function searchItems(items, query) {
  const q = normalise(query);
  if (!q) return [];
  const words = q.split(' ');
  const scored = [];
  for (const it of items) {
    const hay = normalise([it.title, it.series, it.subtitle, (it.categories || []).join(' '), it.year, it.source].join(' '));
    if (!words.every((w) => hay.includes(w))) continue;
    const t = normalise(it.title);
    let score = 0;
    if (t.startsWith(q)) score += 3;
    if (t.includes(q)) score += 2;
    if (normalise(it.series).includes(q)) score += 1;
    scored.push([score, it]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.map((x) => x[1]);
}

// ---------- Queue ----------
export function shuffled(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns the index to play after `index` in a queue of length n, or -1 to stop.
export function nextIndex(index, n, repeat) {
  if (n === 0) return -1;
  if (repeat === 'one') return index;
  if (index + 1 < n) return index + 1;
  return repeat === 'all' ? 0 : -1;
}

export function prevIndex(index, n, repeat) {
  if (n === 0) return -1;
  if (index - 1 >= 0) return index - 1;
  return repeat === 'all' ? n - 1 : 0;
}

export function moveItem(arr, from, to) {
  const a = arr.slice();
  if (from < 0 || from >= a.length || to < 0 || to >= a.length) return a;
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

export function fmtTime(secs) {
  secs = Math.max(0, Math.floor(Number(secs) || 0));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDuration(secs) {
  secs = Number(secs) || 0;
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}

// "1h 57m" / "57m" / "1:02:03" -> seconds
export function parseLength(s) {
  s = String(s || '');
  let m = /(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/.exec(s);
  if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  const p = s.split(':').map(Number);
  if (p.every((x) => !isNaN(x)) && p.length > 1) return p.reduce((acc, x) => acc * 60 + x, 0);
  return 0;
}
