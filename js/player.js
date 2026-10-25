// One <audio> element, a continuous queue, Media Session (lock-screen) controls,
// and per-device saving of position, queue, volume, shuffle and repeat.
import * as store from './store.js';
import { state as lib, audioUrlFor, refreshUrl, markSeen } from './data.js';
import { nextIndex, prevIndex, shuffled, moveItem } from './logic.js';

export const audio = new Audio();
audio.preload = 'metadata';
audio.setAttribute('playsinline', '');
document.body && document.body.appendChild(audio);

const saved = store.get('player', {});
export const P = {
  queue: Array.isArray(saved.queue) ? saved.queue : [],
  original: Array.isArray(saved.original) ? saved.original : null, // order before shuffle
  index: Number.isInteger(saved.index) ? saved.index : -1,
  shuffle: !!saved.shuffle,
  repeat: ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off',
  volume: typeof saved.volume === 'number' ? saved.volume : 1,
  loadedId: null,
  loading: false,
  error: null,
};
audio.volume = P.volume;

const listeners = new Set();
export function onPlayer(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let emitQueued = false;
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; listeners.forEach((fn) => { try { fn(P); } catch (e) { console.error(e); } }); });
}

function persist() {
  store.set('player', { queue: P.queue, original: P.original, index: P.index, shuffle: P.shuffle, repeat: P.repeat, volume: P.volume });
}

export const current = () => (P.index >= 0 ? lib.byId.get(P.queue[P.index]) : null);
export const isPlaying = () => !audio.paused && !audio.ended;
const playable = (id) => { const it = lib.byId.get(id); return it && it.kind !== 'youtube'; };

// ---------- progress saving ----------
let lastSave = 0;
function saveProgress(force) {
  const it = current();
  if (!it || P.loadedId !== it.id || !isFinite(audio.currentTime) || audio.currentTime < 1) return;
  const now = Date.now();
  if (!force && now - lastSave < 5000) return;
  lastSave = now;
  store.progress.save(it.id, audio.currentTime, audio.duration || it.duration);
}

// ---------- loading & playing ----------
let retriedFor = null;

async function loadIndex(i, { autoplay = true, resume = true } = {}) {
  if (i < 0 || i >= P.queue.length) return;
  saveProgress(true);
  P.index = i;
  P.error = null;
  persist();
  const it = current();
  if (!it) { P.error = 'This message is no longer in the library.'; emit(); return; }
  markSeen(it.id);
  updateMediaSession(it);
  let url = audioUrlFor(it);
  P.loading = true;
  emit();
  if (!url && it.kind === 'mixlr') {
    try { url = await refreshUrl(it.id); } catch (e) { /* offline */ }
  }
  if (P.queue[P.index] !== it.id) return; // user moved on meanwhile
  if (!url) {
    P.loading = false;
    P.error = navigator.onLine === false ? 'You are offline. Audio streams from Mixlr and needs internet.' : 'Could not get the audio link from Mixlr right now. Check your connection and try again.';
    emit();
    return;
  }
  P.loadedId = it.id;
  retriedFor = null;
  audio.src = url;
  const prog = store.progress.get(it.id);
  const startAt = resume && prog && prog.pos > 5 && (!prog.dur || prog.pos < prog.dur - 15) ? prog.pos : 0;
  if (startAt) {
    const seekOnce = () => { try { audio.currentTime = startAt; } catch {} };
    audio.addEventListener('loadedmetadata', seekOnce, { once: true });
  }
  if (autoplay) {
    try { await audio.play(); } catch (e) { if (e.name !== 'AbortError') { P.error = e.name === 'NotAllowedError' ? 'Tap play to start.' : 'Playback failed: ' + e.message; } }
  }
  P.loading = false;
  emit();
}

export function playQueue(ids, start = 0) {
  ids = ids.filter(playable);
  if (!ids.length) return;
  const startId = ids[Math.max(0, Math.min(start, ids.length - 1))];
  P.original = null;
  if (P.shuffle) {
    const rest = shuffled(ids.filter((x) => x !== startId));
    P.original = ids.slice();
    P.queue = [startId, ...rest];
    return loadIndex(0);
  }
  P.queue = ids.slice();
  return loadIndex(P.queue.indexOf(startId));
}

export function playId(id) { return playQueue([id], 0); }

export async function toggle() {
  const it = current();
  if (!it) return;
  if (P.loadedId !== it.id || !audio.src) return loadIndex(P.index);
  if (audio.paused) { try { await audio.play(); } catch (e) { P.error = 'Playback failed: ' + e.message; emit(); } }
  else audio.pause();
}

export function next(auto = false) {
  const n = nextIndex(P.index, P.queue.length, auto ? P.repeat : (P.repeat === 'one' ? 'all' : P.repeat));
  if (n === -1) { if (auto) { P.loadedId = current()?.id || null; audio.pause(); emit(); } return; }
  if (auto && P.repeat === 'one') { P.loadedId = current()?.id || null; audio.currentTime = 0; audio.play().catch(() => {}); return; }
  return loadIndex(n);
}

export function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const p = prevIndex(P.index, P.queue.length, P.repeat);
  if (p === -1) return;
  return loadIndex(p);
}

export function seek(t) {
  if (!isFinite(t)) return;
  const d = audio.duration;
  audio.currentTime = Math.max(0, isFinite(d) ? Math.min(t, d - 0.25) : t);
  saveProgress(true);
}
export const skip = (s) => seek(audio.currentTime + s);

export function setVolume(v) {
  P.volume = Math.max(0, Math.min(1, v));
  audio.volume = P.volume;
  persist(); emit();
}

export function toggleShuffle() {
  P.shuffle = !P.shuffle;
  const cur = P.queue[P.index];
  if (P.shuffle) {
    P.original = P.queue.slice();
    const upcoming = shuffled(P.queue.slice(P.index + 1));
    P.queue = [...P.queue.slice(0, P.index + 1), ...upcoming];
  } else if (P.original) {
    const set = new Set(P.queue);
    const restored = P.original.filter((x) => set.has(x));
    for (const x of P.queue) if (!restored.includes(x)) restored.push(x);
    P.queue = restored;
    P.index = Math.max(0, P.queue.indexOf(cur));
    P.original = null;
  }
  persist(); emit();
}

export function cycleRepeat() {
  P.repeat = P.repeat === 'off' ? 'all' : P.repeat === 'all' ? 'one' : 'off';
  persist(); emit();
}

// ---------- queue editing ----------
export function playNext(id) {
  if (!playable(id)) return;
  if (P.index < 0) return playQueue([id]);
  P.queue.splice(P.index + 1, 0, id);
  if (P.original) P.original.push(id);
  persist(); emit();
}
export function addToQueue(id) {
  if (!playable(id)) return;
  if (P.index < 0) { P.queue = [id]; P.index = 0; persist(); emit(); return loadIndex(0, { autoplay: false }); }
  P.queue.push(id);
  if (P.original) P.original.push(id);
  persist(); emit();
}
export function removeAt(i) {
  if (i === P.index || i < 0 || i >= P.queue.length) return;
  P.queue.splice(i, 1);
  if (i < P.index) P.index--;
  persist(); emit();
}
export function move(i, j) {
  if (j < 0 || j >= P.queue.length) return;
  const cur = P.queue[P.index];
  P.queue = moveItem(P.queue, i, j);
  P.index = P.queue.indexOf(cur);
  persist(); emit();
}
export function clearQueue() {
  const cur = P.queue[P.index];
  P.queue = cur ? [cur] : [];
  P.index = cur ? 0 : -1;
  P.original = null;
  persist(); emit();
}
export function jumpTo(i) { return loadIndex(i); }

// ---------- audio events ----------
audio.addEventListener('timeupdate', () => { saveProgress(false); updatePosition(); emit(); });
audio.addEventListener('play', () => { setPlaybackState('playing'); emit(); });
audio.addEventListener('playing', () => { P.loading = false; P.error = null; emit(); });
audio.addEventListener('waiting', () => { P.loading = true; emit(); });
audio.addEventListener('pause', () => { saveProgress(true); setPlaybackState('paused'); emit(); });
audio.addEventListener('loadedmetadata', () => { updatePosition(); emit(); });
audio.addEventListener('ended', () => {
  const it = current();
  P.loadedId = null; // stop saveProgress() from re-saving the finished item
  if (it) store.progress.clear(it.id);
  next(true);
});
audio.addEventListener('error', async () => {
  const it = current();
  if (!it || !audio.src) return;
  // Signed Mixlr links expire. Fetch a fresh one once, then continue from the same spot.
  if (it.kind === 'mixlr' && retriedFor !== it.id) {
    retriedFor = it.id;
    const pos = audio.currentTime || (store.progress.get(it.id) || {}).pos || 0;
    try {
      const url = await refreshUrl(it.id);
      if (url && P.queue[P.index] === it.id) {
        audio.src = url;
        audio.addEventListener('loadedmetadata', () => { if (pos) audio.currentTime = pos; }, { once: true });
        await audio.play();
        return;
      }
    } catch (e) { /* fall through */ }
  }
  P.loading = false;
  P.error = 'This audio could not be played. It may have been removed from Mixlr, or your connection dropped.';
  emit();
});
window.addEventListener('pagehide', () => saveProgress(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveProgress(true); });

// ---------- Media Session (lock screen / notification controls) ----------
const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
function updateMediaSession(it) {
  if (!ms || !it) return;
  try {
    const art = it.artworkLarge || it.artwork;
    const abs = (u) => new URL(u, location.href).href;
    ms.metadata = new MediaMetadata({
      title: it.title,
      artist: it.source || 'Living Seed Gboko (Mixlr)',
      album: it.series || 'Seedline',
      artwork: art
        ? [{ src: it.artwork || art, sizes: '256x256', type: 'image/jpeg' }, { src: art, sizes: '1024x1024', type: 'image/jpeg' }]
        : [{ src: abs('icons/icon-192.png'), sizes: '192x192', type: 'image/png' }, { src: abs('icons/icon-512.png'), sizes: '512x512', type: 'image/png' }],
    });
  } catch (e) { console.warn(e); }
}
function setPlaybackState(s) { if (ms) try { ms.playbackState = s; } catch {} }
let lastPos = 0;
function updatePosition() {
  if (!ms || !ms.setPositionState) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) return;
  const now = Date.now();
  if (now - lastPos < 1000) return;
  lastPos = now;
  try { ms.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, d) }); } catch {}
}
if (ms) {
  const h = (a, fn) => { try { ms.setActionHandler(a, fn); } catch {} };
  h('play', () => toggle());
  h('pause', () => audio.pause());
  h('previoustrack', () => prev());
  h('nexttrack', () => next());
  h('seekbackward', (d) => skip(-(d.seekOffset || 15)));
  h('seekforward', (d) => skip(d.seekOffset || 30));
  h('seekto', (d) => { if (d.fastSeek && 'fastSeek' in audio) audio.fastSeek(d.seekTime); else seek(d.seekTime); });
  h('stop', () => audio.pause());
}

// After the library is ready, show the last track (paused) so the user can resume.
export function restore() {
  if (P.index >= P.queue.length) P.index = P.queue.length - 1;
  const it = current();
  if (it) updateMediaSession(it);
  emit();
}
