// Per-device storage (localStorage). Everything stays on this phone/browser.
const PREFIX = 'seedline:';

export function get(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

export function set(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('Storage failed', e); return false; }
}

export function del(key) { try { localStorage.removeItem(PREFIX + key); } catch {} }

// ---- Favourites ----
export const favs = {
  all: () => get('favourites', []),
  has: (id) => get('favourites', []).includes(id),
  toggle(id) {
    const f = get('favourites', []);
    const i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1); else f.unshift(id);
    set('favourites', f);
    return i < 0;
  },
};

// ---- Playlists ----
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const playlists = {
  all: () => get('playlists', []),
  get: (id) => get('playlists', []).find((p) => p.id === id),
  save(list) { set('playlists', list); },
  create(name) {
    const list = get('playlists', []);
    const p = { id: uid(), name: name.trim() || 'My playlist', items: [], createdAt: Date.now() };
    list.unshift(p); set('playlists', list); return p;
  },
  rename(id, name) { this.update(id, (p) => { p.name = name.trim() || p.name; }); },
  remove(id) { set('playlists', get('playlists', []).filter((p) => p.id !== id)); },
  update(id, fn) {
    const list = get('playlists', []);
    const p = list.find((x) => x.id === id);
    if (p) { fn(p); set('playlists', list); }
    return p;
  },
  addItem(id, itemId) {
    let added = false;
    this.update(id, (p) => { if (!p.items.includes(itemId)) { p.items.push(itemId); added = true; } });
    return added;
  },
  removeItem(id, itemId) { this.update(id, (p) => { p.items = p.items.filter((x) => x !== itemId); }); },
  moveItem(id, from, to) {
    this.update(id, (p) => {
      if (to < 0 || to >= p.items.length) return;
      const [x] = p.items.splice(from, 1); p.items.splice(to, 0, x);
    });
  },
};

// ---- Listening progress ----
export const progress = {
  all: () => get('progress', {}),
  get: (id) => get('progress', {})[id],
  save(id, pos, dur) {
    if (!id || !isFinite(pos)) return;
    const p = get('progress', {});
    p[id] = { pos: Math.floor(pos), dur: Math.floor(dur || 0), at: Date.now() };
    set('progress', p);
  },
  clear(id) { const p = get('progress', {}); delete p[id]; set('progress', p); },
};
