import { I } from './icons.js';
import * as store from './store.js';
import { state, onChange, loadLibrary, checkLive, markAllSeen } from './data.js';
import * as player from './player.js';
import { P, audio } from './player.js';
import { CATEGORIES, UNCATEGORISED, searchItems, normalise, slug, fmtTime, fmtDuration } from './logic.js';
import { renderAdmin } from './admin.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FOOTER = 'Unofficial listening app. Audio streams from Living Seed Gboko\'s public Mixlr channel; all rights belong to their owners.';

// Lists rendered on screen, so a tap can play "this row and the rest of its list".
let lists = {};
let listSeq = 0;
function regList(ids) { const k = 'l' + listSeq++; lists[k] = ids; return k; }

// ---------- small UI helpers ----------
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function openSheet(html) {
  const s = $('#sheet');
  s.querySelector('.sheet-body').innerHTML = html;
  s.hidden = false;
  requestAnimationFrame(() => s.classList.add('open'));
}
function closeSheet() { const s = $('#sheet'); s.classList.remove('open'); s.hidden = true; }

// Simple in-app dialog. Resolves with the text (prompt) / true (confirm) or null.
function dialog({ title, value = '', placeholder = '', confirm = false, okText = 'Save', danger = false }) {
  return new Promise((resolve) => {
    const m = $('#modal');
    m.innerHTML = `<form class="modal-card" method="dialog">
      <h2>${esc(title)}</h2>
      ${confirm ? '' : `<input class="field" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="80" required autocomplete="off">`}
      <div class="row-btns"><button type="button" class="btn ghost" data-x="cancel">Cancel</button>
      <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(okText)}</button></div></form>`;
    m.hidden = false;
    const f = m.querySelector('form');
    const inp = f.querySelector('input');
    if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = (v) => { m.hidden = true; m.innerHTML = ''; resolve(v); };
    f.addEventListener('submit', (e) => { e.preventDefault(); done(confirm ? true : inp.value.trim() || null); });
    f.querySelector('[data-x=cancel]').addEventListener('click', () => done(null));
  });
}

const art = (it, cls = 'art') => it && it.artwork
  ? `<img class="${cls}" src="${esc(it.artwork)}" alt="" loading="lazy" decoding="async">`
  : `<div class="${cls} art-fallback">${logoMark()}</div>`;
const logoMark = () => `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" d="M32 54c-1.5 0-2.6-1.2-2.6-2.6V34.8C20 34 13 27 12.4 17.6c0-.8.6-1.5 1.4-1.5 9.4.3 16.6 7.2 17.6 16.1h1.2C33.6 21.5 41 13.4 51 12.8c.8 0 1.5.6 1.4 1.5C51.8 24.4 44 32.2 34.6 33v18.4c0 1.4-1.1 2.6-2.6 2.6z"/></svg>`;

function meta(it) {
  const bits = [];
  if (it.series) bits.push(esc(it.series));
  if (it.date) bits.push(esc(fmtDate(it.date)));
  if (it.duration) bits.push(fmtDuration(it.duration));
  return bits.join(' · ');
}
function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  if (!y) return d;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function progBar(it) {
  const p = store.progress.get(it.id);
  if (!p || !p.pos) return '';
  const d = p.dur || it.duration;
  if (!d) return '';
  return `<div class="pbar"><i style="width:${Math.min(100, (p.pos / d) * 100).toFixed(1)}%"></i></div>`;
}

function row(it, listKey, i, opts = {}) {
  const isNew = state.newIds.includes(it.id);
  const cur = player.current();
  const playingCls = cur && cur.id === it.id ? ' is-current' : '';
  return `<div class="row${playingCls}" data-testid="row" data-id="${esc(it.id)}">
    <button class="row-main" data-act="play" data-list="${listKey}" data-i="${i}" aria-label="Play ${esc(it.title)}">
      ${art(it)}
      <span class="row-text"><span class="row-title">${isNew ? '<b class="badge">New</b>' : ''}${esc(it.title)}</span>
      <span class="row-meta">${it.genericTitle ? '<em>Untitled on Mixlr</em> · ' : ''}${it.kind === 'admin' ? '<em>Added by admin</em> · ' : ''}${meta(it)}</span>${progBar(it)}</span>
    </button>
    ${opts.extra || ''}
    <button class="icon-btn" data-act="more" data-id="${esc(it.id)}" aria-label="More options">${I.more}</button>
  </div>`;
}

function list(items, opts = {}) {
  if (!items.length) return `<p class="empty">${esc(opts.empty || 'Nothing here yet.')}</p>`;
  const key = regList(items.map((x) => x.id));
  return `<div class="list">${items.map((it, i) => row(it, key, i, { extra: opts.extra ? opts.extra(it, i) : '' })).join('')}</div>`;
}

function card(it, listKey, i) {
  const p = store.progress.get(it.id);
  const left = p && (p.dur || it.duration) ? `${fmtTime((p.dur || it.duration) - p.pos)} left` : '';
  return `<button class="card" data-act="play" data-list="${listKey}" data-i="${i}" data-testid="card" data-id="${esc(it.id)}">
    ${art(it, 'card-art')}<span class="card-title">${esc(it.title)}</span><span class="card-meta">${esc(left || it.series || fmtDate(it.date))}</span>${progBar(it)}</button>`;
}

const sectionHead = (title, link, linkText = 'See all') =>
  `<div class="sec-head"><h2>${esc(title)}</h2>${link ? `<a href="${link}">${esc(linkText)}</a>` : ''}</div>`;

function liveStatus() {
  if (state.liveOk) return '';
  if (state.liveError) return `<div class="notice warn" data-testid="live-error">Couldn't reach Mixlr right now (${esc(state.liveError)}). You can browse the saved list, but playing needs a connection. <button class="link" data-act="check">Try again</button></div>`;
  return `<div class="notice">Loading the latest list from Mixlr…</div>`;
}

const playable = () => state.items;
const seriesList = () => {
  const m = new Map();
  for (const it of playable()) if (it.series) { if (!m.has(it.series)) m.set(it.series, []); m.get(it.series).push(it); }
  return [...m.entries()].map(([name, items]) => ({ name, items: sortSeries(items) }));
};
const sortSeries = (items) => items.slice().sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0) || (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id));
const catCount = (c) => playable().filter((i) => (i.categories || []).includes(c)).length;

// ---------- views ----------
function vHome() {
  const prog = store.progress.all();
  const cont = Object.entries(prog)
    .map(([id, p]) => ({ it: state.byId.get(id), p }))
    .filter((x) => x.it && x.it.kind !== 'youtube' && x.p.pos > 10 && (!x.p.dur || x.p.pos < x.p.dur - 20))
    .sort((a, b) => b.p.at - a.p.at).slice(0, 12).map((x) => x.it);
  const newItems = state.newIds.map((id) => state.byId.get(id)).filter(Boolean);
  const lastCheck = state.liveCheckedAt ? new Date(state.liveCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const latest = playable().filter((i) => !i.genericTitle).slice(0, 8);
  const ck = cont.length ? regList(cont.map((x) => x.id)) : null;
  const series = seriesList();
  return `
  <header class="top"><div class="brand">${logoSVG()}<span>Seedline</span></div>
    <a class="icon-btn" href="#/about" aria-label="About Seedline">${I.info}</a></header>
  ${liveStatus()}
  ${cont.length ? `<section data-testid="continue">${sectionHead('Continue listening')}<div class="hscroll">${cont.map((it, i) => card(it, ck, i)).join('')}</div></section>` : ''}
  <section data-testid="new-section">
    ${sectionHead('New on Mixlr', null)}
    ${newItems.length
      ? `<p class="sub">${newItems.length} new since your last visit.</p>${list(newItems)}<button class="btn ghost small" data-act="seen-all">Mark all as seen</button>`
      : `<p class="sub" data-testid="no-new">${lastCheck ? `No new messages since your last check (checked ${esc(lastCheck)}).` : 'Checking…'}</p>`}
    <button class="btn outline" data-act="check" data-testid="check-new">${I.refresh}<span>Check for new messages</span></button>
  </section>
  ${state.featured.length ? `<section>${sectionHead('Featured')}<div class="hscroll">${state.featured.map((f) => `<a class="card" href="#/featured/${esc(f.id)}"><div class="card-art art-fallback">${logoMark()}</div><span class="card-title">${esc(f.title)}</span><span class="card-meta">${(f.item_ids || []).length} messages</span></a>`).join('')}</div></section>` : ''}
  ${series.length ? `<section>${sectionHead('Series')}<div class="hscroll">${series.map((s) => `<a class="card" href="#/series/${slug(s.name)}" data-testid="series-card">${art(s.items[0], 'card-art')}<span class="card-title">${esc(s.name)}</span><span class="card-meta">${s.items.length} recording${s.items.length > 1 ? 's' : ''}</span></a>`).join('')}</div></section>` : ''}
  <section>${sectionHead('Browse by topic')}<p class="sub">Topics are auto-tagged from words in the titles only.</p>${catGrid()}</section>
  <section>${sectionHead('Latest uploads', '#/all', `All ${playable().length}`)}${list(latest)}</section>
  <a class="yt-banner" href="#/youtube">${I.yt}<span><b>${state.youtube.length} Saturday Bible Studies on YouTube</b><small>Opens in YouTube</small></span></a>
  ${footer()}`;
}

function catGrid() {
  const cats = [...CATEGORIES, UNCATEGORISED];
  return `<div class="cat-grid">${cats.map((c, i) => `<a class="cat c${i}" href="#/category/${encodeURIComponent(c)}" data-testid="cat"><span>${esc(c)}</span><small>${catCount(c)}</small></a>`).join('')}</div>`;
}

function footer() {
  return `<footer class="foot"><p>${esc(FOOTER)}</p><p>Seedline is not run by or affiliated with Living Seed. <a href="#/about">About</a> · <a href="#/admin">Admin</a></p></footer>`;
}

function vAll() {
  const sort = store.get('allSort', 'new');
  let items = playable().slice();
  if (sort === 'old') items.reverse();
  if (sort === 'az') items.sort((a, b) => a.title.localeCompare(b.title));
  return `${backHead('All messages')}
    <p class="sub">${items.length} recordings from Living Seed Gboko's Mixlr channel${state.liveOk ? '' : ' (saved list – live check failed)'}. Every title is shown exactly as it appears on Mixlr; that is not everything Bro Gbile has ever preached.</p>
    <div class="chips">${[['new', 'Newest'], ['old', 'Oldest'], ['az', 'A–Z']].map(([k, l]) => `<button class="chip ${sort === k ? 'on' : ''}" data-act="sort" data-v="${k}">${l}</button>`).join('')}</div>
    ${list(items)}${footer()}`;
}

let searchQ = '';
function vSearch() {
  return `<header class="top"><h1>Search</h1></header>
  <div class="search-box">${I.search}<input id="q" type="search" data-testid="search" placeholder="Title, topic, series or keyword" value="${esc(searchQ)}" autocomplete="off" enterkeyhint="search"></div>
  <div id="results">${searchResults()}</div>`;
}
function searchResults() {
  if (!normalise(searchQ)) return `<h2 class="h2">Browse by topic</h2>${catGrid()}`;
  const hits = searchItems(playable(), searchQ);
  const yt = searchItems(state.youtube, searchQ);
  const series = seriesList().filter((s) => normalise(s.name).includes(normalise(searchQ)));
  return `${series.length ? `<h2 class="h2">Series</h2><div class="list">${series.map((s) => `<a class="row" href="#/series/${slug(s.name)}">${art(s.items[0])}<span class="row-text"><span class="row-title">${esc(s.name)}</span><span class="row-meta">Series · ${s.items.length}</span></span></a>`).join('')}</div>` : ''}
    <h2 class="h2" data-testid="result-count">${hits.length} message${hits.length === 1 ? '' : 's'}</h2>${list(hits, { empty: 'No messages match. Try fewer words.' })}
    ${yt.length ? `<h2 class="h2">On YouTube (${yt.length})</h2>${ytList(yt.slice(0, 30))}${yt.length > 30 ? `<a class="btn ghost small" href="#/youtube?q=${encodeURIComponent(searchQ)}">See all ${yt.length}</a>` : ''}` : ''}`;
}

function vLibrary() {
  const pls = store.playlists.all();
  const favN = store.favs.all().filter((id) => state.byId.has(id)).length;
  return `<header class="top"><h1>Your library</h1><button class="icon-btn" data-act="new-pl" aria-label="Create playlist" data-testid="new-playlist">${I.plus}</button></header>
  <p class="sub">Saved on this device only.</p>
  <div class="list">
    <a class="row" href="#/favourites" data-testid="fav-link"><div class="art art-fav">${I.heartFill}</div><span class="row-text"><span class="row-title">Favourites</span><span class="row-meta">${favN} message${favN === 1 ? '' : 's'}</span></span></a>
    ${pls.map((p) => `<a class="row" href="#/playlist/${esc(p.id)}" data-testid="playlist-row"><div class="art art-pl">${I.queue}</div><span class="row-text"><span class="row-title">${esc(p.name)}</span><span class="row-meta">Playlist · ${p.items.length}</span></span></a>`).join('')}
  </div>
  ${pls.length ? '' : '<p class="empty">No playlists yet. Tap + to make one.</p>'}
  <button class="btn outline" data-act="new-pl">${I.plus}<span>New playlist</span></button>
  ${footer()}`;
}

function vFavourites() {
  const items = store.favs.all().map((id) => state.byId.get(id)).filter((x) => x && x.kind !== 'youtube');
  return `${backHead('Favourites')}${items.length ? playBar(items.map((i) => i.id)) : ''}${list(items, { empty: 'Tap the heart on any message to save it here.' })}`;
}

function vPlaylist(id) {
  const p = store.playlists.get(id);
  if (!p) return `${backHead('Playlist')}<p class="empty">This playlist was deleted.</p>`;
  const items = p.items.map((x) => state.byId.get(x)).filter(Boolean);
  const total = items.reduce((s, i) => s + (i.duration || 0), 0);
  return `${backHead(p.name)}
  <p class="sub">${items.length} message${items.length === 1 ? '' : 's'}${total ? ' · ' + fmtDuration(total) : ''}${p.items.length > items.length ? ` · ${p.items.length - items.length} no longer available` : ''}</p>
  ${items.length ? playBar(items.map((i) => i.id)) : ''}
  <div class="row-btns left"><button class="btn ghost small" data-act="rename-pl" data-id="${esc(p.id)}">${I.edit}<span>Rename</span></button>
  <button class="btn ghost small" data-act="delete-pl" data-id="${esc(p.id)}">${I.trash}<span>Delete</span></button></div>
  ${list(items, {
    empty: 'Empty. Use ⋮ on any message → "Add to playlist".',
    extra: (it, i) => `<span class="reorder"><button class="icon-btn sm" data-act="pl-up" data-pl="${esc(p.id)}" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${I.up}</button><button class="icon-btn sm" data-act="pl-down" data-pl="${esc(p.id)}" data-i="${i}" aria-label="Move down" ${i === items.length - 1 ? 'disabled' : ''}>${I.down}</button><button class="icon-btn sm" data-act="pl-remove" data-pl="${esc(p.id)}" data-id="${esc(it.id)}" aria-label="Remove from playlist">${I.close}</button></span>`,
  })}`;
}

function playBar(ids) {
  const k = regList(ids);
  return `<div class="playbar"><button class="btn primary" data-act="play" data-list="${k}" data-i="0" data-testid="play-all">${I.play}<span>Play</span></button>
    <button class="btn ghost" data-act="shuffle-play" data-list="${k}">${I.shuffle}<span>Shuffle</span></button></div>`;
}

function backHead(title) {
  return `<header class="top"><button class="icon-btn" data-act="back" aria-label="Back">${I.back}</button><h1 class="clip">${esc(title)}</h1><span></span></header>`;
}

function vSeries(s) {
  const found = seriesList().find((x) => slug(x.name) === s);
  if (!found) return `${backHead('Series')}<p class="empty">Series not found.</p>`;
  return `${backHead(found.name)}<p class="sub">Grouped from the Mixlr titles. ${found.items.length} recording${found.items.length > 1 ? 's' : ''}.</p>${playBar(found.items.map((i) => i.id))}${list(found.items)}`;
}

function vCategory(c) {
  const items = playable().filter((i) => (i.categories || []).includes(c));
  const note = c === UNCATEGORISED
    ? 'These titles have no clear topic word, so they are not tagged. Nothing is guessed.'
    : 'Auto-tagged: the title contains a clear keyword for this topic. Tags can be wrong; titles are never changed.';
  return `${backHead(c)}<p class="sub">${note} ${items.length} message${items.length === 1 ? '' : 's'}.</p>${items.length ? playBar(items.map((i) => i.id)) : ''}${list(items)}`;
}

function vFeatured(id) {
  const f = state.featured.find((x) => String(x.id) === id);
  if (!f) return `${backHead('Featured')}<p class="empty">Not found.</p>`;
  const items = (f.item_ids || []).map((x) => state.byId.get(x)).filter(Boolean);
  return `${backHead(f.title)}${f.description ? `<p class="sub">${esc(f.description)}</p>` : ''}${items.length ? playBar(items.map((i) => i.id)) : ''}${list(items)}`;
}

function vItem(id) {
  const it = state.byId.get(id);
  if (!it) return `${backHead('Message')}<p class="empty">This message isn't in the library (it may have been removed from Mixlr).</p>`;
  if (it.kind === 'youtube') return `${backHead('YouTube')}${ytList([it])}`;
  const fav = store.favs.has(it.id);
  const p = store.progress.get(it.id);
  const k = regList([it.id]);
  return `${backHead('')}
  <div class="detail">
    ${it.artworkLarge || it.artwork ? `<img class="detail-art" src="${esc(it.artworkLarge || it.artwork)}" alt="">` : `<div class="detail-art art-fallback">${logoMark()}</div>`}
    <h1 data-testid="detail-title">${esc(it.title)}</h1>
    ${it.genericTitle ? '<p class="sub">Mixlr gives this recording no proper title, so its automatic name is shown.</p>' : ''}
    ${it.originalTitle && it.originalTitle !== it.title ? `<p class="sub">Mixlr title: ${esc(it.originalTitle)}</p>` : ''}
    <p class="sub">${it.series ? `<a href="#/series/${slug(it.series)}">${esc(it.series)}</a> · ` : ''}${esc(fmtDate(it.date))}${it.duration ? ' · ' + fmtDuration(it.duration) : ''}</p>
    ${p && p.pos ? `<p class="sub">Listened to ${fmtTime(p.pos)}${p.dur ? ' of ' + fmtTime(p.dur) : ''}</p>` : ''}
    <div class="tags">${(it.categories || []).map((c) => `<a class="chip" href="#/category/${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}<span class="tagnote">${it.categorySource === 'admin' ? 'set by admin' : 'auto-tagged'}</span></div>
    ${it.needsPermission ? '<div class="notice warn">Added by an admin with a direct audio link. Playing or sharing this requires permission from the owner of the recording.</div>' : ''}
    <div class="playbar"><button class="btn primary" data-act="play" data-list="${k}" data-i="0" data-testid="detail-play">${I.play}<span>${p && p.pos ? 'Resume' : 'Play'}</span></button>
      <button class="icon-btn lg ${fav ? 'on' : ''}" data-act="fav" data-id="${esc(it.id)}" aria-label="${fav ? 'Remove from' : 'Add to'} favourites" data-testid="fav-btn">${fav ? I.heartFill : I.heart}</button>
      <button class="icon-btn lg" data-act="more" data-id="${esc(it.id)}" aria-label="More options">${I.more}</button></div>
    <p class="sub">Source: ${esc(it.source)}${it.sourceUrl ? ` · <a href="${esc(it.sourceUrl)}" target="_blank" rel="noopener" data-testid="source-link">Open original ${I.ext}</a>` : ''}</p>
  </div>`;
}

function ytList(items) {
  return `<div class="list">${items.map((v) => `<div class="row yt-row">
    <img class="art wide" src="https://i.ytimg.com/vi/${esc(v.videoId)}/mqdefault.jpg" alt="" loading="lazy">
    <span class="row-text"><span class="row-title">${esc(v.title)}</span><span class="row-meta">YouTube${v.length ? ' · ' + esc(v.length) : ''}</span></span>
    <a class="btn ghost small" href="${esc(v.url)}" target="_blank" rel="noopener" data-testid="yt-open">Open on YouTube</a></div>`).join('')}</div>`;
}

let ytQ = '';
function vYouTube() {
  return `<header class="top"><h1>On YouTube</h1></header>
  <div class="notice">These ${state.youtube.length} Saturday Bible Study videos live on YouTube. They open in the YouTube app or site instead of playing here, because YouTube's rules don't allow other apps to play its videos in the background with the screen off.</div>
  <div class="search-box">${I.search}<input id="ytq" type="search" placeholder="Filter YouTube videos" value="${esc(ytQ)}" autocomplete="off"></div>
  <div id="ytresults">${ytResults()}</div>`;
}
function ytResults() {
  const items = normalise(ytQ) ? searchItems(state.youtube, ytQ) : state.youtube;
  return `<p class="sub">${items.length} video${items.length === 1 ? '' : 's'}</p>${ytList(items.slice(0, 120))}${items.length > 120 ? '<p class="sub">Showing the first 120 – type to narrow it down.</p>' : ''}`;
}

function vAbout() {
  return `${backHead('About Seedline')}
  <div class="prose">
  <p><b>Seedline</b> is an unofficial listening app for messages of Bro Gbile Akanni. It is <b>not</b> made by, run by or affiliated with Living Seed.</p>
  <p>Audio plays straight from Living Seed Gboko's public Mixlr channel. Seedline doesn't copy or store any audio. Each message has a link to its original Mixlr page.</p>
  <p>The library shows the ${state.items.length} recordings currently listed on that one Mixlr channel (very short test clips are skipped). It is <b>not</b> a complete collection of his teaching. Titles are shown exactly as they appear on Mixlr. Topics are auto-tagged only when a title contains a clear keyword.</p>
  <p>Your favourites, playlists, queue and listening position are saved only on this device.</p>
  <p>Background play: on Android in Chrome (or when installed), audio keeps going with the screen locked and moves to the next message on its own. On iPhone, Safari may pause between messages.</p>
  <p>${esc(FOOTER)}</p></div>`;
}

// ---------- router ----------
function route() {
  lists = {}; listSeq = 0;
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs] = h.split('?');
  const [name, arg] = [path.split('/')[0], decodeURIComponent(path.split('/').slice(1).join('/'))];
  let html;
  switch (name) {
    case 'home': html = vHome(); break;
    case 'all': html = vAll(); break;
    case 'search': html = vSearch(); break;
    case 'library': html = vLibrary(); break;
    case 'favourites': html = vFavourites(); break;
    case 'playlist': html = vPlaylist(arg); break;
    case 'series': html = vSeries(arg); break;
    case 'category': html = vCategory(arg); break;
    case 'featured': html = vFeatured(arg); break;
    case 'item': html = vItem(arg); break;
    case 'youtube': if (qs) ytQ = new URLSearchParams(qs).get('q') || ytQ; html = vYouTube(); break;
    case 'about': html = vAbout(); break;
    case 'admin': html = '<div id="admin-root"></div>'; break;
    default: html = vHome();
  }
  view.innerHTML = html;
  view.dataset.view = name;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === name || (a.dataset.nav === 'library' && ['favourites', 'playlist'].includes(name))));
  if (name === 'admin') renderAdmin($('#admin-root'), { esc, toast, dialog });
  return name;
}

let lastRoute = null;
function navigate() {
  const name = route();
  if (lastRoute !== location.hash) window.scrollTo(0, 0);
  lastRoute = location.hash;
  if (name === 'search') { const q = $('#q'); if (q && !q.value) setTimeout(() => q.focus(), 50); }
}

// Re-render the current view without losing the search box focus.
function refreshView() {
  const name = view.dataset.view;
  if (name === 'search') { $('#results').innerHTML = (lists = {}, listSeq = 0, searchResults()); return; }
  if (name === 'youtube') return;
  if (name === 'admin') return;
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
}

// ---------- item actions ----------
function moreSheet(id) {
  const it = state.byId.get(id);
  if (!it) return;
  const fav = store.favs.has(id);
  openSheet(`<div class="sheet-head">${art(it)}<span><b>${esc(it.title)}</b><small>${meta(it)}</small></span></div>
    <button data-act="play-one" data-id="${esc(id)}">${I.play}<span>Play now</span></button>
    <button data-act="play-next" data-id="${esc(id)}">${I.queue}<span>Play next</span></button>
    <button data-act="add-queue" data-id="${esc(id)}" data-testid="add-queue">${I.plus}<span>Add to queue</span></button>
    <button data-act="fav" data-id="${esc(id)}">${fav ? I.heartFill : I.heart}<span>${fav ? 'Remove from favourites' : 'Add to favourites'}</span></button>
    <button data-act="add-pl" data-id="${esc(id)}" data-testid="add-to-playlist">${I.library}<span>Add to playlist</span></button>
    <a href="#/item/${encodeURIComponent(id)}" data-act="close">${I.info}<span>View details</span></a>
    ${it.series ? `<a href="#/series/${slug(it.series)}" data-act="close">${I.library}<span>Go to series</span></a>` : ''}
    ${it.sourceUrl ? `<a href="${esc(it.sourceUrl)}" target="_blank" rel="noopener">${I.ext}<span>Open original on Mixlr</span></a>` : ''}`);
}

function playlistPicker(id) {
  const pls = store.playlists.all();
  openSheet(`<h3>Add to playlist</h3>
    <button data-act="pl-new-add" data-id="${esc(id)}" data-testid="pl-new-add">${I.plus}<span>New playlist…</span></button>
    ${pls.map((p) => `<button data-act="pl-add" data-pl="${esc(p.id)}" data-id="${esc(id)}" data-testid="pl-pick">${I.queue}<span>${esc(p.name)} <small>(${p.items.length})</small></span></button>`).join('')}`);
}

async function onAction(btn, e) {
  const a = btn.dataset.act;
  const id = btn.dataset.id;
  switch (a) {
    case 'play': {
      const ids = lists[btn.dataset.list] || [];
      closeSheet();
      player.playQueue(ids, Number(btn.dataset.i) || 0);
      break;
    }
    case 'shuffle-play': {
      const ids = lists[btn.dataset.list] || [];
      if (!P.shuffle) player.toggleShuffle();
      player.playQueue(ids, Math.floor(Math.random() * ids.length));
      break;
    }
    case 'play-one': closeSheet(); player.playId(id); break;
    case 'play-next': closeSheet(); player.playNext(id); toast('Will play next'); break;
    case 'add-queue': closeSheet(); player.addToQueue(id); toast('Added to queue'); break;
    case 'fav': { const on = store.favs.toggle(id); closeSheet(); toast(on ? 'Added to favourites' : 'Removed from favourites'); refreshView(); renderFull(); break; }
    case 'add-pl': playlistPicker(id); break;
    case 'pl-add': { const ok = store.playlists.addItem(btn.dataset.pl, id); closeSheet(); toast(ok ? `Added to ${store.playlists.get(btn.dataset.pl).name}` : 'Already in that playlist'); refreshView(); break; }
    case 'pl-new-add': {
      closeSheet();
      const name = await dialog({ title: 'New playlist', placeholder: 'Playlist name', okText: 'Create' });
      if (!name) return;
      const p = store.playlists.create(name);
      store.playlists.addItem(p.id, id);
      toast(`Added to ${p.name}`);
      refreshView();
      break;
    }
    case 'new-pl': {
      const name = await dialog({ title: 'New playlist', placeholder: 'Playlist name', okText: 'Create' });
      if (!name) return;
      const p = store.playlists.create(name);
      location.hash = '#/playlist/' + p.id;
      break;
    }
    case 'rename-pl': {
      const p = store.playlists.get(id);
      const name = await dialog({ title: 'Rename playlist', value: p.name, okText: 'Save' });
      if (name) { store.playlists.rename(id, name); refreshView(); }
      break;
    }
    case 'delete-pl': {
      const p = store.playlists.get(id);
      const ok = await dialog({ title: `Delete "${p.name}"?`, confirm: true, okText: 'Delete', danger: true });
      if (ok) { store.playlists.remove(id); toast('Playlist deleted'); location.hash = '#/library'; }
      break;
    }
    case 'pl-up': store.playlists.moveItem(btn.dataset.pl, +btn.dataset.i, +btn.dataset.i - 1); refreshView(); break;
    case 'pl-down': store.playlists.moveItem(btn.dataset.pl, +btn.dataset.i, +btn.dataset.i + 1); refreshView(); break;
    case 'pl-remove': store.playlists.removeItem(btn.dataset.pl, id); refreshView(); break;
    case 'more': moreSheet(id); break;
    case 'close': closeSheet(); break;
    case 'back': if (history.length > 1) history.back(); else location.hash = '#/home'; break;
    case 'sort': store.set('allSort', btn.dataset.v); refreshView(); break;
    case 'seen-all': markAllSeen(); toast('Marked as seen'); break;
    case 'check': {
      btn.disabled = true;
      toast('Checking Mixlr…');
      const r = await checkLive();
      btn.disabled = false;
      if (!r.ok) toast("Couldn't reach Mixlr. Check your connection.");
      else if (r.fresh && r.fresh.length) toast(`${r.fresh.length} new message${r.fresh.length > 1 ? 's' : ''} found`);
      else toast('No new messages since your last check');
      break;
    }
    // player
    case 'toggle': player.toggle(); break;
    case 'next': player.next(); break;
    case 'prev': player.prev(); break;
    case 'shuffle': player.toggleShuffle(); toast(P.shuffle ? 'Shuffle on' : 'Shuffle off'); break;
    case 'repeat': player.cycleRepeat(); toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat this message' }[P.repeat]); break;
    case 'back15': player.skip(-15); break;
    case 'fwd30': player.skip(30); break;
    case 'open-full': openFull(); break;
    case 'close-full': closeFull(); break;
    case 'open-queue': openQueue(); break;
    case 'close-queue': $('#queue').hidden = true; break;
    case 'q-jump': player.jumpTo(+btn.dataset.i); break;
    case 'q-up': player.move(+btn.dataset.i, +btn.dataset.i - 1); break;
    case 'q-down': player.move(+btn.dataset.i, +btn.dataset.i + 1); break;
    case 'q-remove': player.removeAt(+btn.dataset.i); break;
    case 'q-clear': player.clearQueue(); toast('Queue cleared'); break;
    case 'cur-more': { const it = player.current(); if (it) moreSheet(it.id); break; }
    default: return;
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) {
    if (e.target.id === 'sheet') closeSheet();
    return;
  }
  if (btn.tagName === 'A' && btn.dataset.act === 'close') { closeSheet(); return; }
  e.preventDefault();
  onAction(btn, e);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { searchQ = e.target.value; lists = {}; listSeq = 0; $('#results').innerHTML = searchResults(); }
  if (e.target.id === 'ytq') { ytQ = e.target.value; $('#ytresults').innerHTML = ytResults(); }
  if (e.target.id === 'seek') { seeking = true; $('#t-cur').textContent = fmtTime(e.target.value); }
  if (e.target.id === 'vol') player.setVolume(+e.target.value);
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'seek') { player.seek(+e.target.value); seeking = false; }
});

// ---------- mini & full player ----------
let seeking = false;
function renderMini() {
  const it = player.current();
  const m = $('#mini');
  if (!it) { m.hidden = true; document.body.classList.remove('has-mini'); return; }
  m.hidden = false;
  document.body.classList.add('has-mini');
  const playing = player.isPlaying();
  const d = audio.duration || it.duration || 0;
  const pct = d ? (audio.currentTime / d) * 100 : 0;
  m.innerHTML = `<div class="mini-in" data-act="open-full" data-testid="mini">
    ${art(it)}<span class="row-text"><span class="row-title" data-testid="mini-title">${esc(it.title)}</span><span class="row-meta">${P.error ? `<em class="err">${esc(P.error)}</em>` : P.loading ? 'Loading…' : esc(it.series || it.source)}</span></span>
    <button class="icon-btn lg" data-act="toggle" aria-label="${playing ? 'Pause' : 'Play'}" data-testid="mini-toggle">${playing ? I.pause : I.play}</button>
    <button class="icon-btn" data-act="next" aria-label="Next">${I.next}</button></div>
    <div class="mini-prog"><i style="width:${pct.toFixed(2)}%"></i></div>`;
}

function renderFull() {
  const f = $('#full');
  if (f.hidden) return;
  const it = player.current();
  if (!it) { closeFull(); return; }
  const playing = player.isPlaying();
  const d = isFinite(audio.duration) ? audio.duration : it.duration || 0;
  const fav = store.favs.has(it.id);
  if (f.dataset.id !== it.id || !f.innerHTML) {
    f.dataset.id = it.id;
    f.innerHTML = `<div class="full-in">
      <header class="top"><button class="icon-btn" data-act="close-full" aria-label="Close player">${I.down}</button><span class="full-ctx">Now playing</span><button class="icon-btn" data-act="cur-more" aria-label="More options">${I.more}</button></header>
      ${it.artworkLarge || it.artwork ? `<img class="full-art" src="${esc(it.artworkLarge || it.artwork)}" alt="">` : `<div class="full-art art-fallback">${logoMark()}</div>`}
      <div class="full-title"><span><b data-testid="full-title">${esc(it.title)}</b><small>${esc(it.series || '')}${it.series ? ' · ' : ''}${esc(fmtDate(it.date))}</small></span>
        <button class="icon-btn lg" id="full-fav" data-act="fav" data-id="${esc(it.id)}" aria-label="Favourite"></button></div>
      <input id="seek" type="range" min="0" step="1" value="0" aria-label="Seek" data-testid="seek">
      <div class="times"><span id="t-cur">0:00</span><span id="t-dur">0:00</span></div>
      <div class="controls">
        <button class="icon-btn" data-act="shuffle" id="b-shuffle" aria-label="Shuffle" data-testid="shuffle">${I.shuffle}</button>
        <button class="icon-btn lg" data-act="prev" aria-label="Previous" data-testid="prev">${I.prev}</button>
        <button class="play-big" data-act="toggle" id="b-play" aria-label="Play" data-testid="full-toggle"></button>
        <button class="icon-btn lg" data-act="next" aria-label="Next" data-testid="next">${I.next}</button>
        <button class="icon-btn" data-act="repeat" id="b-repeat" aria-label="Repeat" data-testid="repeat"></button>
      </div>
      <div class="controls sm"><button class="icon-btn" data-act="back15" aria-label="Back 15 seconds">${I.back15}</button>
        <div class="vol">${I.vol}<input id="vol" type="range" min="0" max="1" step="0.05" aria-label="Volume"></div>
        <button class="icon-btn" data-act="fwd30" aria-label="Forward 30 seconds">${I.fwd30}</button></div>
      <p class="err-line" id="full-err"></p>
      <div class="full-foot"><a href="${esc(it.sourceUrl || '#')}" target="_blank" rel="noopener">Source: ${esc(it.source)} ${I.ext}</a>
        <button class="btn ghost small" data-act="open-queue" data-testid="open-queue">${I.queue}<span>Queue</span></button></div>
    </div>`;
  }
  const seek = $('#seek');
  seek.max = Math.max(1, Math.floor(d));
  if (!seeking) { seek.value = Math.floor(audio.currentTime || 0); $('#t-cur').textContent = fmtTime(audio.currentTime); }
  $('#t-dur').textContent = fmtTime(d);
  $('#b-play').innerHTML = playing ? I.pause : I.play;
  $('#b-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#b-shuffle').classList.toggle('on', P.shuffle);
  const rb = $('#b-repeat');
  rb.innerHTML = P.repeat === 'one' ? I.repeat1 : I.repeat;
  rb.classList.toggle('on', P.repeat !== 'off');
  rb.dataset.mode = P.repeat;
  $('#full-fav').innerHTML = fav ? I.heartFill : I.heart;
  $('#full-fav').classList.toggle('on', fav);
  const vol = $('#vol'); if (document.activeElement !== vol) vol.value = P.volume;
  $('#full-err').textContent = P.error || (P.loading ? 'Loading…' : '');
}
function openFull() { const f = $('#full'); f.hidden = false; f.innerHTML = ''; renderFull(); document.body.classList.add('no-scroll'); }
function closeFull() { $('#full').hidden = true; document.body.classList.remove('no-scroll'); }

function openQueue() { $('#queue').hidden = false; renderQueue(); }
function renderQueue() {
  const q = $('#queue');
  if (q.hidden) return;
  const cur = player.current();
  const rows = P.queue.map((id, i) => ({ id, i, it: state.byId.get(id) })).filter((x) => x.i > P.index);
  q.innerHTML = `<div class="queue-in"><header class="top"><button class="icon-btn" data-act="close-queue" aria-label="Close queue">${I.down}</button><h1>Queue</h1><button class="btn ghost small" data-act="q-clear" data-testid="q-clear">Clear</button></header>
    <h2 class="h2">Now playing</h2>${cur ? `<div class="row is-current">${art(cur)}<span class="row-text"><span class="row-title">${esc(cur.title)}</span><span class="row-meta">${meta(cur)}</span></span></div>` : '<p class="empty">Nothing playing.</p>'}
    <h2 class="h2">Up next (${rows.length})${P.shuffle ? ' · shuffled' : ''}${P.repeat !== 'off' ? ' · repeat ' + P.repeat : ''}</h2>
    <div class="list" data-testid="queue-list">${rows.map(({ it, i, id }) => `<div class="row" data-testid="q-row" data-id="${esc(id)}">
      <button class="row-main" data-act="q-jump" data-i="${i}">${art(it)}<span class="row-text"><span class="row-title">${esc(it ? it.title : 'Unavailable')}</span><span class="row-meta">${it ? meta(it) : ''}</span></span></button>
      <span class="reorder"><button class="icon-btn sm" data-act="q-up" data-i="${i}" aria-label="Move up" ${i <= P.index + 1 ? 'disabled' : ''}>${I.up}</button><button class="icon-btn sm" data-act="q-down" data-i="${i}" aria-label="Move down" ${i >= P.queue.length - 1 ? 'disabled' : ''}>${I.down}</button><button class="icon-btn sm" data-act="q-remove" data-i="${i}" aria-label="Remove">${I.close}</button></span></div>`).join('') || '<p class="empty">Nothing queued. Use ⋮ → "Add to queue".</p>'}</div>
    ${P.index > 0 ? `<h2 class="h2">Played</h2><div class="list dim">${P.queue.slice(0, P.index).map((id, i) => { const it = state.byId.get(id); return `<div class="row"><button class="row-main" data-act="q-jump" data-i="${i}">${art(it)}<span class="row-text"><span class="row-title">${esc(it ? it.title : 'Unavailable')}</span></span></button></div>`; }).join('')}</div>` : ''}
  </div>`;
}

let lastCurId = null;
player.onPlayer(() => {
  renderMini();
  renderFull();
  const cur = player.current();
  const cid = cur ? cur.id : null;
  if (cid !== lastCurId) {
    lastCurId = cid;
    renderQueue();
    document.querySelectorAll('.row.is-current').forEach((r) => r.classList.remove('is-current'));
    if (cid) document.querySelectorAll(`.row[data-id="${CSS.escape(cid)}"]`).forEach((r) => r.classList.add('is-current'));
  }
});
// Queue edits don't change the current id, so re-render the queue on any change (cheap).
let qTimer;
player.onPlayer(() => { clearTimeout(qTimer); qTimer = setTimeout(renderQueue, 50); });

// ---------- boot ----------
function logoSVG() {
  return `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="var(--accent)"/><path fill="#14110b" d="M32 52c-1.4 0-2.4-1.1-2.4-2.4V35.2C21.3 34.5 15 28.3 14.4 19.9c0-.7.6-1.4 1.3-1.4 8.4.3 14.8 6.4 15.7 14.4h1.1c.9-9.4 7.5-16.6 16.4-17.1.7 0 1.4.6 1.3 1.4-.5 9-7.5 16-15.8 16.7v16.7c0 1.3-1 2.4-2.4 2.4z"/></svg>`;
}

window.addEventListener('hashchange', navigate);
onChange(() => { refreshView(); renderMini(); });
navigate();
loadLibrary().then(() => { player.restore(); renderMini(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e)));
}

// Expose for automated tests only (harmless in production).
window.__seedline = { state, P, audio, player, store };
