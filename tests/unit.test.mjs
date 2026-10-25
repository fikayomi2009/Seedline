// Node unit tests for the pure logic. Run: node tests/unit.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import * as L from '../js/logic.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, e.message); } };

t('series parsing', () => {
  assert.deepEqual(L.parseSeries('Bible Study 19:Devotions Of A Disciple - Introduction To Soul Winning', '2024-09-14T17:11:34Z'), { series: 'Devotions Of A Disciple', episode: 19, subtitle: 'Introduction To Soul Winning' });
  assert.equal(L.parseSeries('MLR DAY 2 EVENING', '2022-12-10T20:08:00Z').series, 'MLR 2022');
  assert.equal(L.parseSeries('MLR 2022, DAY 4 EVENING', '2022-12-10').series, 'MLR 2022');
  assert.equal(L.parseSeries('UK SOLEMN ASSEMBLY DAY 3', '2020-05-31').series, 'UK Solemn Assembly 2020');
  assert.equal(L.parseSeries('WHAT IS GRACE', '2020-06-28').series, null);
});
t('categories only from clear keywords', () => {
  assert.deepEqual(L.categorise('THE NEED FOR DISCIPLESHIP'), ['Discipleship']);
  assert.deepEqual(L.categorise('BUILDING A PERSONAL ALTAR'), ['Prayer']);
  assert.deepEqual(L.categorise('WHAT IS GRACE'), ['Uncategorised']);
  assert.deepEqual(L.categorise('LIVING SEED GBOKO on Mixlr'), ['Uncategorised']);
});
t('generic titles detected', () => {
  assert.ok(L.isGenericTitle('LSMEDIAGBK on Mixlr'));
  assert.ok(L.isGenericTitle("LIVING SEED GBOKO's live audio"));
  assert.ok(L.isGenericTitle('+2347030363659, 0703768119'));
  assert.ok(!L.isGenericTitle('DECLARATION'));
});
t('skip private and too-short recordings', () => {
  assert.ok(!L.isPlayableRecording({ attributes: { access_level: 'public', duration: 0 } }));
  assert.ok(!L.isPlayableRecording({ attributes: { access_level: 'private', duration: 5000 } }));
  assert.ok(L.isPlayableRecording({ attributes: { access_level: 'public', duration: 5000 } }));
});
t('discover-new diff', () => {
  assert.deepEqual(L.diffNew(['a', 'b'], null), { newIds: [], seen: ['a', 'b'], firstRun: true });
  assert.deepEqual(L.diffNew(['a', 'b', 'c'], ['a', 'c']).newIds, ['b']);
  assert.deepEqual(L.diffNew(['a'], ['a', 'z']).newIds, []);
});
t('merge adds live-only items and fresh urls', () => {
  const snap = JSON.parse(fs.readFileSync(new URL('../catalog.json', import.meta.url))).items;
  const live = [{ id: '999', attributes: { access_level: 'public', duration: 600, title: 'New One', created_at: '2026-10-25T10:00:00Z', url: 'https://x/a.mp3' } }];
  const { items, urls } = L.mergeLibrary(snap, live);
  assert.equal(items[0].id, 'mx:999');
  assert.equal(items.length, snap.length + 1);
  assert.equal(urls['mx:999'], 'https://x/a.mp3');
});
t('overrides: hide, retitle, admin-added flagged for permission', () => {
  const items = [{ id: 'mx:1', mixlrId: '1', title: 'A', categories: ['Uncategorised'] }, { id: 'mx:2', mixlrId: '2', title: 'B', categories: [] }];
  const out = L.applyOverrides(items, [{ mixlr_id: '1', hidden: true }, { mixlr_id: '2', title: 'B2', category: 'Faith' }, { id: 'u', title: 'Admin', audio_url: 'https://a/b.mp3' }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'B2'); assert.equal(out[0].originalTitle, 'B'); assert.deepEqual(out[0].categories, ['Faith']);
  assert.equal(out[1].needsPermission, true);
});
t('queue index helpers', () => {
  assert.equal(L.nextIndex(0, 3, 'off'), 1); assert.equal(L.nextIndex(2, 3, 'off'), -1);
  assert.equal(L.nextIndex(2, 3, 'all'), 0); assert.equal(L.nextIndex(1, 3, 'one'), 1);
  assert.equal(L.prevIndex(0, 3, 'off'), 0); assert.equal(L.prevIndex(0, 3, 'all'), 2);
  assert.deepEqual(L.moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  const s = L.shuffled([1, 2, 3, 4, 5]); assert.deepEqual([...s].sort(), [1, 2, 3, 4, 5]);
});
t('search', () => {
  const items = [{ title: 'THE NEED FOR DISCIPLESHIP', categories: ['Discipleship'] }, { title: 'MLR DAY 2', series: 'MLR 2022', categories: [] }];
  assert.equal(L.searchItems(items, 'need disciple').length, 1);
  assert.equal(L.searchItems(items, 'mlr 2022').length, 1);
  assert.equal(L.searchItems(items, '').length, 0);
});
t('time formatting & length parsing', () => {
  assert.equal(L.fmtTime(3725), '1:02:05'); assert.equal(L.fmtTime(65), '1:05');
  assert.equal(L.parseLength('1h 57m'), 7020); assert.equal(L.parseLength('1:02:03'), 3723);
});
t('catalog: every title matches the Mixlr snapshot exactly (no invented titles)', () => {
  const snap = JSON.parse(fs.readFileSync(new URL('../catalog.json', import.meta.url)));
  const ref = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2])) : null;
  if (!ref) return;
  const titles = new Map(ref.map((r) => [ 'mx:' + r.id, r.attributes.title.trim() ]));
  for (const it of snap.items) assert.equal(it.title, titles.get(it.id), it.id);
});
console.log(`\n${pass}/${pass + fail} unit tests passed`);
process.exit(fail ? 1 : 0);
