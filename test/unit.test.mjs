// Unit tests for the pure modules. Run with `npm test` (TZ is pinned to Asia/Ho_Chi_Minh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekKey, dayKey, monthKey, periodKey, safeName, isoLocal } from '../extension/core/util.js';
import { mediaPath, convDir, defaultExt } from '../extension/modules/chats/paths.js';
import { mergeMessage, addInterval, intervalAt } from '../extension/modules/chats/merge.js';
import { buildExport, relPath, attachmentLine, textEntities, HTML_PAGE_SIZE, NOT_INCLUDED } from '../extension/modules/chats/export.js';
import { msg, content, quote, forwardedRef, photoUrls } from './fixtures/zalo.mjs';
import '../extension/modules/chats/normalize.js';

const { normalizeMessage, jpegUrl, uidsOf } = globalThis.ZLXNormalize;
const at = (y, m, d, H = 12, M = 0) => new Date(y, m - 1, d, H, M).getTime();
const G = 'g8000000000000000001', A = '1000000000000000001', B = '2000000000000000002';
const make = (ts, from, [type, body], extra) => msg(G, ts, from, type, body, extra);
const norm = (ts, from, c, extra) => normalizeMessage(make(ts, from, c, extra), G);

// ---------- util ----------
test('ISO week keys, including year boundaries', () => {
  assert.equal(weekKey(at(2021, 1, 3)), '2020-W53');
  assert.equal(weekKey(at(2021, 1, 4)), '2021-W01');
  assert.equal(weekKey(at(2026, 9, 24)), '2026-W39');
  assert.equal(weekKey(at(2026, 9, 27, 23, 59)), '2026-W39');
  assert.equal(weekKey(at(2026, 9, 28, 0, 1)), '2026-W40');
});

test('day and month keys use local time', () => {
  assert.equal(process.env.TZ, 'Asia/Ho_Chi_Minh');
  const ts = Date.UTC(2026, 8, 23, 18, 30);
  assert.equal(dayKey(ts), '2026-09-24');
  assert.equal(monthKey(ts), '2026-09');
  assert.equal(periodKey(ts, 'none'), 'all');
  assert.equal(isoLocal(ts), '2026-09-24T01:30:00+07:00');
});

test('safe file names keep Vietnamese letters and drop spaces and brackets', () => {
  assert.equal(safeName('Nhóm Gia Đình (2026) 👨‍👩‍👧'), 'Nhóm_Gia_Đình_2026');
  assert.equal(safeName('a/b: c?'), 'a_b_c');
  assert.equal(safeName(''), '_');
});

// ---------- normalize ----------
test('normalize: plain and formatted text, sender, ids and time', () => {
  const ts = at(2026, 9, 24, 12, 41);
  const r = norm(ts, A, content.text('Xin chào'));
  assert.equal(r.convId, G);
  assert.equal(r.ts, ts);
  assert.equal(r.kind, 'text');
  assert.equal(r.text, 'Xin chào');
  assert.equal(r.senderId, A);
  assert.match(r.id, /^\d{13}$/);
  const s = norm(ts, A, content.styled('Bold and plain', [{ start: 0, len: 4, st: 'b' }, { start: 5, len: 3, st: 'c_db342e' }, { start: 9, len: 5, st: 'i,u' }]));
  assert.equal(s.text, 'Bold and plain');
  assert.deepEqual(s.styles, [{ start: 0, len: 4, st: 'b' }, { start: 9, len: 5, st: 'i' }, { start: 9, len: 5, st: 'u' }]);
  assert.equal(norm(ts, A, content.text('0987654321')).text, '0987654321'); // digits stay text
});

test('normalize: photos, GIFs, videos, voice and files become attachments', () => {
  const ts = at(2026, 9, 24);
  const p = norm(ts, A, content.photo('p1', 'caption here'));
  const u = photoUrls('p1');
  assert.equal(p.kind, 'photo');
  assert.equal(p.text, 'caption here');
  assert.deepEqual(p.attachments, [{ id: p.id, kind: 'photo', url: u.hd, alts: [u.ori, u.normal], thumb: u.thumb, width: 1280, height: 960 }]);
  const gp = norm(ts, A, content.groupPhoto('p2'));
  assert.equal(gp.attachments[0].url, photoUrls('p2').ori);
  assert.equal(gp.text, undefined);
  const g = norm(ts, A, content.gif('g1'));
  assert.deepEqual([g.kind, g.attachments[0].url, g.attachments[0].size], ['gif', 'https://zgif-v1.zdn.vn/og1.gif', 12345]);
  const v = norm(ts, A, content.video('v1'));
  assert.deepEqual(v.attachments[0], { id: v.id, kind: 'video', url: 'https://video-stal-1.dlmd.me/vv1', thumb: 'https://photo-stal-1.zdn.vn/vtv1.jpg', width: 1280, height: 720, durationMs: 12000, size: 3000000 });
  const a = norm(ts, A, content.voice('a1'));
  assert.deepEqual(a.attachments[0], { id: a.id, kind: 'voice', url: 'https://voice-stal-1.zdn.vn/aa1.aac', durationMs: 8000 });
  const f = norm(ts, A, content.file('f1', 'Báo cáo quý 3.xlsx', '1048576'));
  assert.deepEqual(f.attachments[0], { id: f.id, kind: 'file', url: 'https://file-stal-1.dlfl.vn/ff1', filename: 'Báo cáo quý 3.xlsx', size: 1048576, ext: 'xlsx' });
});

test('normalize: stickers, links, contact cards, article cards, locations, calls, polls, Zalo cards', () => {
  const ts = at(2026, 9, 24);
  assert.deepEqual(norm(ts, A, content.sticker()).sticker, { catId: 10, id: 1234 });
  const l = norm(ts, A, content.link('https://example.com/a'));
  assert.equal(l.kind, 'link');
  assert.equal(l.text, 'https://example.com/a');
  assert.deepEqual(l.link, { url: 'https://example.com/a', title: 'Page title', description: 'Page description', thumb: 'https://photo-stal-1.zdn.vn/l.jpg' });
  const c = norm(ts, A, content.contact('Chị Lan'));
  assert.deepEqual([c.kind, c.text, c.contact.name], ['contact', 'Chị Lan', 'Chị Lan']);
  assert.deepEqual(norm(ts, A, content.cards()).cards.map(x => x.title), ['News one', 'News two']);
  assert.deepEqual(norm(ts, A, content.location()).location, { lat: 10.7725, lng: 106.698, title: 'Ben Thanh Market' });
  assert.deepEqual(norm(ts, A, content.call(125)).call, { durationSec: 125, video: false, reason: 0 });
  assert.equal(norm(ts, A, content.poll('Đi đâu?')).text, 'Đi đâu?');
  const z = norm(ts, A, content.zinstant());
  assert.deepEqual([z.kind, z.text], ['card', 'Nhắc hẹn: họp nhóm']);
});

test('normalize: recalled, quotes, mentions, forwards, disappearing messages, the account\'s own messages', () => {
  const ts = at(2026, 9, 24);
  const r = norm(ts, A, content.recalled());
  assert.deepEqual([r.kind, r.recalled, r.text], ['recalled', true, undefined]);
  const target = make(ts - 60000, B, content.text('câu gốc'));
  const q = norm(ts, A, content.text('trả lời'), { quote: quote(target, 'Bình') });
  assert.deepEqual(q.replyTo, { id: target.msgId, senderId: B, senderName: 'Bình', text: 'câu gốc', ts: ts - 60000, type: 1 });
  const photoQuote = norm(ts, A, content.text('đẹp'), { quote: quote(target, 'Bình', { msg: '', attach: JSON.stringify({ title: '', thumbUrl: 'https://photo-stal-1.zdn.vn/x.jpg' }) }) });
  assert.equal(photoQuote.replyTo.hasMedia, true);
  const m = norm(ts, A, content.text('@Bình @All xem'), { mentions: [{ uid: B, pos: 0, len: 5, type: 0 }, { uid: '-1', pos: 6, len: 4, type: 1 }] });
  assert.deepEqual(m.mentions, [{ uid: B, pos: 0, len: 5, type: 0 }, { uid: '-1', pos: 6, len: 4, type: 1 }]);
  assert.deepEqual(uidsOf({ ...m, replyTo: { senderId: B } }), [A, B, B]);
  assert.equal(norm(ts, A, content.text('fw'), { reference: forwardedRef() }).isForwarded, true);
  assert.equal(norm(ts, A, content.text('not fw'), { reference: { type: 3, data: '{"fwLvl":1}' } }).isForwarded, undefined);
  assert.equal(norm(ts, A, content.text('bye'), { ttl: 86400000 }).ttl, 86400000);
  // Zalo's local store marks the account's own messages with fromUid "0".
  assert.equal(normalizeMessage(make(ts, '0', content.text('tin của tôi')), G, A).senderId, A);
  assert.equal(normalizeMessage(make(ts, '0', content.text('tin của tôi')), G).senderId, '0');
  assert.equal(normalizeMessage({ msgType: 1, message: 'x' }, G), null);
});

test('photo URLs: the JPEG copy of a JPEG XL photo', () => {
  assert.equal(jpegUrl('https://photo-stal-9.zdn.vn/gr/jxl/abc/def_1.jxl?jxlstatus=1'), 'https://photo-stal-9.zdn.vn/gr/jpg/abc/def_1.jpg?jxlstatus=1');
  assert.equal(jpegUrl('https://photo-stal-9.zdn.vn/gr/jxl/abc/def_1.jxl'), 'https://photo-stal-9.zdn.vn/gr/jpg/abc/def_1.jpg');
  assert.equal(jpegUrl('https://photo-stal-9.zdn.vn/no/jxl/abc/def_1.jxl?jxlstatus=1'), 'https://photo-stal-9.zdn.vn/no/jpg/abc/def_1.jpg?jxlstatus=1');
  assert.equal(jpegUrl('https://zgif-v1.zdn.vn/o.gif'), null);
  assert.equal(jpegUrl('https://photo-stal-9.zdn.vn/x/def_1.jxl'), null); // no JPEG copy known
});

// ---------- merge ----------
test('merge: added, then unchanged', () => {
  const inc = { id: 'm1', ts: 1, senderId: A, text: 'hi', kind: 'text', type: 1 };
  const a = mergeMessage(undefined, inc, { runId: 'r1', now: 10 });
  assert.equal(a.change, 'added');
  const b = mergeMessage(a.record, inc, { runId: 'r2', now: 20 });
  assert.equal(b.change, 'same');
  assert.equal(b.record.lastSeenRun, 'r2');
});

test('merge: a recall keeps the archived content; an edit keeps the old text; a sighting clears missingSince', () => {
  const old = mergeMessage(undefined, { id: 'm1', ts: 1, senderId: A, text: 'kế hoạch', kind: 'photo', type: 2, attachments: [{ id: 'm1', kind: 'photo', url: 'u' }] }, { runId: 'r1', now: 1 }).record;
  const rec = mergeMessage({ ...old, missingSince: 5 }, { id: 'm1', ts: 1, senderId: A, kind: 'recalled', type: 20, recalled: true }, { runId: 'r2', now: 9 });
  assert.equal(rec.change, 'updated');
  assert.deepEqual([rec.record.recalled, rec.record.recalledDetectedAt, rec.record.text, rec.record.kind, rec.record.attachments.length, rec.record.missingSince], [true, 9, 'kế hoạch', 'photo', 1, undefined]);
  const again = mergeMessage(rec.record, { id: 'm1', ts: 1, senderId: A, kind: 'recalled', type: 20, recalled: true }, { runId: 'r3', now: 12 });
  assert.equal(again.change, 'same');
  assert.equal(again.record.recalledDetectedAt, 9);
  const edited = mergeMessage(old, { id: 'm1', ts: 1, senderId: A, text: 'kế hoạch mới', kind: 'photo', type: 2 }, { runId: 'r2', now: 20 });
  assert.deepEqual(edited.record.editHistory, [{ text: 'kế hoạch', replacedAt: 20 }]);
  assert.equal(edited.record.text, 'kế hoạch mới');
});

test('coverage intervals merge, and the interval holding a time is found', () => {
  assert.deepEqual(addInterval([[10, 20]], [15, 30]), [[10, 30]]);
  assert.deepEqual(addInterval([[10, 20]], [30, 40]), [[10, 20], [30, 40]]);
  assert.deepEqual(addInterval([[10, 20], [30, 40]], [20, 30]), [[10, 40]]);
  assert.deepEqual(addInterval([[10, 20]], [5, 5]), [[5, 5], [10, 20]]);
  assert.deepEqual(intervalAt([[10, 20], [30, 40]], 30), [30, 40]);
  assert.equal(intervalAt([[10, 20]], 25), null);
});

// ---------- paths ----------
test('media paths are deterministic, keep file names, use the fixed folder', () => {
  const conv = { convId: G, name: 'Nhóm bạn thân' };
  const m = { id: '7000000123456', ts: at(2026, 9, 24, 12, 41) };
  assert.equal(convDir(conv), `Zalo_Export/Nhóm_bạn_thân_${G}`);
  assert.equal(mediaPath(conv, m, { kind: 'photo' }), `Zalo_Export/Nhóm_bạn_thân_${G}/media/2026-09/2026-09-24_12-41-00_photo_00123456.jpg`);
  assert.equal(mediaPath(conv, m, { kind: 'photo' }, 'jxl').split('.').pop(), 'jxl');
  assert.equal(mediaPath(conv, m, { kind: 'file', filename: 'Hợp đồng (bản 2).docx' }).split('/').pop(), '2026-09-24_12-41-00_Hợp_đồng_bản_2.docx');
  assert.equal(mediaPath({ ...conv, folder: 'Old_name' }, m, { kind: 'video' }).split('/')[1], 'Old_name');
  assert.equal(defaultExt({ kind: 'voice', url: 'https://voice-stal-1.zdn.vn/x.amr' }), 'amr');
  assert.equal(defaultExt({ kind: 'file', filename: 'noext', ext: 'pdf' }), 'pdf');
});

// ---------- export ----------
const CONV = { convId: G, name: 'Nhóm bạn thân', isGroup: true, members: 5, me: A, participants: { [A]: 'An', [B]: 'Bình' } };
function archiveOf(list) { return list.map(r => ({ ...r, firstSeenAt: 1, lastSeenAt: 1, lastSeenRun: 'r' })); }

test('text entities: mentions, links and styles cut the text into Telegram pieces', () => {
  const v = { text: '@Bình xem https://a.vn nhé', mentions: [{ uid: B, pos: 0, len: 5 }], styles: [{ start: 6, len: 3, st: 'b' }, { start: 0, len: 2, st: 'i' }] };
  assert.deepEqual(textEntities(v), [
    { type: 'mention_name', text: '@Bình', user_id: B },
    { type: 'plain', text: ' ' },
    { type: 'bold', text: 'xem' },
    { type: 'plain', text: ' ' },
    { type: 'link', text: 'https://a.vn' },
    { type: 'plain', text: ' nhé' },
  ]);
  assert.deepEqual(textEntities({ text: 'plain' }), [{ type: 'plain', text: 'plain' }]);
  assert.deepEqual(textEntities({ text: '' }), []);
});

test('JSON follows Telegram Desktop: chat fields, message fields, a zalo key for the rest', () => {
  const ts = at(2026, 9, 24, 12, 41);
  const first = norm(ts, B, content.text('Chào @An'), { mentions: [{ uid: A, pos: 5, len: 3, type: 0 }] });
  const reply = norm(ts + 60000, A, content.text('Chào Bình'), { quote: quote(make(ts, B, content.text('Chào @An'), { msgId: first.id }), 'Bình') });
  const photo = norm(ts + 120000, B, content.photo('p9', 'ảnh'));
  const file = norm(ts + 180000, A, content.file('f9', 'report.pdf'));
  const rec = { ...norm(ts + 240000, B, content.text('lỡ gửi')), recalled: true, recalledDetectedAt: ts + 300000 };
  const media = { [photo.id]: { id: photo.id, status: 'done', path: mediaPath(CONV, photo, photo.attachments[0]) } };
  const [json] = buildExport({ conv: CONV, messages: archiveOf([first, reply, photo, file, rec]), media, options: { formats: ['json'] }, now: ts + 999999 });
  assert.equal(json.path, `Zalo_Export/Nhóm_bạn_thân_${G}/Nhóm_bạn_thân.json`);
  const doc = JSON.parse(json.content);
  assert.deepEqual([doc.name, doc.type, doc.id, doc.messages.length], ['Nhóm bạn thân', 'private_group', G, 5]);
  const [m1, m2, m3, m4, m5] = doc.messages;
  assert.deepEqual({ id: m1.id, type: m1.type, date: m1.date, date_unixtime: m1.date_unixtime, from: m1.from, from_id: m1.from_id }, { id: Number(first.id), type: 'message', date: '2026-09-24T12:41:00', date_unixtime: String(Math.floor(ts / 1000)), from: 'Bình', from_id: `user${B}` });
  assert.deepEqual(m1.text, ['Chào ', { type: 'mention_name', text: '@An', user_id: A }]);
  assert.equal(m2.reply_to_message_id, Number(first.id));
  assert.deepEqual(m2.zalo.quote, { msg_id: first.id, from: 'Bình', from_id: `user${B}`, text: 'Chào @An', date: '2026-09-24T12:41:00' });
  assert.equal(m3.photo, `media/2026-09/2026-09-24_12-43-00_photo_${photo.id.slice(-8)}.jpg`);
  assert.deepEqual([m3.width, m3.height, m3.text], [1280, 960, 'ảnh']);
  assert.deepEqual([m4.file, m4.file_name, m4.file_size, m4.mime_type], [NOT_INCLUDED, 'report.pdf', 50000, 'application/pdf']);
  assert.equal(m4.zalo.media.status, 'not-downloaded');
  assert.deepEqual([m5.text, m5.zalo.recalled, m5.zalo.recalled_detected_at], ['lỡ gửi', true, '2026-09-24T12:46:00']);
  assert.equal(doc.zalo.format, 'zalo-chat-export');
  assert.deepEqual(doc.zalo.participants[0], { id: A, name: 'An', is_self: true });
});

test('TXT follows WhatsApp: [dd/mm/yyyy, hh:mm:ss] Name: text, with attachment lines and archive notes', () => {
  const ts = at(2026, 9, 24, 12, 41);
  const t = norm(ts, B, content.text('dòng 1\ndòng 2'));
  const f = norm(ts + 1000, A, content.file('f1', 'a b.pdf', '2097152'));
  const gone = { ...norm(ts + 2000, B, content.text('đã xóa')), missingSince: at(2026, 9, 25) };
  const [txt] = buildExport({ conv: CONV, messages: archiveOf([t, f, gone]), options: { formats: ['txt'] }, now: at(2026, 9, 25) });
  const lines = txt.content.split('\n');
  assert.equal(lines[0], '# Nhóm bạn thân');
  assert.ok(lines.includes('[24/09/2026, 12:41:00] Bình: dòng 1'));
  assert.ok(lines.includes('dòng 2'));
  assert.ok(lines.includes('[24/09/2026, 12:41:01] An: <file not downloaded: a b.pdf (2.0 MB)>'));
  assert.ok(lines.includes('[24/09/2026, 12:41:02] Bình: đã xóa (not found in Zalo since 2026-09-25 — kept from the archive)'));
  assert.equal(attachmentLine({ kind: 'photo', file: './media/2026-09/x.jpg' }), '<attached: media/2026-09/x.jpg>');
});

test('HTML escapes message text, pages at 1000 messages with an index, splits by day/week/month', () => {
  const base = at(2026, 9, 1, 8);
  const list = Array.from({ length: HTML_PAGE_SIZE + 5 }, (_, i) => norm(base + i * 60000, i % 2 ? A : B, content.text(i === 3 ? '<script>alert(1)</script>' : `tin ${i}`)));
  const files = buildExport({ conv: CONV, messages: archiveOf(list), options: { formats: ['html'] }, now: base });
  assert.deepEqual(files.map(f => f.path.split('/').pop()), ['Nhóm_bạn_thân.html', 'Nhóm_bạn_thân_p2.html', 'index.html']);
  assert.ok(!files[0].content.includes('<script>alert'));
  assert.ok(files[0].content.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  const days = buildExport({ conv: CONV, messages: archiveOf([norm(at(2026, 9, 1), A, content.text('a')), norm(at(2026, 9, 9), A, content.text('b'))]), options: { formats: ['json'], split: 'week' }, now: base });
  assert.deepEqual(days.map(f => f.path.split('/').pop()), ['2026-W36.json', '2026-W37.json']);
  const range = buildExport({ conv: CONV, messages: archiveOf([norm(at(2026, 9, 9), A, content.text('b'))]), options: { formats: ['json'], split: 'month', from: at(2026, 9, 5, 0), to: null }, now: base });
  assert.equal(range[0].path, `Zalo_Export/Nhóm_bạn_thân_${G}/range_2026-09-05_to_now/2026-09.json`);
  assert.equal(relPath(`Zalo_Export/X/range_a_to_b`, 'Zalo_Export/X/media/2026-09/p.jpg'), '../media/2026-09/p.jpg');
});
