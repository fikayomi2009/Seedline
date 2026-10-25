// Admin dashboard. Only works after the optional Supabase setup in SETUP.md.
import { isConfigured, getSupabase } from './supa.js';
import { state, loadAdminData } from './data.js';
import { CATEGORIES, UNCATEGORISED } from './logic.js';

const SETUP_URL = 'https://github.com/fikayomi2009/Seedline/blob/main/SETUP.md';

export async function renderAdmin(root, { esc, toast, dialog }) {
  const head = `<header class="top"><button class="icon-btn" data-act="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15.4 4.6 8 12l7.4 7.4-1.4 1.4L5.2 12 14 3.2z"/></svg></button><h1>Admin</h1><span></span></header>`;
  if (!isConfigured()) {
    root.innerHTML = `${head}<div class="notice warn" data-testid="admin-not-configured">
      <b>Not configured yet — see SETUP.md</b><br>
      The admin dashboard needs a free Supabase project to store shared edits. Until it's set up, nothing here works and nothing is saved.
      Everything else in Seedline works without it.</div>
      <p><a class="btn outline" href="${SETUP_URL}" target="_blank" rel="noopener">Open SETUP.md</a></p>`;
    return;
  }
  root.innerHTML = `${head}<p class="sub">Connecting…</p>`;
  const sb = await getSupabase();
  if (!sb) { root.innerHTML = `${head}<div class="notice warn">Could not load the Supabase library (are you online?).</div>`; return; }

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return signInForm();
  const { data: adminRow, error: adminErr } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (adminErr || !adminRow) {
    root.innerHTML = `${head}<div class="notice warn">Signed in as ${esc(session.user.email)}, but this account is not in the admins table, so it can't make changes.</div><button class="btn ghost" id="so">Sign out</button>`;
    root.querySelector('#so').onclick = async () => { await sb.auth.signOut(); renderAdmin(root, { esc, toast, dialog }); };
    return;
  }
  return dashboard(session);

  function signInForm(msg = '') {
    root.innerHTML = `${head}<form class="form" id="si"><p class="sub">Admins only. There is no sign-up here; the admin account is created in Supabase (see SETUP.md).</p>
      ${msg ? `<div class="notice warn">${esc(msg)}</div>` : ''}
      <label>Email<input class="field" name="email" type="email" required autocomplete="username"></label>
      <label>Password<input class="field" name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary" type="submit">Sign in</button></form>`;
    root.querySelector('#si').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
      if (error) return signInForm(error.message);
      renderAdmin(root, { esc, toast, dialog });
    };
  }

  async function dashboard(session) {
    const [{ data: rows = [] }, { data: feats = [] }] = await Promise.all([
      sb.from('messages').select('*').order('created_at', { ascending: false }),
      sb.from('featured_playlists').select('*').order('sort'),
    ]);
    const byMixlr = new Map(rows.filter((r) => r.mixlr_id).map((r) => [String(r.mixlr_id), r]));
    const added = rows.filter((r) => !r.mixlr_id);
    const catOpts = (sel) => `<option value="">(auto)</option>${[...CATEGORIES, UNCATEGORISED].map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
    const mixlrItems = state.items.filter((i) => i.kind === 'mixlr');
    // include hidden ones (they are filtered out of state.items) so they can be un-hidden
    const hiddenIds = rows.filter((r) => r.mixlr_id && r.hidden).map((r) => String(r.mixlr_id));

    root.innerHTML = `${head}
      <p class="sub">Signed in as ${esc(session.user.email)} · <button class="link" id="so">Sign out</button></p>
      <section><h2 class="h2">Add a message</h2>
      <form class="form" id="add">
        <label>Title<input class="field" name="title" required maxlength="200"></label>
        <label>Series (optional)<input class="field" name="series" maxlength="120"></label>
        <label>Topic<select class="field" name="category">${catOpts('')}</select></label>
        <label>Recorded on (optional)<input class="field" name="recorded_on" type="date"></label>
        <label>Direct audio URL (MP3)<input class="field" name="audio_url" type="url" required placeholder="https://..."></label>
        <label>Source page URL (where it was published)<input class="field" name="source_url" type="url"></label>
        <label class="check"><input type="checkbox" name="perm" required> I have permission from the owner of this recording to stream it here.</label>
        <p class="sub">Entries with a direct audio link are shown to listeners as "requires permission from the owner".</p>
        <button class="btn primary">Add</button></form></section>
      <section><h2 class="h2">Admin-added (${added.length})</h2>
        <div class="list">${added.map((r) => `<div class="row"><span class="row-text"><span class="row-title">${esc(r.title)}${r.hidden ? ' <em>(hidden)</em>' : ''}</span><span class="row-meta">${esc(r.series || '')} ${esc(r.category || '')}</span></span>
          <button class="btn ghost small" data-hide="${esc(r.id)}" data-v="${r.hidden ? 0 : 1}">${r.hidden ? 'Unhide' : 'Hide'}</button><button class="btn ghost small" data-del="${esc(r.id)}">Delete</button></div>`).join('') || '<p class="empty">None.</p>'}</div></section>
      <section><h2 class="h2">Edit Mixlr messages</h2><p class="sub">Overrides are shown to everyone. The original Mixlr title stays visible on the message page.</p>
        <div class="list">${[...mixlrItems.map((i) => i.mixlrId), ...hiddenIds].filter((v, i, a) => a.indexOf(v) === i).map((mid) => {
          const it = state.byId.get('mx:' + mid) || { title: '(hidden) Mixlr #' + mid, mixlrId: mid };
          const o = byMixlr.get(mid) || {};
          return `<form class="row form-row" data-mx="${esc(mid)}">
            <input class="field" name="title" value="${esc(o.title || '')}" placeholder="${esc(it.originalTitle || it.title)}">
            <input class="field" name="series" value="${esc(o.series || '')}" placeholder="Series">
            <select class="field" name="category">${catOpts(o.category || '')}</select>
            <label class="check"><input type="checkbox" name="hidden" ${o.hidden ? 'checked' : ''}> Hide</label>
            <button class="btn ghost small">Save</button></form>`;
        }).join('')}</div></section>
      <section><h2 class="h2">Featured playlists</h2>
        <form class="form" id="feat"><label>Title<input class="field" name="title" required></label>
          <label>Description<input class="field" name="description"></label>
          <label>Message ids, one per line, in order (e.g. mx:2552216)<textarea class="field" name="ids" rows="4"></textarea></label>
          <button class="btn primary">Create featured playlist</button></form>
        <div class="list">${feats.map((f) => `<div class="row"><span class="row-text"><span class="row-title">${esc(f.title)}</span><span class="row-meta">${(f.item_ids || []).length} items</span></span>
          <button class="btn ghost small" data-fedit="${esc(f.id)}">Edit ids</button><button class="btn ghost small" data-fdel="${esc(f.id)}">Delete</button></div>`).join('') || '<p class="empty">None.</p>'}</div></section>`;

    const done = async (res, msg) => {
      if (res.error) { toast('Error: ' + res.error.message, 5000); return; }
      toast(msg); await loadAdminData(); renderAdmin(root, { esc, toast, dialog });
    };
    root.querySelector('#so').onclick = async () => { await sb.auth.signOut(); renderAdmin(root, { esc, toast, dialog }); };
    root.querySelector('#add').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      done(await sb.from('messages').insert({ title: f.title, series: f.series || null, category: f.category || null, recorded_on: f.recorded_on || null, audio_url: f.audio_url, source_url: f.source_url || null, permission_confirmed: true }), 'Added');
    };
    root.querySelectorAll('[data-hide]').forEach((b) => b.onclick = async () => done(await sb.from('messages').update({ hidden: b.dataset.v === '1' }).eq('id', b.dataset.hide), 'Saved'));
    root.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await dialog({ title: 'Delete this entry?', confirm: true, okText: 'Delete', danger: true })) done(await sb.from('messages').delete().eq('id', b.dataset.del), 'Deleted'); });
    root.querySelectorAll('form[data-mx]').forEach((fm) => fm.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(fm);
      const rec = { mixlr_id: fm.dataset.mx, title: f.get('title') || null, series: f.get('series') || null, category: f.get('category') || null, hidden: f.get('hidden') === 'on' };
      done(await sb.from('messages').upsert(rec, { onConflict: 'mixlr_id' }), 'Saved');
    });
    const parseIds = (t) => String(t || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    root.querySelector('#feat').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      done(await sb.from('featured_playlists').insert({ title: f.title, description: f.description || null, item_ids: parseIds(f.ids), sort: feats.length }), 'Created');
    };
    root.querySelectorAll('[data-fdel]').forEach((b) => b.onclick = async () => { if (await dialog({ title: 'Delete featured playlist?', confirm: true, okText: 'Delete', danger: true })) done(await sb.from('featured_playlists').delete().eq('id', b.dataset.fdel), 'Deleted'); });
    root.querySelectorAll('[data-fedit]').forEach((b) => b.onclick = async () => {
      const f = feats.find((x) => String(x.id) === b.dataset.fedit);
      const v = await dialog({ title: 'Message ids (comma-separated, in order)', value: (f.item_ids || []).join(', '), okText: 'Save' });
      if (v !== null) done(await sb.from('featured_playlists').update({ item_ids: parseIds(v) }).eq('id', f.id), 'Saved');
    });
  }
}
