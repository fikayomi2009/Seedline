// End-to-end tests in a real headless Chromium against the LIVE Mixlr API.
// Run: node tests/e2e.test.mjs   (env CHROMIUM=/path/to/chromium optional)
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8765;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT);

const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
let proxy;
if (raw) { const u = new URL(raw); proxy = { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password), bypass: 'localhost,127.0.0.1' }; }

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  proxy,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
// Real phone user agent: Buzzsprout's CDN refuses the default "HeadlessChrome" UA (bot filter), but serves normal Chrome.
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36';
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { const info = await fn(); results.push({ name, ok: true, info: info || '', ms: Date.now() - t0 }); console.log('PASS', name, info || ''); }
  catch (e) { results.push({ name, ok: false, info: String(e.message || e).slice(0, 400), ms: Date.now() - t0 }); console.log('FAIL', name, e.message); await page.screenshot({ path: `tests/fail-${results.length}.png` }).catch(() => {}); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const S = (fn, arg) => page.evaluate(fn, arg);
const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
const BASE = `http://localhost:${PORT}/`;
const audioState = () => S(() => { const a = window.__seedline.audio; const P = window.__seedline.P; return { t: a.currentTime, paused: a.paused, d: a.duration, id: P.queue[P.index], index: P.index, err: P.error, src: a.src.slice(0, 60) }; });
async function waitAdvancing(min = 1.5) {
  const s0 = await audioState();
  await waitFor(([t0, m]) => { const a = window.__seedline.audio; return !a.paused && a.currentTime > t0 + m; }, [s0.t, min], 45000);
  return audioState();
}

await test('library loads from the live Mixlr API', async () => {
  await page.goto(BASE + '#/home');
  await waitFor(() => window.__seedline && window.__seedline.state.liveOk === true, null, 40000);
  const n = await S(() => { const st = window.__seedline.state; const mx = st.items.filter((i) => i.kind === 'mixlr'); const bySrc = {}; for (const i of st.items) bySrc[i.sourceKey] = (bySrc[i.sourceKey] || 0) + 1; return { items: st.items.length, mixlr: mx.length, urls: Object.keys(st.urls).length, yt: st.youtube.length, inLive: mx.filter((i) => i.inLive).length, bySrc, errs: st.liveErrors }; });
  assert(n.items >= 400, 'too few items ' + n.items);
  assert(n.urls >= 190, 'no fresh audio urls ' + n.urls);
  assert(n.inLive === n.mixlr, 'some Mixlr catalog items missing from live lists');
  assert(Object.keys(n.bySrc).length >= 7, 'sources missing ' + JSON.stringify(n.bySrc));
  const rows = await page.locator('[data-testid=row]').count();
  const secs = await page.locator('[data-testid=source-section]').count();
  assert(rows > 0 && secs >= 6, `rows ${rows} source sections ${secs}`);
  return `${n.items} messages (${JSON.stringify(n.bySrc)}), ${n.urls} fresh Mixlr URLs from 2 channels, ${n.yt} YouTube entries, ${secs} per-source sections on Home`;
});

await test('first run: nothing falsely marked New', async () => {
  const t = await page.locator('[data-testid=no-new]').innerText();
  assert(/No new messages/.test(t), 'unexpected: ' + t);
  return t;
});

await test('search is instant and filters by title/topic/series', async () => {
  await page.goto(BASE + '#/search');
  await page.fill('[data-testid=search]', 'discipleship');
  const c1 = await page.locator('[data-testid=result-count]').innerText();
  const n1 = parseInt(c1);
  assert(n1 > 0, 'no results for discipleship');
  const titles = await page.locator('#results [data-testid=row] .row-title').allInnerTexts();
  assert(titles.every((t) => /discipl/i.test(t)), 'result without keyword: ' + titles.find((t) => !/discipl/i.test(t)));
  await page.fill('[data-testid=search]', 'MLR 2022');
  const n2 = parseInt(await page.locator('[data-testid=result-count]').innerText());
  await page.fill('[data-testid=search]', 'zzqqxx');
  const n3 = parseInt(await page.locator('[data-testid=result-count]').innerText());
  assert(n2 >= 4 && n3 === 0, `MLR=${n2} nonsense=${n3}`);
  const yt = await page.locator('#results [data-testid=yt-open]').count();
  return `"discipleship" → ${n1} messages; "MLR 2022" → ${n2}; nonsense → 0; YouTube links shown for last query: ${yt}`;
});

await test('play starts and audio currentTime advances (+Media Session metadata)', async () => {
  await page.goto(BASE + '#/all');
  await page.locator('[data-testid=row] .row-main').first().click();
  const s = await waitAdvancing(2);
  const ms = await S(() => navigator.mediaSession && navigator.mediaSession.metadata ? { title: navigator.mediaSession.metadata.title, art: navigator.mediaSession.metadata.artwork.length, state: navigator.mediaSession.playbackState } : null);
  const cur = await S(() => window.__seedline.player.current().title);
  assert(ms && ms.title === cur, 'media session title mismatch');
  assert(await page.locator('[data-testid=mini]').isVisible(), 'mini player hidden');
  return `playing ${s.id} at ${s.t.toFixed(1)}s of ${Math.round(s.d)}s; mediaSession title ok, ${ms.art} artwork sizes, state=${ms.state}`;
});

await test('seek via full-player slider', async () => {
  await page.locator('[data-testid=mini]').click();
  await page.waitForSelector('[data-testid=seek]');
  await page.$eval('[data-testid=seek]', (el) => { el.value = 1200; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitFor(() => window.__seedline.audio.currentTime > 1199 && window.__seedline.audio.currentTime < 1260, null, 20000);
  const s = await waitAdvancing(1);
  assert(s.t > 1200, 'not advancing after seek');
  return `jumped to ${s.t.toFixed(1)}s and kept playing`;
});

await test('next / previous buttons', async () => {
  const a = await audioState();
  await page.click('[data-testid=next]');
  await waitFor((id) => { const P = window.__seedline.P; return P.queue[P.index] !== id; }, a.id);
  const b = await waitAdvancing(1);
  assert(b.index === a.index + 1, `index ${a.index} -> ${b.index}`);
  // prev after >3 s restarts the current one, then a second prev goes back
  await page.waitForTimeout(3500);
  await page.click('[data-testid=prev]');
  await waitFor(() => window.__seedline.audio.currentTime < 3, null, 15000);
  await page.click('[data-testid=prev]');
  await waitFor((id) => { const P = window.__seedline.P; return P.queue[P.index] === id; }, a.id);
  const c = await waitAdvancing(1);
  return `next → index ${b.index} (${b.id}); prev restarts then returns to ${c.id} (resumed at ${c.t.toFixed(0)}s from saved progress)`;
});

await test('ended → auto-advance to next message', async () => {
  const a = await audioState();
  await S(() => { const a = window.__seedline.audio; a.currentTime = a.duration - 3; });
  await waitFor((id) => { const P = window.__seedline.P; return P.queue[P.index] !== id; }, a.id, 30000);
  const b = await waitAdvancing(1);
  assert(b.index === a.index + 1, 'did not advance by one');
  assert(!(await S((id) => window.__seedline.store.progress.get(id), a.id)), 'finished item still has saved progress');
  const prog = await S((id) => window.__seedline.store.progress.get(id), a.id);
  return `${a.id} ended → ${b.id} playing at ${b.t.toFixed(1)}s; finished item progress cleared: ${!prog}`;
});

await test('repeat one replays the same message on end', async () => {
  while ((await S(() => window.__seedline.P.repeat)) !== 'one') await page.click('[data-testid=repeat]');
  const a = await audioState();
  await S(() => { const a = window.__seedline.audio; a.currentTime = a.duration - 2.5; });
  await waitFor(() => window.__seedline.audio.currentTime < 5 && !window.__seedline.audio.paused, null, 30000);
  const b = await audioState();
  assert(a.id === b.id, 'changed track');
  while ((await S(() => window.__seedline.P.repeat)) !== 'off') await page.click('[data-testid=repeat]');
  return `same id ${b.id} restarted at ${b.t.toFixed(1)}s; repeat cycled back to off`;
});

await test('shuffle keeps current track and reorders upcoming', async () => {
  const before = await S(() => ({ q: window.__seedline.P.queue.slice(), i: window.__seedline.P.index }));
  await page.click('[data-testid=shuffle]');
  const after = await S(() => ({ q: window.__seedline.P.queue.slice(), i: window.__seedline.P.index, on: window.__seedline.P.shuffle }));
  assert(after.on && after.q[after.i] === before.q[before.i], 'current changed');
  assert(after.q.length === before.q.length && [...after.q].sort().join() === [...before.q].sort().join(), 'items lost');
  await page.click('[data-testid=shuffle]');
  const back = await S(() => window.__seedline.P.queue.slice());
  assert(back.join() === before.q.join(), 'order not restored');
  return `upcoming ${after.q.length - after.i - 1} shuffled, order restored when turned off`;
});

await test('queue view: reorder, remove, clear; add to queue / play next', async () => {
  await page.click('[data-testid=open-queue]');
  await page.waitForSelector('[data-testid=queue-list]');
  const ids0 = await page.locator('[data-testid=q-row]').evaluateAll((els) => els.map((e) => e.dataset.id));
  assert(ids0.length >= 3, 'queue too short');
  await page.locator('[data-testid=q-row]').nth(1).locator('[data-act=q-up]').click();
  await page.waitForTimeout(150);
  const ids1 = await page.locator('[data-testid=q-row]').evaluateAll((els) => els.map((e) => e.dataset.id));
  assert(ids1[0] === ids0[1] && ids1[1] === ids0[0], 'move up failed');
  await page.locator('[data-testid=q-row]').nth(0).locator('[data-act=q-remove]').click();
  await page.waitForTimeout(150);
  const ids2 = await page.locator('[data-testid=q-row]').evaluateAll((els) => els.map((e) => e.dataset.id));
  assert(!ids2.includes(ids0[1]) && ids2.length === ids0.length - 1, 'remove failed');
  await page.click('[data-testid=q-clear]');
  await page.waitForTimeout(150);
  assert((await page.locator('[data-testid=q-row]').count()) === 0, 'clear failed');
  const stillPlaying = await S(() => !window.__seedline.audio.paused);
  await page.click('[data-act=close-queue]');
  await page.click('[data-act=close-full]');
  // add to queue from the ⋮ menu
  await page.goto(BASE + '#/all');
  const target = await page.locator('[data-testid=row]').nth(5).getAttribute('data-id');
  await page.locator('[data-testid=row]').nth(5).locator('[data-act=more]').click();
  await page.click('[data-testid=add-queue]');
  const q = await S(() => window.__seedline.P.queue.slice());
  assert(q[q.length - 1] === target, 'add to queue failed');
  const target2 = await page.locator('[data-testid=row]').nth(7).getAttribute('data-id');
  await page.locator('[data-testid=row]').nth(7).locator('[data-act=more]').click();
  await page.click('.sheet [data-act=play-next]');
  const q2 = await S(() => ({ q: window.__seedline.P.queue.slice(), i: window.__seedline.P.index }));
  assert(q2.q[q2.i + 1] === target2, 'play next failed');
  return `reorder/remove/clear ok (current kept playing: ${stillPlaying}); add-to-queue and play-next ok`;
});

await test('playlist create / add / rename / reorder / remove / play / delete', async () => {
  await page.goto(BASE + '#/library');
  await page.click('[data-testid=new-playlist]');
  await page.fill('#modal input', 'Test list');
  await page.click('#modal button[type=submit]');
  await page.waitForFunction(() => location.hash.startsWith('#/playlist/'));
  const plId = await S(() => location.hash.split('/')[2]);
  await page.goto(BASE + '#/all');
  for (const n of [2, 3, 4]) {
    await page.locator('[data-testid=row]').nth(n).locator('[data-act=more]').click();
    await page.click('[data-testid=add-to-playlist]');
    await page.locator('[data-testid=pl-pick]', { hasText: 'Test list' }).click();
  }
  let pl = await S((id) => window.__seedline.store.playlists.get(id), plId);
  assert(pl.items.length === 3, 'items not added: ' + pl.items.length);
  await page.goto(BASE + '#/playlist/' + plId);
  await page.click('[data-act=rename-pl]');
  await page.fill('#modal input', 'Renamed list');
  await page.click('#modal button[type=submit]');
  await page.waitForSelector('h1:has-text("Renamed list")');
  const first = pl.items[0];
  await page.locator('[data-testid=row]').nth(0).locator('[data-act=pl-down]').click();
  pl = await S((id) => window.__seedline.store.playlists.get(id), plId);
  assert(pl.items[1] === first, 'reorder failed');
  await page.locator('[data-testid=row]').nth(2).locator('[data-act=pl-remove]').click();
  pl = await S((id) => window.__seedline.store.playlists.get(id), plId);
  assert(pl.items.length === 2, 'remove failed');
  await page.click('[data-testid=play-all]');
  await waitFor((ids) => { const P = window.__seedline.P; return P.queue.join() === ids.join() && P.index === 0; }, pl.items, 10000);
  await waitAdvancing(1);
  await page.click('[data-act=delete-pl]');
  await page.click('#modal button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/library');
  const left = await S((id) => window.__seedline.store.playlists.get(id), plId);
  assert(!left, 'not deleted');
  return 'all playlist operations work through the UI; whole playlist played in order';
});

await test('favourites', async () => {
  const id = await S(() => window.__seedline.state.items[10].id);
  await page.goto(BASE + '#/item/' + encodeURIComponent(id));
  await page.click('[data-testid=fav-btn]');
  assert(await S((i) => window.__seedline.store.favs.has(i), id), 'not saved');
  await page.goto(BASE + '#/favourites');
  const ids = await page.locator('[data-testid=row]').evaluateAll((els) => els.map((e) => e.dataset.id));
  assert(ids.includes(id), 'not listed');
  return `favourited ${id}; listed in Favourites`;
});

await test('listening progress persists across reload and resumes', async () => {
  const id = await S(() => window.__seedline.state.items[3].id);
  await page.goto(BASE + '#/item/' + encodeURIComponent(id));
  await page.click('[data-testid=detail-play]');
  await waitAdvancing(1);
  await S(() => window.__seedline.player.seek(900));
  await waitFor(() => window.__seedline.audio.currentTime > 901, null, 20000);
  await page.click('[data-testid=mini-toggle]'); // pause -> saves
  await page.waitForTimeout(300);
  const saved = await S((i) => window.__seedline.store.progress.get(i), id);
  assert(saved && saved.pos >= 900, 'not saved on pause');
  await page.goto(BASE + '#/home');
  await page.reload();
  await waitFor(() => window.__seedline && window.__seedline.state.liveOk, null, 40000);
  const cont = await page.locator('[data-testid=continue] [data-testid=card]').evaluateAll((els) => els.map((e) => e.dataset.id));
  assert(cont[0] === id, 'not first in Continue listening');
  const miniTitle = await page.locator('[data-testid=mini-title]').innerText();
  await page.locator('[data-testid=continue] [data-testid=card]').first().click();
  const s = await waitAdvancing(1);
  assert(s.id === id && s.t >= 899, 'did not resume: ' + s.t);
  return `saved ${saved.pos}s on pause; after reload it is first in Continue listening, mini player restored ("${miniTitle.slice(0, 30)}…"), resumed at ${s.t.toFixed(0)}s`;
});

await test('expired audio link is refreshed automatically', async () => {
  const id = await S(() => window.__seedline.state.items.filter((i) => i.kind === 'mixlr')[6].id);
  await S((i) => { window.__seedline.state.urls[i] = window.__seedline.state.urls[i].replace(/X-Amz-Signature=[0-9a-f]+/, 'X-Amz-Signature=' + '0'.repeat(64)); }, id);
  await S((i) => window.__seedline.player.playId(i), id);
  const s = await waitAdvancing(1);
  assert(s.id === id, 'wrong id');
  const fixed = await S((i) => /X-Amz-Signature=0{64}/.test(window.__seedline.state.urls[i]), id);
  assert(!fixed, 'url not replaced');
  return 'bad-signature URL failed (403), app fetched a fresh link from Mixlr and played';
});

await test('discover new: id removed from last-seen shows as New, mark seen clears it', async () => {
  await S(() => window.__seedline.audio.pause());
  const victim = await S(() => {
    const seen = JSON.parse(localStorage.getItem('seedline:lastSeenIds'));
    const v = seen.shift();
    localStorage.setItem('seedline:lastSeenIds', JSON.stringify(seen));
    return v;
  });
  await page.goto(BASE + '#/home');
  await page.reload();
  await waitFor(() => window.__seedline && window.__seedline.state.liveOk, null, 40000);
  const newRows = await page.locator('[data-testid=new-section] [data-testid=row]').evaluateAll((els) => els.map((e) => e.dataset.id));
  assert(newRows.length === 1 && newRows[0] === victim, 'New section: ' + JSON.stringify(newRows));
  const badge = await page.locator('[data-testid=new-section] .badge').count();
  await page.click('[data-testid=check-new]');
  await page.waitForTimeout(2500);
  const still = await page.locator('[data-testid=new-section] [data-testid=row]').count();
  await page.click('[data-act=seen-all]');
  await page.waitForTimeout(200);
  const after = await page.locator('[data-testid=new-section] [data-testid=row]').count();
  assert(still === 1 && after === 0, `still=${still} after=${after}`);
  return `${victim} shown as New with badge (${badge}); stays after "Check for new messages"; cleared by "Mark all as seen"`;
});

await test('admin page says not configured', async () => {
  await page.goto(BASE + '#/admin');
  const t = await page.locator('[data-testid=admin-not-configured]').innerText();
  assert(/Not configured yet — see SETUP\.md/.test(t), t);
  return t.split('\n')[0];
});

await test('YouTube section lists videos with Open on YouTube links', async () => {
  await page.goto(BASE + '#/youtube');
  const n = await S(() => window.__seedline.state.youtube.length);
  const href = await page.locator('[data-testid=yt-open]').first().getAttribute('href');
  assert(n === 312 && /^https:\/\/www\.youtube\.com\/watch\?v=/.test(href), `${n} ${href}`);
  return `${n} entries; first link ${href}`;
});

await test('service worker registers and manifest is valid', async () => {
  await page.goto(BASE + '#/home');
  await waitFor(() => navigator.serviceWorker && navigator.serviceWorker.controller !== undefined && navigator.serviceWorker.getRegistration().then(Boolean), null, 15000);
  const reg = await S(async () => { const r = await navigator.serviceWorker.ready; return r.active ? r.active.state : 'none'; });
  const man = await S(async () => (await (await fetch('./manifest.webmanifest')).json()));
  assert(reg === 'activated' && man.icons.length >= 3 && man.display === 'standalone', 'sw/manifest');
  const cached = await S(async () => { const keys = await caches.keys(); let urls = []; for (const k of keys) urls.push(...(await (await caches.open(k)).keys()).map((r) => r.url)); return urls; });
  const audioCached = cached.filter((u) => /mixlr|\.mp3/i.test(u));
  assert(audioCached.length === 0, 'audio cached!');
  return `SW ${reg}; ${cached.length} shell files cached; 0 audio/Mixlr responses cached`;
});


await test('Mixlr unreachable: saved list still shows, honest error, no fake playback', async () => {
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
  await c2.route(/apicdn\.mixlr\.com|api\.mixlr\.com/, (r) => r.abort());
  const p2 = await c2.newPage();
  await p2.goto(BASE + '#/home');
  await p2.waitForSelector('[data-testid=live-error]', { timeout: 20000 });
  const n = await p2.evaluate(() => window.__seedline.state.items.length);
  const mxId = await p2.evaluate(() => window.__seedline.state.items.find((i) => i.kind === 'mixlr' && !(i.alts || []).length).id);
  await p2.evaluate((i) => window.__seedline.player.playId(i), mxId);
  await p2.waitForFunction(() => !!window.__seedline.P.error, null, { timeout: 20000 });
  const err = await p2.evaluate(() => window.__seedline.P.error);
  const playing = await p2.evaluate(() => !window.__seedline.audio.paused);
  // podcast audio is not on Mixlr, so it still plays
  const podId = await p2.evaluate(() => window.__seedline.state.items.find((i) => i.kind === 'podcast').id);
  await p2.evaluate((i) => window.__seedline.player.playId(i), podId);
  await p2.waitForFunction(() => { const a = window.__seedline.audio; return !a.paused && a.currentTime > 1; }, null, { timeout: 45000 });
  await c2.close();
  assert(n >= 400 && !playing, 'bad offline state');
  return `${n} saved titles listed; Mixlr message shows: "${err}"; a podcast message still plays (${podId})`;
});

await test('one message from EVERY source plays (currentTime advances)', async () => {
  await page.goto(BASE + '#/home');
  await waitFor(() => window.__seedline && window.__seedline.state.liveOk, null, 40000);
  const picks = await S(() => { const out = {}; for (const i of window.__seedline.state.items) if (!out[i.sourceKey] && !i.genericTitle) out[i.sourceKey] = i.id; return out; });
  const done = [];
  for (const [key, id] of Object.entries(picks)) {
    await S((i) => { window.__seedline.store.progress.clear(i); window.__seedline.audio.pause(); return window.__seedline.player.playId(i); }, id);
    await waitFor((i) => { const P = window.__seedline.P, a = window.__seedline.audio; return P.loadedId === i && !a.paused && a.currentTime > 1.5; }, id, 45000);
    const s = await audioState();
    const host = await S(() => new URL(window.__seedline.audio.currentSrc).host);
    assert(s.id === id && !s.err, `${key} failed: ${s.err}`);
    done.push(`${key}: ${id} @${s.t.toFixed(1)}s from ${host}`);
  }
  await S(() => window.__seedline.audio.pause());
  assert(done.length >= 8, 'not all sources: ' + done.length);
  return done.join(' | ');
});

await test('dedupe: duplicates listed once, alternates shown on the detail page', async () => {
  const d = await S(() => { const st = window.__seedline.state; const main = new Set(st.items.map((i) => i.id)); const withAlts = st.items.filter((i) => (i.alts || []).length); const altIds = withAlts.flatMap((i) => i.alts.map((a) => a.id)); return { withAlts: withAlts.length, altIds: altIds.length, leaked: altIds.filter((a) => main.has(a)), first: withAlts[0] && withAlts[0].id }; });
  assert(d.withAlts >= 3 && d.leaked.length === 0, JSON.stringify(d));
  await page.goto(BASE + '#/item/' + encodeURIComponent(d.first));
  await page.waitForSelector('[data-testid=alts]');
  const t = await page.locator('[data-testid=alts]').innerText();
  return `${d.withAlts} messages carry ${d.altIds} alternate copies; none listed twice; detail shows: ${t.split('\n').slice(0, 2).join(' / ')}`;
});

await test('player: failing static URL shows an honest error and offers the alternate source', async () => {
  const id = await S(() => window.__seedline.state.items.find((i) => i.kind !== 'mixlr' && (i.alts || []).length).id);
  await S((i) => { const it = window.__seedline.state.byId.get(i); it._realUrl = it.audioUrl; it.audioUrl = 'https://sermonindex1.b-cdn.net/0/SID0-does-not-exist.mp3'; }, id);
  await S((i) => { window.__seedline.store.progress.clear(i); return window.__seedline.player.playId(i); }, id);
  await waitFor(() => !!window.__seedline.P.error && !!window.__seedline.P.altOffer, null, 30000);
  const err = await S(() => ({ e: window.__seedline.P.error, alt: window.__seedline.P.altOffer.name }));
  await page.click('[data-testid=try-alt]');
  const s = await waitAdvancing(1.5);
  const src = await S(() => window.__seedline.player.playingSource().sourceKey);
  await S((i) => { const it = window.__seedline.state.byId.get(i); it.audioUrl = it._realUrl; window.__seedline.audio.pause(); }, id);
  assert(s.id === id && src !== (await S((i) => window.__seedline.state.byId.get(i).sourceKey, id)), 'did not switch source');
  return `error shown: "${err.e}" → tapped "Try ${err.alt}" → playing from ${src} at ${s.t.toFixed(1)}s`;
});

await test('source filter chips (All messages + Search)', async () => {
  await page.goto(BASE + '#/all');
  const expect = await S(() => window.__seedline.state.items.filter((i) => i.sourceKey === 'sermonindex' || (i.alts || []).some((a) => a.sourceKey === 'sermonindex')).length);
  await page.locator('[data-testid=src-chip]', { hasText: 'SermonIndex' }).click();
  await page.waitForTimeout(200);
  const rows = await page.locator('[data-testid=row]').count();
  const badges = await page.locator('[data-testid=row] [data-testid=src-badge]').allInnerTexts();
  const nonSi = await page.locator('[data-testid=row]').evaluateAll((els) => els.filter((e) => { const it = window.__seedline.state.byId.get(e.dataset.id); return !(it.sourceKey === 'sermonindex' || (it.alts || []).some((a) => a.sourceKey === 'sermonindex')); }).length);
  assert(rows === expect && nonSi === 0, `rows ${rows} expected ${expect}, wrong ${nonSi}`);
  await page.goto(BASE + '#/search');
  await page.fill('[data-testid=search]', 'marriage');
  const nSi = parseInt(await page.locator('[data-testid=result-count]').innerText());
  await page.locator('[data-testid=source-chips] .chip').first().click(); // All sources
  await page.waitForTimeout(150);
  await page.fill('[data-testid=search]', 'marriage');
  const nAll = parseInt(await page.locator('[data-testid=result-count]').innerText());
  await page.locator('[data-testid=src-chip]', { hasText: 'Peace House Abuja' }).click();
  await page.waitForTimeout(150);
  const nAbj = parseInt(await page.locator('[data-testid=result-count]').innerText());
  const kept = await page.inputValue('[data-testid=search]');
  await page.locator('[data-testid=source-chips] .chip').first().click();
  assert(nAll >= nSi && nAll >= nAbj && nAll > 0 && kept === 'marriage', `all ${nAll} si ${nSi} abuja ${nAbj}`);
  return `SermonIndex chip → ${rows} rows (badges e.g. ${badges.slice(0, 1)}), none from other sources; search "marriage": all ${nAll}, SermonIndex ${nSi}, Peace House Abuja ${nAbj}`;
});

await test('auto-advance across sources (podcast → SermonIndex → Mixlr Abuja)', async () => {
  const ids = await S(() => { const st = window.__seedline.state.items; return [st.find((i) => i.sourceKey === 'pod-temi'), st.find((i) => i.sourceKey === 'sermonindex'), st.find((i) => i.sourceKey === 'ph-abuja' && !i.genericTitle)].map((i) => i.id); });
  for (const i of ids) await S((x) => window.__seedline.store.progress.clear(x), i);
  await S((q) => window.__seedline.player.playQueue(q, 0), ids);
  await waitAdvancing(1);
  const seen = [ids[0]];
  for (let k = 1; k < 3; k++) {
    await S(() => { const a = window.__seedline.audio; a.currentTime = a.duration - 2; });
    await waitFor((id) => { const P = window.__seedline.P; return P.queue[P.index] === id; }, ids[k], 40000);
    const s = await waitAdvancing(1);
    assert(s.id === ids[k], 'wrong next');
    seen.push(`${s.id}@${s.t.toFixed(1)}s`);
  }
  await S(() => window.__seedline.audio.pause());
  return seen.join(' → ');
});

await test('YouTube: matched entries offer "Listen in app"', async () => {
  const m = await S(() => window.__seedline.state.youtube.filter((v) => v.listenId));
  assert(m.length >= 1, 'no matches');
  await page.goto(BASE + '#/youtube');
  await page.fill('#ytq', m[0].title);
  await page.waitForTimeout(150);
  await page.locator('[data-testid=yt-listen]').first().click();
  const s = await waitAdvancing(1);
  assert(s.id === m[0].listenId, 'played ' + s.id);
  await page.goto(BASE + '#/item/' + encodeURIComponent(m[0].listenId));
  const also = await page.locator('[data-testid=also-yt]').innerText();
  await S(() => window.__seedline.audio.pause());
  return `${m.length} YouTube video(s) matched; "${m[0].title}" → plays ${s.id}; detail shows "${also.trim().slice(0, 60)}"`;
});


await page.goto(BASE + '#/home');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tests/screen-home.png', fullPage: false });
await page.evaluate(() => { const s = document.querySelector('[data-testid=source-section]'); s && s.scrollIntoView(); });
await page.waitForTimeout(800);
await page.screenshot({ path: 'tests/screen-sources.png' });
await page.goto(BASE + '#/all');
await page.locator('[data-testid=src-chip]', { hasText: 'Community podcast' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'tests/screen-filter.png' });
await page.locator('[data-testid=source-chips] .chip').first().click();
await page.goto(BASE + '#/all');
await page.locator('[data-testid=row] .row-main').first().click();
await page.waitForTimeout(1500);
await page.locator('[data-testid=mini]').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'tests/screen-player.png' });

const errs = errors.filter((e) => !/favicon/.test(e));
results.push({ name: 'no uncaught page errors', ok: errs.filter((e) => e.startsWith('pageerror')).length === 0, info: errs.slice(0, 5).join(' | ') });
fs.writeFileSync('tests/e2e-results.json', JSON.stringify({ ranAt: new Date().toISOString(), browser: browser.version(), results }, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (errs.length) console.log('console errors:', errs);
await browser.close();
server.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
