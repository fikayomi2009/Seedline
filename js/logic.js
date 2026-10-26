// Pure logic shared by the app, the catalog generator and the unit tests.
// No DOM access in this file.

// ---------- Sources ----------
// Every place Seedline streams audio from. Audio always plays from the original public host.
// type: mixlr | podcast | sermonindex.  label: official | community.
export const SOURCES = [
  { key: 'ls-gboko', type: 'mixlr', label: 'official', name: 'Living Seed Gboko (Mixlr)', short: 'Living Seed Gboko', channel: 'living-seed-gboko', idPrefix: 'mx:', home: 'https://living-seed-gboko.mixlr.com/' },
  { key: 'ph-abuja', type: 'mixlr', label: 'official', name: 'Peace House Abuja (Mixlr)', short: 'Peace House Abuja', channel: 'peacehouseabuja', idPrefix: 'mxa:', home: 'https://peacehouseabuja.mixlr.com/' },
  { key: 'pod-temi', type: 'podcast', label: 'community', name: "Bro Gbile Akanni`s Messages (community podcast, unofficial)", short: 'Community podcast', feed: 'https://anchor.fm/s/fc980da8/podcast/rss', filter: 'all', home: 'https://podcasts.apple.com/us/podcast/bro-gbile-akanni-s-messages/id1781023610' },
  { key: 'pod-eagle', type: 'podcast', label: 'community', name: "God's Eagle Ministries podcast (community, unofficial)", short: "God's Eagle podcast", feed: 'https://anchor.fm/s/18271b00/podcast/rss', filter: 'gbile-only', home: 'https://podcasts.apple.com/us/podcast/ambassador-monday-o-ogbe-gods-eagle-ministries-podcast/id1504998241' },
  { key: 'pod-maranatha', type: 'podcast', label: 'community', name: 'Maranatha Teaching Podcast (community, unofficial)', short: 'Maranatha podcast', feed: 'https://rss.buzzsprout.com/1857554.rss', filter: 'gbile-only', home: 'https://podcasts.apple.com/us/podcast/maranatha-teaching-podcast/id1587098876' },
  { key: 'pod-cmirror', type: 'podcast', label: 'community', name: 'Christian Mirror Podcast (community, unofficial)', short: 'Christian Mirror podcast', feed: 'https://anchor.fm/s/89e1cac4/podcast/rss', filter: 'gbile-only', home: 'https://podcasts.apple.com/us/podcast/christian-mirror-podcast/id1864330431' },
  { key: 'pod-kgm', type: 'podcast', label: 'community', name: 'Kingdom Grace Media podcast (community, unofficial)', short: 'Kingdom Grace podcast', feed: 'https://anchor.fm/s/2f765460/podcast/rss', filter: 'gbile-only', home: 'https://podcasts.apple.com/us/podcast/kingdom-grace-media-share4christ/id1526571935' },
  { key: 'pod-btfy', type: 'podcast', label: 'community', name: 'Gbile Akani: Battle For The Young (community podcast, unofficial)', short: 'Battle For The Young podcast', feed: 'https://www.spreaker.com/show/4357837/episodes/feed', filter: 'all', home: 'https://www.spreaker.com/show/4357837' },
  { key: 'sermonindex', type: 'sermonindex', label: 'community', name: 'SermonIndex (third-party sermon archive)', short: 'SermonIndex', speakerPage: 'https://sermonindex.net/speakers/gbile-akanni/', home: 'https://sermonindex.net/speakers/gbile-akanni/' },
];
export const SOURCE_BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));
export const MIXLR_SOURCES = SOURCES.filter((s) => s.type === 'mixlr');
export const SOURCE_RANK = new Map(SOURCES.map((s, i) => [s.key, i]));

export const mixlrListUrl = (channel, page = 1) =>
  `https://apicdn.mixlr.com/v3/channels/${channel}/recordings?page%5Bnumber%5D=${page}&page%5Bsize%5D=50`;
export const mixlrPageUrl = (channel, id) => `https://${channel}.mixlr.com/recordings/${id}`;
export const mixlrSourceForId = (id) => MIXLR_SOURCES.find((s) => String(id).startsWith(s.idPrefix)) || null;

// Back-compat names for the original single channel.
export const MIXLR_CHANNEL = 'living-seed-gboko';
export const MIXLR_LIST_URL = mixlrListUrl(MIXLR_CHANNEL);
export const MIXLR_PAGE_URL = (id) => mixlrPageUrl(MIXLR_CHANNEL, id);
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
  const m = /(\d{4})-\d{2}-\d{2}/.exec(iso || '');
  return m ? Number(m[1]) : null;
}

// Series only from clear title patterns.
export function parseSeries(title, createdAt) {
  const t = (title || '').trim();
  let m = /^Bible Study\s*(\d+)\s*:\s*(.+?)\s+[-–]\s+(.+)$/i.exec(t);
  if (m) return { series: titleCase(m[2]), episode: Number(m[1]), subtitle: m[3].trim() };
  m = /^Bible Study\s*(\d+)\s*:\s*(.+)$/i.exec(t);
  if (m) return { series: 'Bible Study', episode: Number(m[1]), subtitle: m[2].trim() };
  m = /\b(MLR|SAYCO|CLR)[\s,._]*(20\d\d)\b/i.exec(t);
  if (m && !/^MLR\b/i.test(t)) return { series: `${m[1].toUpperCase()} ${m[2]}`, episode: null, subtitle: null };
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

// Who the title names as speaker. Only what the title says; nothing guessed.
export function speakerFromTitle(title, fallback) {
  const t = String(title || '');
  const otherSpeaker = /\bby\s+(?!(bro\.?\s*|brother\s*)?gbile)[a-z]+\s+[a-z]+/i.test(t) && !/\bby\s+(bro\.?\s*|brother\s*)?gbile/i.test(t);
  if (/gbile/i.test(t) && !otherSpeaker) return 'Bro Gbile Akanni';
  const m = /\bby\s+(sade akanni)\b|\.{2,}\s*(sade akanni)\b/i.exec(t);
  if (m) return 'Sade Akanni (named in title)';
  return fallback;
}
// Mixed podcast feeds: keep an episode only when its title clearly credits Bro Gbile Akanni as the speaker.
const ATTRIB = /\bby\s+(bro\.?\s*|brother\s*)?gbile\s+akann?i|gbile akann?i[`'’]?s?\s+messages|^\s*(bro\.?|brother)\s+gbile\s+akann?i\b|(\|\||\s-|\/\/)\s*(bro\.?\s*|brother\s*)?gbile\s+akann?i/i;
export function podcastKeep(src, title) {
  if (src.filter === 'all') return true;
  return ATTRIB.test(title) && speakerFromTitle(title, '') === 'Bro Gbile Akanni';
}
export const SPEAKER_NOT_STATED = 'Living Seed / Peace House (speaker not stated)';

// Turn one Mixlr API recording into a catalog entry (no audio URL - those expire).
export function catalogEntryFromMixlr(r, source = MIXLR_SOURCES[0]) {
  const a = r.attributes;
  const s = parseSeries(a.title, a.created_at);
  const art = (a.media && a.media.artwork && a.media.artwork.image) || {};
  return {
    id: source.idPrefix + r.id,
    mixlrId: String(r.id),
    channel: source.channel,
    title: (a.title || '').trim(),
    genericTitle: isGenericTitle(a.title),
    speaker: speakerFromTitle(a.title, SPEAKER_NOT_STATED),
    series: s.series,
    episode: s.episode,
    subtitle: s.subtitle,
    date: dateOf(a.created_at),
    year: yearOf(a.created_at),
    duration: Number(a.duration) || 0,
    categories: categorise(a.title),
    categorySource: 'auto-tagged',
    artwork: art.small || null,
    artworkLarge: art.medium || art.large || null,
    source: source.name,
    sourceKey: source.key,
    sourceType: 'mixlr',
    label: source.label,
    sourceUrl: mixlrPageUrl(source.channel, r.id),
    kind: 'mixlr',
  };
}

export function dateOf(s) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(s || '');
  return m ? m[1] : '';
}

// Merge static catalog with live API results. Live wins for title/artwork; live adds new items.
// liveRecordings: Mixlr API records; each may carry `_source` (a source key) - default Living Seed Gboko.
// Recordings already folded into another entry as an alternate only refresh their URL.
// Returns { items, urls } where urls maps id -> fresh audio url (for main entries and alternates).
export function mergeLibrary(catalogItems, liveRecordings) {
  const byId = new Map(catalogItems.map((it) => [it.id, { ...it, inLive: it.kind === 'mixlr' ? false : undefined }]));
  const altIds = new Set();
  for (const it of catalogItems) for (const a of it.alts || []) altIds.add(a.id);
  const urls = {};
  for (const r of liveRecordings || []) {
    if (!isPlayableRecording(r)) continue;
    const src = SOURCE_BY_KEY.get(r._source) || MIXLR_SOURCES[0];
    const e = catalogEntryFromMixlr(r, src);
    if (r.attributes.url) urls[e.id] = r.attributes.url;
    if (altIds.has(e.id)) continue;
    const old = byId.get(e.id);
    byId.set(e.id, old ? { ...old, title: e.title, artwork: e.artwork || old.artwork, artworkLarge: e.artworkLarge || old.artworkLarge, duration: e.duration || old.duration, inLive: true } : { ...e, inLive: true, notInCatalog: true });
  }
  const items = [...byId.values()].sort(byDateDesc);
  return { items, urls };
}

export const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (a.series || '').localeCompare(b.series || '') || (a.episode ?? 0) - (b.episode ?? 0) || a.id.localeCompare(b.id);

// ---------- Multi-source helpers (used by the catalog builder and tests) ----------
// Title with speaker credits and filler removed, for conservative matching.
export function coreTitle(title) {
  let t = String(title || '').toLowerCase().normalize('NFKD').replace(/[\u2018\u2019`]/g, "'");
  t = t.replace(/^\s*\d{1,2}\s*-\s*/, '');                               // "10 - MESSAGE 3 ..."
  t = t.replace(/\b(by\s+)?(bro\.?|brother)?\s*gbile\s+akann?i('?s)?(\s+messages?)?\b/g, ' ');
  t = t.replace(/\bmessages?\s*:/g, ' ');
  t = t.replace(/\bpt\.?\s*(\d)/g, 'part $1').replace(/\bpart\s*(\d+)/g, 'part $1');
  t = t.replace(/\b(by|bro|brother)\s*$/g, ' ');
  t = t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(by|bro|brother)\s+/, '').replace(/\s+(by|bro|brother)$/, '');
  return t;
}

const GENERIC_CORES = /^(bible study( with)?( w)?|online bible study saturdays with|bible study part \d+|morning broadcast|evening broadcast|morning session|discipleship class|devotion \d*|couples testimony|prayer uproar tips)?$/;
export function isGenericCore(core) {
  return !core || core.length < 12 || GENERIC_CORES.test(core) || / on mixlr$| live audio$/.test(core);
}

// Same recording? Exact core-title match AND durations within max(90 s, 3%). Conservative on purpose:
// two different preachings with one title (common) must not merge.
export function sameRecording(a, b) {
  const ca = coreTitle(a.title), cb = coreTitle(b.title);
  if (isGenericCore(ca) || ca !== cb) return false;
  if (!a.duration || !b.duration) return false;
  // Two entries from the SAME source are only one recording if they are an exact re-post.
  if (a.sourceKey && a.sourceKey === b.sourceKey) return Math.abs(a.duration - b.duration) <= 2;
  return Math.abs(a.duration - b.duration) <= Math.max(90, 0.03 * Math.max(a.duration, b.duration));
}

const altOf = (it) => ({ id: it.id, source: it.source, sourceKey: it.sourceKey, sourceType: it.sourceType, label: it.label, sourceUrl: it.sourceUrl, audioUrl: it.audioUrl || null, channel: it.channel || null, mixlrId: it.mixlrId || null, title: it.title, duration: it.duration });

// Fold duplicates into one entry with `alts`, preferring official sources, then source order.
export function dedupe(items) {
  const rank = (it) => (it.label === 'official' ? 0 : 100) + (SOURCE_RANK.get(it.sourceKey) ?? 50);
  const sorted = items.slice().sort((a, b) => rank(a) - rank(b) || (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id));
  const out = [];
  const byCore = new Map();
  let merged = 0;
  for (const it of sorted) {
    const core = coreTitle(it.title);
    const cands = isGenericCore(core) ? [] : byCore.get(core) || [];
    const hit = cands.find((c) => sameRecording(c, it));
    if (hit) {
      hit.alts = hit.alts || [];
      hit.alts.push(altOf(it));
      if (!hit.artwork && it.artwork) { hit.artwork = it.artwork; hit.artworkLarge = it.artworkLarge; }
      merged++;
      continue;
    }
    const copy = { ...it };
    out.push(copy);
    if (!isGenericCore(core)) { if (!byCore.has(core)) byCore.set(core, []); byCore.get(core).push(copy); }
  }
  return { items: out.sort(byDateDesc), merged };
}

// "Bible Study 19: Devotions Of A Disciple - ..." -> { n: 19, series: 'devotions of a disciple' }
export function bibleStudyKey(title) {
  const m = /^\s*bible study\s*(\d+)\s*[:\-–]\s*(.+)$/i.exec(String(title || ''));
  if (!m) return null;
  const rest = coreTitle(m[2].split(/\s[-–]\s/).filter((p) => !/gbile/i.test(p))[0] || '');
  return rest ? { n: Number(m[1]), series: rest } : null;
}

// Conservative audio <-> YouTube matching. Returns Map(audioId -> youtube item).
// A match needs either the same non-generic core title (unique on both sides), or the same
// "Bible Study N" number AND the same series name (unique on the YouTube side).
export function matchYouTube(audioItems, ytItems) {
  const ytByCore = new Map(), ytByBS = new Map();
  for (const y of ytItems) {
    const c = coreTitle(y.title);
    if (!isGenericCore(c)) ytByCore.set(c, ytByCore.has(c) ? null : y);
    const k = bibleStudyKey(y.title);
    if (k) { const kk = k.n + '|' + k.series; ytByBS.set(kk, ytByBS.has(kk) ? null : y); }
  }
  const audioCoreCount = new Map();
  for (const a of audioItems) { const c = coreTitle(a.title); audioCoreCount.set(c, (audioCoreCount.get(c) || 0) + 1); }
  const out = new Map();
  for (const a of audioItems) {
    const c = coreTitle(a.title);
    let y = !isGenericCore(c) && audioCoreCount.get(c) === 1 ? ytByCore.get(c) : null;
    if (!y) { const k = bibleStudyKey(a.title); if (k) y = ytByBS.get(k.n + '|' + k.series) || null; }
    if (y) out.set(a.id, y);
  }
  return out;
}

// Series from "Part N" titles (only kept by the builder when 2+ parts share the name).
export function partSeries(title) {
  const t = String(title || '');
  const m = /^(.*?)\s*(?:[-–(,:]|\/\/)?\s*\b(?:part|pt)\.?\s*(\d+)\b/i.exec(t.replace(/^bro\.? gbile akanni\s*\/\/\s*/i, ''));
  if (!m) return null;
  let name = m[1].replace(/\s*(?:[-–(,|]|by)\s*(bro\.?\s*|brother\s*)?gbile akann?i\s*$/i, '').replace(/[\s\-–(,:/]+$/, '').trim();
  if (name.length < 6) return null;
  return { series: name, episode: Number(m[2]) };
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
    const hay = normalise([it.title, it.series, it.subtitle, (it.categories || []).join(' '), it.year, it.source, it.speaker].join(' '));
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
