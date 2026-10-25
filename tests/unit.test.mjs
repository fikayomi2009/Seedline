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
const CAT = JSON.parse(fs.readFileSync(new URL('../catalog.json', import.meta.url)));
t('catalog: multi-source shape (id prefix, source, label, playable reference)', () => {
  assert.ok(CAT.items.length > 300, 'too few items');
  const keys = new Set(L.SOURCES.map((s) => s.key));
  for (const it of CAT.items) {
    assert.ok(keys.has(it.sourceKey), 'bad source ' + it.id);
    assert.ok(['official', 'community'].includes(it.label), it.id);
    assert.ok(['mixlr', 'podcast', 'sermonindex'].includes(it.sourceType), it.id);
    const s = L.SOURCE_BY_KEY.get(it.sourceKey);
    if (s.type === 'mixlr') { assert.ok(it.id.startsWith(s.idPrefix) && it.mixlrId && !it.audioUrl, it.id); }
    else { assert.ok(it.id.startsWith(s.key + ':') || it.id.startsWith('si:'), it.id); assert.match(it.audioUrl, /^https:\/\//, it.id); }
    assert.ok(it.sourceUrl && /^https:\/\//.test(it.sourceUrl), 'no original link ' + it.id);
    assert.ok(Array.isArray(it.categories) && it.categories.length, it.id);
  }
  // official sources are never shown as community or vice versa
  for (const it of CAT.items) assert.equal(it.label, L.SOURCE_BY_KEY.get(it.sourceKey).label);
  // no duplicate ids
  assert.equal(new Set(CAT.items.map((i) => i.id)).size, CAT.items.length);
});
t('dedupe: same title + same length merges (official preferred); same title, different length does NOT', () => {
  const mk = (id, sourceKey, title, duration) => ({ id, sourceKey, title, duration, label: L.SOURCE_BY_KEY.get(sourceKey).label, source: sourceKey, sourceType: L.SOURCE_BY_KEY.get(sourceKey).type, date: '2024-01-01' });
  const r = L.dedupe([
    mk('si:1', 'sermonindex', 'Competent But Incomplete', 5256),
    mk('pod-temi:a', 'pod-temi', 'Competent But Incomplete By Bro Gbile Akanni', 5267),
    mk('mxa:9', 'ph-abuja', 'Competent but Incomplete', 18847),            // different length -> separate
    mk('mx:7', 'ls-gboko', 'The Great Invitation', 5000),
    mk('pod-eagle:b', 'pod-eagle', 'Brother Gbile Akanni Messages: The Great Invitation', 5030), // -> alt of official
    mk('si:2', 'sermonindex', 'Family Clinic 1', 6045),
    mk('si:3', 'sermonindex', 'Family Clinic.1', 6205),                    // same source, not an exact repost -> separate
    mk('mx:8', 'ls-gboko', 'LIVING SEED GBOKO on Mixlr', 3600),
    mk('mx:9', 'ls-gboko', 'LIVING SEED GBOKO on Mixlr', 3600),            // generic titles never merge
  ]);
  assert.equal(r.items.length, 7);
  assert.equal(r.merged, 2);
  const inv = r.items.find((i) => i.id === 'mx:7');
  assert.equal(inv.alts.length, 1); assert.equal(inv.alts[0].id, 'pod-eagle:b');
  const cbi = r.items.find((i) => i.alts && i.alts.some((a) => a.id === 'si:1'));
  assert.equal(cbi.id, 'pod-temi:a'); // community podcast ranks above SermonIndex in source order
});
t('dedupe applied to the real catalog: no main entry is also an alternate; alternates keep a playable reference', () => {
  const main = new Set(CAT.items.map((i) => i.id));
  for (const it of CAT.items) for (const a of it.alts || []) {
    assert.ok(!main.has(a.id), 'alt also main ' + a.id);
    assert.ok(a.audioUrl || a.mixlrId, 'alt without audio ' + a.id);
    assert.ok(L.sameRecording(it, a), 'alt not same recording ' + a.id);
  }
});
t('core titles and speaker attribution', () => {
  assert.equal(L.coreTitle('Brother Gbile Akanni Messages: Bro Gbile Akanni Messages : Instructions To The Unmarried'), L.coreTitle('Instructions To The Unmarried By Bro Gbile Akanni'));
  assert.equal(L.coreTitle('CONFESSION- PRACTICAL REPENTANCE PT 1 BY BRO GBILE AKANNI'), 'confession practical repentance part 1');
  assert.equal(L.speakerFromTitle('09 - PRAYER UPROAR BY SADE AKANNI, MLR, Gbile Akanni MLR_2022', 'x'), 'Sade Akanni (named in title)');
  assert.equal(L.speakerFromTitle('Possessing God by Gbile Akanni', 'x'), 'Bro Gbile Akanni');
  assert.equal(L.speakerFromTitle('Sermon On The Mount', 'x'), 'x');
});
t('mixed podcast feeds keep only episodes credited to Bro Gbile', () => {
  const eagle = L.SOURCE_BY_KEY.get('pod-eagle');
  assert.ok(L.podcastKeep(eagle, '16 - MESSAGE 5 BY GBILE AKANNI, Ministers and Leadership Retreat Gboko MLR 2022'));
  assert.ok(L.podcastKeep(eagle, "Brother Gbile Akanni Messages: You Are Not A Mistake"));
  assert.ok(!L.podcastKeep(eagle, '15 - PRAYER TIPS BY SADE AKANNI, Ministers and Leadership Retreat Gboko, Gbile Akanni MLR 2022'));
  assert.ok(!L.podcastKeep(eagle, '13 - MESSAGE 4 BY EMMANUEL AKHIMBE, Ministers and Leadership Retreat Gboko, Gbile Akanni MLR 2022'));
  assert.ok(!L.podcastKeep(eagle, '17 - MINISTERIAL CHALLENGE, Ministers and Leadership Retreat, 2022, GBOKO, Gbile Akanni MLR_2022'));
  assert.ok(!L.podcastKeep(eagle, 'Part 12 – Enough is Enough'));
  for (const it of CAT.items.filter((i) => i.sourceKey === 'pod-eagle')) assert.ok(L.podcastKeep(eagle, it.title), it.title);
});
t('YouTube matching is conservative', () => {
  const yt = [{ id: 'yt:1', title: 'Bible Study 19: Devotions Of A Disciple - Bro Gbile Akanni' }, { id: 'yt:2', title: 'Bible Study With Brother Gbile Akanni' }, { id: 'yt:3', title: 'Bible Study With Brother Gbile Akanni' }];
  const m = L.matchYouTube([{ id: 'a', title: 'Bible Study 19:Devotions Of A Disciple - Introduction To Soul Winning' }, { id: 'b', title: 'Bible Study With Brother Gbile Akanni' }, { id: 'c', title: 'Bible Study 20:Devotions Of A Disciple - X' }], yt);
  assert.equal(m.size, 1); assert.equal(m.get('a').id, 'yt:1');
  const ytj = JSON.parse(fs.readFileSync(new URL('../youtube.json', import.meta.url)));
  const linked = ytj.items.filter((v) => v.listenId);
  for (const v of linked) { const it = CAT.items.find((i) => i.id === v.listenId); assert.ok(it && it.youtube && it.youtube.id === v.id, v.id); }
  assert.equal(linked.length, CAT.stats.youtubeMatches);
});
t('multi-channel live merge: Abuja records get their own ids; alternates only refresh their URL', () => {
  const cat = [{ id: 'mxa:5', mixlrId: '5', kind: 'mixlr', sourceKey: 'ph-abuja', title: 'X', date: '2020-01-01' }, { id: 'pod-temi:z', kind: 'podcast', title: 'Y', date: '2021-01-01', alts: [{ id: 'mx:77', sourceType: 'mixlr' }] }];
  const live = [
    { id: '5', _source: 'ph-abuja', attributes: { access_level: 'public', duration: 600, title: 'X', created_at: '2020-01-01T00:00:00Z', url: 'https://a/5.mp3' } },
    { id: '77', _source: 'ls-gboko', attributes: { access_level: 'public', duration: 600, title: 'Y', created_at: '2021-01-01T00:00:00Z', url: 'https://a/77.mp3' } },
  ];
  const { items, urls } = L.mergeLibrary(cat, live);
  assert.equal(items.length, 2);
  assert.equal(urls['mxa:5'], 'https://a/5.mp3'); assert.equal(urls['mx:77'], 'https://a/77.mp3');
  assert.ok(items.find((i) => i.id === 'mxa:5').inLive);
  assert.equal(L.mixlrSourceForId('mxa:5').channel, 'peacehouseabuja');
  assert.equal(L.mixlrSourceForId('mx:5').channel, 'living-seed-gboko');
});
t('series from "Part N" titles', () => {
  assert.deepEqual(L.partSeries('Work While It Is Day Part 7 By Bro Gbile Akanni'), { series: 'Work While It Is Day', episode: 7 });
  assert.deepEqual(L.partSeries('How to be an authentic winner - Bro Gbile Akanni (Part 5)'), { series: 'How to be an authentic winner', episode: 5 });
  assert.equal(L.partSeries('Possessing God 2...Gbile Akanni'), null);
});
console.log(`\n${pass}/${pass + fail} unit tests passed`);
process.exit(fail ? 1 : 0);
