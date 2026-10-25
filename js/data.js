// Library data: static catalog + live Mixlr API + optional admin (Supabase) data.
import { MIXLR_LIST_URL, mergeLibrary, applyOverrides, diffNew, isPlayableRecording } from './logic.js';
import * as store from './store.js';
import { getSupabase } from './supa.js';

export const state = {
  items: [],          // playable library items (Mixlr + admin-added)
  byId: new Map(),
  urls: {},           // id -> fresh signed audio URL (never persisted)
  youtube: [],
  featured: [],       // admin featured playlists (Supabase)
  liveOk: false,      // did the live Mixlr API answer?
  liveError: null,
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

// Fetch every page of recordings from the public Mixlr API.
export async function fetchLiveRecordings() {
  const all = [];
  let url = MIXLR_LIST_URL;
  let guard = 0;
  while (url && guard++ < 20) {
    const j = await fetchJSON(url, { cache: 'no-store' });
    all.push(...(j.data || []));
    url = j.links && j.links.next ? j.links.next.replace('https://api.mixlr.com/', 'https://apicdn.mixlr.com/') : null;
  }
  return all;
}

function rebuild(live) {
  const { items, urls } = mergeLibrary(catalog, live || []);
  if (live) Object.assign(state.urls, urls);
  state.items = applyOverrides(items, overrides);
  state.byId = new Map(state.items.map((i) => [i.id, i]));
  for (const y of state.youtube) state.byId.set(y.id, y);
}

let lastLive = null;

export async function loadLibrary() {
  const [cat, yt] = await Promise.all([
    fetchJSON('./catalog.json').catch(() => ({ items: [] })),
    fetchJSON('./youtube.json').catch(() => ({ items: [] })),
  ]);
  catalog = cat.items || [];
  state.youtube = yt.items || [];
  rebuild(null);
  emit();
  loadAdminData(); // optional, in background
  await checkLive();
}

// Fetch the live list; update URLs and the "new" list. Returns { ok, newIds, error }.
export async function checkLive() {
  try {
    const live = await fetchLiveRecordings();
    lastLive = live;
    state.liveOk = true;
    state.liveError = null;
    state.liveCheckedAt = Date.now();
    rebuild(live);
    const liveIds = live.filter(isPlayableRecording).map((r) => 'mx:' + r.id);
    const lastSeen = store.get('lastSeenIds', null);
    const { newIds, seen, firstRun } = diffNew(liveIds, lastSeen);
    if (firstRun) store.set('lastSeenIds', seen);
    // keep earlier un-dismissed "new" ids too
    const pending = new Set([...store.get('pendingNew', []), ...newIds]);
    state.newIds = [...pending].filter((id) => state.byId.has(id));
    store.set('pendingNew', state.newIds);
    store.set('lastCheck', state.liveCheckedAt);
    emit();
    return { ok: true, newIds: state.newIds, fresh: newIds, firstRun };
  } catch (e) {
    console.warn('Live Mixlr fetch failed', e);
    state.liveOk = false;
    state.liveError = String(e.message || e);
    state.newIds = store.get('pendingNew', []).filter((id) => state.byId.has(id));
    emit();
    return { ok: false, error: state.liveError, newIds: state.newIds };
  }
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

// Signed Mixlr links expire (about 7 days). Get a fresh one.
export async function refreshUrl(id) {
  const live = await fetchLiveRecordings();
  lastLive = live;
  rebuild(live);
  state.liveOk = true;
  emit();
  return state.urls[id] || null;
}

export function audioUrlFor(item) {
  if (!item) return null;
  if (item.kind === 'admin') return item.audioUrl || null;
  return state.urls[item.id] || null;
}

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
    rebuild(lastLive);
    emit();
  } catch (e) {
    console.warn('Admin data not loaded', e);
  }
}
