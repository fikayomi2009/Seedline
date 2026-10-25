// Library data: static catalog + live Mixlr API + optional admin (Supabase) data.
import { MIXLR_SOURCES, SOURCE_BY_KEY, mixlrListUrl, mixlrSourceForId, mergeLibrary, applyOverrides, diffNew, isPlayableRecording } from './logic.js';
import * as store from './store.js';
import { getSupabase } from './supa.js';

export const state = {
  items: [],          // playable library items (Mixlr + admin-added)
  byId: new Map(),
  urls: {},           // id -> fresh signed audio URL (never persisted)
  youtube: [],
  featured: [],       // admin featured playlists (Supabase)
  liveOk: false,      // did the live Mixlr API answer (at least one channel)?
  liveError: null,
  liveErrors: {},     // source key -> error text, for channels that failed
  sources: {},        // per-source info from catalog.json
  liveCheckedAt: null,
  newIds: [],
  adminData: false,
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); }

let catalog = [];
let overrides = [];

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

// Fetch every page of recordings of one Mixlr channel from the public API. Each record is tagged with its source.
export async function fetchLiveRecordings(src = MIXLR_SOURCES[0]) {
  const all = [];
  let url = mixlrListUrl(src.channel);
  let guard = 0;
  while (url && guard++ < 40) {
    const j = await fetchJSON(url, { cache: 'no-store' });
    for (const r of j.data || []) { r._source = src.key; all.push(r); }
    url = j.links && j.links.next ? j.links.next.replace('https://api.mixlr.com/', 'https://apicdn.mixlr.com/') : null;
  }
  return all;
}

const liveBySource = {}; // source key -> last live recordings
function liveAll() {
  const keys = Object.keys(liveBySource);
  return keys.length ? keys.flatMap((k) => liveBySource[k]) : null;
}

function rebuild() {
  const live = liveAll();
  const { items, urls } = mergeLibrary(catalog, live || []);
  if (live) Object.assign(state.urls, urls);
  state.items = applyOverrides(items, overrides);
  state.byId = new Map(state.items.map((i) => [i.id, i]));
  for (const y of state.youtube) state.byId.set(y.id, y);
}

export async function loadLibrary() {
  const [cat, yt] = await Promise.all([
    fetchJSON('./catalog.json').catch(() => ({ items: [] })),
    fetchJSON('./youtube.json').catch(() => ({ items: [] })),
  ]);
  catalog = cat.items || [];
  state.sources = cat.sources || {};
  state.youtube = yt.items || [];
  rebuild();
  emit();
  loadAdminData(); // optional, in background
  await checkLive();
}

// Fetch the live lists of every Mixlr channel; update URLs and the "new" list. Returns { ok, newIds, error }.
export async function checkLive() {
  const res = await Promise.allSettled(MIXLR_SOURCES.map((s) => fetchLiveRecordings(s)));
  const okKeys = [];
  state.liveErrors = {};
  res.forEach((r, i) => {
    const key = MIXLR_SOURCES[i].key;
    if (r.status === 'fulfilled') { liveBySource[key] = r.value; okKeys.push(key); }
    else state.liveErrors[key] = String((r.reason && r.reason.message) || r.reason);
  });
  if (!okKeys.length) {
    console.warn('Live Mixlr fetch failed', state.liveErrors);
    state.liveOk = false;
    state.liveError = Object.values(state.liveErrors)[0] || 'unknown error';
    state.newIds = store.get('pendingNew', []).filter((id) => state.byId.has(id));
    emit();
    return { ok: false, error: state.liveError, newIds: state.newIds };
  }
  state.liveOk = true;
  state.liveError = null;
  state.liveCheckedAt = Date.now();
  rebuild();
  let lastSeen = store.get('lastSeenIds', null);
  // A channel added after the user's first visit: treat its whole back catalogue as already seen.
  let seenSources = store.get('seenSources', null);
  if (!seenSources) seenSources = Array.isArray(lastSeen) ? ['ls-gboko'] : [];
  const newIds = [];
  let firstRun = false;
  for (const key of okKeys) {
    const src = SOURCE_BY_KEY.get(key);
    const ids = liveBySource[key].filter(isPlayableRecording).map((r) => src.idPrefix + r.id);
    if (!seenSources.includes(key) || !Array.isArray(lastSeen)) {
      if (!Array.isArray(lastSeen)) firstRun = true;
      lastSeen = [...new Set([...(lastSeen || []), ...ids])];
      if (!seenSources.includes(key)) seenSources.push(key);
      continue;
    }
    newIds.push(...diffNew(ids, lastSeen).newIds);
  }
  store.set('lastSeenIds', lastSeen);
  store.set('seenSources', seenSources);
  // keep earlier un-dismissed "new" ids too
  const pending = new Set([...store.get('pendingNew', []), ...newIds]);
  state.newIds = [...pending].filter((id) => state.byId.has(id));
  store.set('pendingNew', state.newIds);
  store.set('lastCheck', state.liveCheckedAt);
  emit();
  return { ok: true, newIds: state.newIds, fresh: newIds, firstRun, partial: Object.keys(state.liveErrors) };
}

// Mark everything currently listed as seen (clears the New badge).
export function markAllSeen() {
  const ids = state.items.filter((i) => i.kind === 'mixlr' && i.inLive).map((i) => i.id);
  const prev = store.get('lastSeenIds', []) || [];
  store.set('lastSeenIds', [...new Set([...prev, ...ids])]);
  store.set('pendingNew', []);
  state.newIds = [];
  emit();
}

export function markSeen(id) {
  if (!state.newIds.includes(id)) return;
  const prev = store.get('lastSeenIds', []) || [];
  store.set('lastSeenIds', [...new Set([...prev, id])]);
  state.newIds = state.newIds.filter((x) => x !== id);
  store.set('pendingNew', state.newIds);
  emit();
}

// Signed Mixlr links expire (about 7 days). Get a fresh one from the channel that owns this id.
export async function refreshUrl(id) {
  const src = mixlrSourceForId(id) || MIXLR_SOURCES[0];
  liveBySource[src.key] = await fetchLiveRecordings(src);
  rebuild();
  state.liveOk = true;
  emit();
  return state.urls[id] || null;
}

// Where an entry (or one of its alternates) streams from.
// Podcast / SermonIndex: the publisher's own static file URL. Mixlr: a fresh signed link.
export function audioUrlFor(item, alt = null) {
  const x = alt || item;
  if (!x) return null;
  if (x.audioUrl && x.sourceType !== 'mixlr') return x.audioUrl;
  if (item && item.kind === 'admin' && !alt) return item.audioUrl || null;
  return state.urls[x.id] || null;
}
export const isMixlrRef = (x) => !!x && (x.sourceType === 'mixlr' || x.kind === 'mixlr');

// ---- Optional Supabase admin data ----
export async function loadAdminData() {
  const sb = await getSupabase();
  if (!sb) return;
  try {
    const [m, f] = await Promise.all([
      sb.from('messages').select('*'),
      sb.from('featured_playlists').select('*').order('sort', { ascending: true }),
    ]);
    if (m.error) throw m.error;
    overrides = m.data || [];
    state.featured = (f.data || []).filter((p) => !p.hidden);
    state.adminData = true;
    rebuild();
    emit();
  } catch (e) {
    console.warn('Admin data not loaded', e);
  }
}
