// Export writers: archived messages -> files. Pure functions (no chrome.* calls), so they are
// unit-tested in Node. Returns [{ path, mime, content }] with paths relative to Downloads.
//
// JSON follows Telegram Desktop's chat export (result.json: name / type / id / messages[id, type,
// date, date_unixtime, from, from_id, reply_to_message_id, photo, file, media_type, text,
// text_entities]), the chat export format most tools read. Everything Telegram's format has no
// field for (Zalo ids, quotes, recalls, edits, archive flags, link previews) is kept under a
// "zalo" key, which those tools ignore. TXT follows WhatsApp's export
// ("[24/09/2026, 12:41:10] Name: text", "<attached: file>"). See docs/FORMAT.md.
import { periodKey, isoLocal, fmtLocal, dayKey, safeName, pad, localParts } from '../../core/util.js';
import { convDir, mediaPath, urlExt } from './paths.js';

export const FORMAT_ID = 'zalo-chat-export';
export const FORMAT_VERSION = 1;
export const HTML_PAGE_SIZE = 1000;
// Telegram's own words for a file an export left out.
export const NOT_INCLUDED = '(File not included. Change data exporting settings to download.)';
const DOWNLOADABLE = ['photo', 'gif', 'video', 'voice', 'file'];

// A full export writes into the chat's folder; a date-range export gets its own subfolder so it
// never overwrites the full files with partial ones.
export function outputDir(conv, options) {
  const base = convDir(conv);
  if (!options.from && !options.to) return base;
  return `${base}/range_${options.from ? dayKey(options.from) : 'start'}_to_${options.to ? dayKey(options.to) : 'now'}`;
}

export function relPath(fromDir, target) {
  const a = fromDir.split('/'), b = target.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  return (up ? '../'.repeat(up) : './') + b.slice(i).join('/');
}

export function groupMessages(messages, split) {
  const groups = new Map();
  for (const m of messages) {
    const key = periodKey(m.ts, split);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, messages: list }));
}

// Sender "0" is the account itself, archived before its own id was known.
const nameOf = (conv, id, fallback) => {
  const p = conv.participants || {};
  if (id === '0') return p[conv.me] || fallback || 'Me';
  return (id && p[id]) || fallback || id || 'Unknown';
};

function viewAttachment(m, a, ctx) {
  const rec = ctx.media[a.id];
  const v = { ...a };
  if (!DOWNLOADABLE.includes(a.kind)) return v;
  v.plannedName = mediaPath(ctx.conv, m, a).split('/').pop();
  if (rec && rec.status === 'done' && rec.path) { v.file = relPath(ctx.dir, rec.path); v.status = 'downloaded'; }
  else { v.status = rec && rec.status === 'failed' ? 'failed' : 'not-downloaded'; if (rec && rec.error) v.error = rec.error; }
  return v;
}

export function viewMessage(m, ctx) {
  const { conv } = ctx;
  const v = {
    id: m.id,
    ts: m.ts,
    senderId: m.senderId,
    sender: nameOf(conv, m.senderId, m.senderName),
    isSelf: m.senderId === '0' || (!!conv.me && m.senderId === conv.me),
    kind: m.kind,
    type: m.type,
    text: m.text != null ? m.text : null,
  };
  if (m.attachments && m.attachments.length) v.attachments = m.attachments.map(a => viewAttachment(m, a, ctx));
  if (m.replyTo) v.replyTo = { ...m.replyTo, sender: m.replyTo.senderId ? nameOf(conv, m.replyTo.senderId, m.replyTo.senderName) : m.replyTo.senderName || null };
  if (m.mentions) {
    v.mentions = m.mentions.map(x => {
      const typed = m.text ? m.text.substr(x.pos, x.len).replace(/^@/, '') : '';
      return { ...x, name: x.uid === '-1' ? 'All' : nameOf(conv, x.uid, typed || null) };
    });
  }
  for (const k of ['cliMsgId', 'styles', 'link', 'cards', 'sticker', 'location', 'contact', 'call', 'isForwarded', 'recalled', 'editHistory', 'ttl', 'recalledDetectedAt', 'missingSince']) {
    if (m[k] != null && m[k] !== false) v[k] = m[k];
  }
  return v;
}

export function buildExport({ conv, messages, media = {}, options = {}, now = Date.now() }) {
  const split = options.split || 'none';
  const formats = options.formats && options.formats.length ? options.formats : ['json', 'html', 'txt'];
  const dir = outputDir(conv, options);
  const sorted = [...messages].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = groupMessages(sorted, split);
  const stemOf = key => (key === 'all' ? safeName(conv.name || conv.convId, 60) : key);
  const ctxFor = key => ({ conv, media, options, now, dir, split, period: key });
  const files = [];
  // HTML pages across all groups, so every page can link to the previous and next one.
  const pages = [];
  for (const g of groups) {
    for (let i = 0; i < g.messages.length; i += HTML_PAGE_SIZE) {
      const n = i / HTML_PAGE_SIZE + 1;
      pages.push({ key: g.key, file: `${stemOf(g.key)}${n > 1 ? '_p' + n : ''}.html`, messages: g.messages.slice(i, i + HTML_PAGE_SIZE), n });
    }
  }
  for (const g of groups) {
    const ctx = ctxFor(g.key);
    const view = g.messages.map(m => viewMessage(m, ctx));
    if (formats.includes('json')) files.push({ path: `${dir}/${stemOf(g.key)}.json`, mime: 'application/json', content: toJSON(ctx, view) });
    if (formats.includes('txt')) files.push({ path: `${dir}/${stemOf(g.key)}.txt`, mime: 'text/plain', content: toTXT(ctx, view) });
  }
  if (formats.includes('html')) {
    pages.forEach((p, i) => {
      const ctx = ctxFor(p.key);
      files.push({ path: `${dir}/${p.file}`, mime: 'text/html', content: toHTML(ctx, p.messages.map(m => viewMessage(m, ctx)), { page: p, prev: pages[i - 1], next: pages[i + 1], hasIndex: pages.length > 1 }) });
    });
    if (pages.length > 1) files.push({ path: `${dir}/index.html`, mime: 'text/html', content: indexHTML(conv, pages, groups, formats, stemOf, now) });
  }
  return files;
}

// ---------- text with formatting ----------
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;
const STYLE = { b: 'bold', i: 'italic', u: 'underline', s: 'strikethrough' };
const RANK = { mention_name: 0, mention: 0, link: 1, bold: 2, italic: 3, underline: 4, strikethrough: 5 };

// The message text cut into consecutive pieces, each plain or one entity, in Telegram's
// text_entities form. Where Zalo's ranges overlap, a mention wins over a link, a link over a style.
export function textEntities(v) {
  const text = v.text || '';
  if (!text) return [];
  const n = text.length;
  const marks = [];
  for (const x of v.mentions || []) {
    if (x.pos >= 0 && x.pos + x.len <= n) marks.push({ start: x.pos, end: x.pos + x.len, type: x.uid === '-1' ? 'mention' : 'mention_name', extra: x.uid === '-1' ? null : { user_id: x.uid } });
  }
  for (const m of text.matchAll(URL_RE)) marks.push({ start: m.index, end: m.index + m[0].length, type: 'link' });
  for (const s of v.styles || []) if (STYLE[s.st] && s.start >= 0 && s.start < n) marks.push({ start: s.start, end: Math.min(n, s.start + s.len), type: STYLE[s.st] });
  if (!marks.length) return [{ type: 'plain', text }];
  const points = [...new Set([0, n, ...marks.flatMap(mk => [mk.start, mk.end])])].sort((a, b) => a - b);
  const out = [];
  let lastMark;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const top = marks.filter(mk => mk.start <= a && mk.end >= b).sort((x, y) => RANK[x.type] - RANK[y.type])[0] || null;
    const last = out[out.length - 1];
    if (last && top === lastMark) { last.text += text.slice(a, b); continue; }
    out.push({ type: top ? top.type : 'plain', text: text.slice(a, b), ...(top && top.extra) });
    lastMark = top;
  }
  return out;
}

// ---------- JSON (Telegram Desktop style) ----------
const tgDate = ts => fmtLocal(ts).replace(' ', 'T');
const idValue = id => (/^\d{1,15}$/.test(String(id)) ? Number(id) : String(id));
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', jxl: 'image/jxl',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', aac: 'audio/aac', m4a: 'audio/mp4', mp3: 'audio/mpeg', amr: 'audio/amr', ogg: 'audio/ogg', wav: 'audio/wav',
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const extOf = a => ((a.file || a.plannedName || '').match(/\.([a-z0-9]{1,8})$/i) || [])[1] || urlExt(a.url || '') || '';
const mimeOf = a => MIME[extOf(a).toLowerCase()];
const compact = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== false && v !== '' && !(Array.isArray(v) && !v.length)));

function mediaFields(o, a) {
  const path = a.file ? a.file.replace(/^\.\//, '') : NOT_INCLUDED;
  if (a.kind === 'photo') {
    o.photo = path;
  } else {
    o.file = path;
    if (a.kind === 'file') o.file_name = a.filename;
    if (a.size) o.file_size = a.size;
    if (a.kind === 'gif') o.media_type = 'animation';
    else if (a.kind === 'video') o.media_type = 'video_file';
    else if (a.kind === 'voice') o.media_type = 'voice_message';
    const mime = mimeOf(a);
    if (mime) o.mime_type = mime;
    if (a.durationMs) o.duration_seconds = Math.round(a.durationMs / 1000);
  }
  if (a.width) o.width = a.width;
  if (a.height) o.height = a.height;
}

function tgMessage(v) {
  const service = v.kind === 'call';
  const o = { id: idValue(v.id), type: service ? 'service' : 'message', date: tgDate(v.ts), date_unixtime: String(Math.floor(v.ts / 1000)) };
  if (service) {
    o.actor = v.sender;
    o.actor_id = `user${v.senderId}`;
    o.action = 'phone_call';
    if (v.call && v.call.durationSec) o.duration_seconds = v.call.durationSec;
  } else {
    o.from = v.sender;
    o.from_id = `user${v.senderId}`;
  }
  if (v.replyTo && v.replyTo.id) o.reply_to_message_id = idValue(v.replyTo.id);
  const a = (v.attachments || [])[0];
  if (a) mediaFields(o, a);
  if (v.kind === 'sticker') o.media_type = 'sticker';
  if (v.location && v.location.lat != null) o.location_information = { latitude: v.location.lat, longitude: v.location.lng };
  if (v.contact) o.contact_information = { first_name: v.contact.name || '', last_name: '', phone_number: '' };
  const entities = textEntities(v);
  o.text = entities.every(e => e.type === 'plain') ? entities.map(e => e.text).join('') : entities.map(e => (e.type === 'plain' ? e.text : e));
  o.text_entities = entities;
  o.zalo = compact({
    msg_id: String(v.id),
    cli_msg_id: v.cliMsgId,
    msg_type: v.type,
    kind: v.kind,
    quote: v.replyTo ? compact({ msg_id: v.replyTo.id, from: v.replyTo.sender, from_id: v.replyTo.senderId ? `user${v.replyTo.senderId}` : null, text: v.replyTo.text, date: v.replyTo.ts ? tgDate(v.replyTo.ts) : null }) : null,
    forwarded: v.isForwarded,
    recalled: v.recalled,
    recalled_detected_at: v.recalledDetectedAt ? tgDate(v.recalledDetectedAt) : null,
    missing_since: v.missingSince ? tgDate(v.missingSince) : null,
    edit_history: v.editHistory ? v.editHistory.map(e => ({ text: e.text, replaced_at: tgDate(e.replacedAt) })) : null,
    media: a && DOWNLOADABLE.includes(a.kind) ? compact({ kind: a.kind, status: a.status, planned_name: a.plannedName, url: a.url, error: a.error }) : null,
    link: v.link,
    cards: v.cards,
    sticker: v.sticker,
    contact: v.contact,
    location: v.location,
    call: v.call,
    disappearing_ttl: v.ttl,
  });
  return o;
}

function participantsOf(conv) {
  const list = Object.entries(conv.participants || {}).map(([id, name]) => ({ id, name, ...(id === conv.me ? { is_self: true } : {}) }));
  return list.sort((a, b) => (b.is_self ? 1 : 0) - (a.is_self ? 1 : 0));
}

export function toJSON(ctx, view) {
  const { conv, options } = ctx;
  const doc = {
    name: conv.name || conv.convId,
    type: conv.isGroup ? 'private_group' : 'personal_chat',
    id: conv.convId,
    messages: view.map(tgMessage),
    zalo: compact({
      format: FORMAT_ID,
      version: FORMAT_VERSION,
      exported_at: isoLocal(ctx.now),
      conversation_id: conv.convId,
      is_group: !!conv.isGroup,
      members: conv.members,
      me: conv.me ? { id: conv.me, name: nameOf(conv, conv.me, null) } : null,
      participants: participantsOf(conv),
      period: { split: ctx.split, key: ctx.period, first: view.length ? tgDate(view[0].ts) : null, last: view.length ? tgDate(view[view.length - 1].ts) : null },
      range: options.from || options.to ? { from: options.from ? tgDate(options.from) : null, to: options.to ? tgDate(options.to) : null } : null,
      message_count: view.length,
    }),
  };
  return JSON.stringify(doc, null, 1) + '\n';
}

// ---------- TXT (WhatsApp style) ----------
const KIND_LABEL = { photo: 'photo', gif: 'GIF', video: 'video', voice: 'voice message', file: 'file' };
const fmtDur = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const waDate = ts => { const p = localParts(ts); return `${pad(p.d)}/${pad(p.m)}/${p.y}, ${pad(p.H)}:${pad(p.M)}:${pad(p.S)}`; };
const mapsUrl = l => `https://www.google.com/maps?q=${l.lat},${l.lng}`;

export function attachmentLine(a) {
  if (a.file) return `<attached: ${a.file.replace(/^\.\//, '')}>`;
  const label = KIND_LABEL[a.kind] || a.kind;
  const name = a.kind === 'file' && a.filename ? a.filename : a.plannedName;
  const bits = [a.durationMs && fmtDur(a.durationMs), a.size && fmtSize(a.size)].filter(Boolean).join(', ');
  return `<${label} ${a.status === 'failed' ? 'download failed' : 'not downloaded'}: ${name}${bits ? ' (' + bits + ')' : ''}>`;
}
function callLine(c = {}) {
  return `${c.video ? 'video call' : 'call'}${c.durationSec ? ', ' + fmtDur(c.durationSec * 1000) : ''}`;
}
// What a message holds besides its text, one short line each.
function extraLines(v) {
  const out = [];
  for (const a of v.attachments || []) out.push(attachmentLine(a));
  if (v.kind === 'sticker') out.push('<sticker>');
  if (v.link && (v.link.title || (v.link.url && !(v.text || '').includes(v.link.url)))) out.push(`<link: ${[v.link.title, v.link.url].filter(Boolean).join(' — ')}>`);
  for (const c of v.cards || []) out.push(`<card: ${[c.title, c.url].filter(Boolean).join(' — ')}>`);
  if (v.location && v.location.lat != null) out.push(`<location: ${mapsUrl(v.location)}>`);
  if (v.kind === 'contact') out.push(`<contact card${v.contact && v.contact.name && v.contact.name !== v.text ? ': ' + v.contact.name : ''}>`);
  if (v.kind === 'call') out.push(`<${callLine(v.call)}>`);
  if (v.kind === 'poll') out.push('<poll>');
  return out;
}
export function toTXT(ctx, view) {
  const { conv } = ctx;
  const out = [`# ${conv.name || conv.convId}`];
  const people = participantsOf(conv).map(p => p.name + (p.is_self ? ' (you)' : '')).join(', ');
  if (people) out.push(`# Participants: ${people}`);
  out.push(`# ${ctx.period === 'all' ? 'All messages' : 'Period ' + ctx.period} · ${view.length} messages · exported ${fmtLocal(ctx.now)}`, '');
  for (const m of view) {
    const head = `[${waDate(m.ts)}] ${m.sender}: `;
    const parts = [];
    if (m.replyTo) parts.push(`(reply to ${m.replyTo.sender || 'a message'}${m.replyTo.text ? ': "' + m.replyTo.text.replace(/\s+/g, ' ').slice(0, 80) + '"' : ''})`);
    if (m.recalled) parts.push(m.text || m.attachments ? '(recalled on Zalo — kept from the archive)' : '<message recalled>');
    if (m.text) parts.push(m.text);
    parts.push(...extraLines(m));
    if (m.editHistory) parts.push('(edited)');
    if (m.isForwarded) parts.push('(forwarded)');
    if (m.missingSince) parts.push(`(not found in Zalo since ${fmtLocal(m.missingSince).slice(0, 10)} — kept from the archive)`);
    out.push(head + parts.join(' '));
  }
  return out.join('\n') + '\n';
}

// ---------- HTML ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TAG = { bold: 'b', italic: 'i', underline: 'u', strikethrough: 's' };
function richText(v) {
  return textEntities(v).map(e => {
    if (e.type === 'link') return `<a href="${esc(e.text)}" rel="noopener noreferrer">${esc(e.text)}</a>`;
    if (e.type === 'mention' || e.type === 'mention_name') return `<span class="mention">${esc(e.text)}</span>`;
    if (TAG[e.type]) return `<${TAG[e.type]}>${esc(e.text)}</${TAG[e.type]}>`;
    return esc(e.text);
  }).join('');
}
const weekday = ts => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' });
const hrefOf = file => esc(file.split('/').map(s => (s === '.' || s === '..' ? s : encodeURIComponent(s))).join('/'));
function mediaHTML(a) {
  if (!a.file) return `<div class="note">${esc(attachmentLine(a))}</div>`;
  const src = hrefOf(a.file);
  if ((a.kind === 'photo' || a.kind === 'gif') && !/\.jxl$/i.test(a.file)) return `<a href="${src}"><img src="${src}" loading="lazy" alt="${esc(KIND_LABEL[a.kind])}"></a>`;
  if (a.kind === 'video') return `<video src="${src}" controls preload="metadata"></video>`;
  if (a.kind === 'voice') return `<audio src="${src}" controls preload="none"></audio>`;
  return `<a class="file" href="${src}">📎 ${esc(a.filename || a.file.split('/').pop())}${a.size ? ` <span class="sub">${fmtSize(a.size)}</span>` : ''}</a>`;
}
function shareHTML(title, url, sub) {
  const t = esc(title || url || '');
  return `<div class="share">${url ? `<a href="${esc(url)}" rel="noopener noreferrer">${t}</a>` : t}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
}
const CSS = `
:root{--bg:#eef0f1;--card:#fff;--fg:#081c36;--muted:#7589a3;--me:#e5efff;--line:#d6dbe1;--warn:#9a5b00;--accent:#0068ff}
@media (prefers-color-scheme:dark){:root{--bg:#1b1d21;--card:#2b2f36;--fg:#e4e6eb;--muted:#9aa4b1;--me:#1f3a5f;--line:#3a3f47;--warn:#f0b35a;--accent:#5ea2ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;z-index:1}
header h1{font-size:17px;margin:0}header p{margin:2px 0 0;color:var(--muted);font-size:13px}nav{font-size:13px;margin-top:4px}nav a{margin-right:12px}
a{color:var(--accent)}main{max-width:760px;margin:0 auto;padding:8px 16px 48px}
.day{text-align:center;color:var(--muted);font-size:12px;margin:22px 0 8px}
.msg{display:flex;flex-direction:column;align-items:flex-start;margin:2px 0}.msg.me{align-items:flex-end}
.who{font-size:12px;color:var(--muted);margin:10px 12px 2px}
.bubble{max-width:78%;padding:7px 12px;border-radius:12px;background:var(--card);white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--line)}
.me .bubble{background:var(--me)}.mention{color:var(--accent);font-weight:600}
.bubble.media{background:none;padding:0;border:0}.bubble img,.bubble video{max-width:min(320px,100%);max-height:360px;border-radius:10px;display:block;margin:2px 0}
.quote{font-size:13px;color:var(--muted);border-left:3px solid var(--accent);padding:2px 8px;margin:4px 0 2px;max-width:78%;white-space:pre-wrap}
.meta{font-size:11px;color:var(--muted);margin:1px 12px}.flag{color:var(--warn)}
.share{border:1px solid var(--line);border-radius:10px;padding:8px 10px;max-width:320px;background:var(--card);color:var(--fg);margin:2px 0}
.sub{color:var(--muted);font-size:12px}.note{font-size:13px;color:var(--muted);font-style:italic;padding:2px 12px}
.file{display:inline-block;padding:8px 10px;border:1px solid var(--line);border-radius:10px;color:inherit;background:var(--card)}
details{font-size:12px;color:var(--muted);margin:0 12px}
table{border-collapse:collapse;width:100%;font-size:14px;background:var(--card)}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}`;

function page(title, subtitle, nav, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><header><h1>${esc(title)}</h1><p>${subtitle}</p>${nav}</header>
<main>
${body}
</main></body></html>
`;
}

export function toHTML(ctx, view, { page: pg, prev, next, hasIndex } = {}) {
  const { conv } = ctx;
  const title = conv.name || conv.convId;
  const label = p => esc(p.key === 'all' ? `page ${p.n}` : p.key + (p.n > 1 ? ` (${p.n})` : ''));
  const nav = hasIndex ? `<nav>${prev ? `<a href="${esc(encodeURIComponent(prev.file))}">← ${label(prev)}</a>` : ''}<a href="index.html">all files</a>${next ? `<a href="${esc(encodeURIComponent(next.file))}">${label(next)} →</a>` : ''}</nav>` : '';
  const rows = [];
  let day = null, prevMsg = null;
  for (const m of view) {
    const d = dayKey(m.ts);
    if (d !== day) { day = d; prevMsg = null; rows.push(`<div class="day">${esc(d)} · ${esc(weekday(m.ts))}</div>`); }
    const parts = [];
    if (!m.isSelf && (!prevMsg || prevMsg.senderId !== m.senderId || m.ts - prevMsg.ts > 10 * 60e3)) parts.push(`<div class="who">${esc(m.sender)}</div>`);
    if (m.replyTo) parts.push(`<div class="quote">↪ ${esc(m.replyTo.sender || '')}${m.replyTo.text ? ': ' + esc(m.replyTo.text.slice(0, 300)) : ''}</div>`);
    if (m.text) parts.push(`<div class="bubble">${richText(m)}</div>`);
    for (const a of m.attachments || []) parts.push(`<div class="bubble media">${mediaHTML(a)}</div>`);
    if (m.kind === 'sticker') parts.push('<div class="note">sticker</div>');
    if (m.link && (m.link.title || m.link.description)) parts.push(`<div class="bubble media">${shareHTML(m.link.title || m.link.url, m.link.url, m.link.description)}</div>`);
    for (const c of m.cards || []) parts.push(`<div class="bubble media">${shareHTML(c.title, c.url, c.description)}</div>`);
    if (m.location && m.location.lat != null) parts.push(`<div class="bubble media">${shareHTML('📍 ' + (m.location.title || 'Location'), mapsUrl(m.location))}</div>`);
    if (m.contact && !m.text) parts.push(`<div class="bubble media">${shareHTML('👤 ' + (m.contact.name || 'Contact card'), null, m.contact.description)}</div>`);
    if (m.kind === 'call') parts.push(`<div class="bubble">📞 ${esc(callLine(m.call))}</div>`);
    if (m.kind === 'poll') parts.push('<div class="note">poll</div>');
    if (!m.text && !m.attachments && !['sticker', 'call', 'poll'].includes(m.kind) && !m.link && !m.cards && !m.location && !m.contact) {
      parts.push(`<div class="bubble"><i>${m.recalled ? 'message recalled' : 'message not available'}</i></div>`);
    }
    const flags = [];
    if (m.recalled && (m.text || m.attachments)) flags.push('<span class="flag">recalled on Zalo — kept from the archive</span>');
    if (m.missingSince) flags.push(`<span class="flag">not found in Zalo since ${esc(fmtLocal(m.missingSince).slice(0, 10))} — kept</span>`);
    if (m.isForwarded) flags.push('forwarded');
    if (m.editHistory) flags.push('edited');
    parts.push(`<div class="meta" title="${esc(fmtLocal(m.ts))}">${esc(fmtLocal(m.ts).slice(11, 16))}${flags.length ? ' · ' + flags.join(' · ') : ''}</div>`);
    if (m.editHistory) parts.push(`<details><summary>earlier versions</summary>${m.editHistory.map(e => `<div>${esc(e.text)}</div>`).join('')}</details>`);
    rows.push(`<div class="${m.isSelf ? 'msg me' : 'msg'}">${parts.join('')}</div>`);
    prevMsg = m;
  }
  const people = participantsOf(conv).map(p => esc(p.name)).join(', ');
  const scope = ctx.period === 'all' ? (pg && pg.n > 1 ? `page ${pg.n}` : 'all messages') : esc(ctx.period) + (pg && pg.n > 1 ? ` (${pg.n})` : '');
  return page(`${title} — ${ctx.period === 'all' ? 'chat' : ctx.period}`, `${people && !conv.isGroup ? people + ' · ' : ''}${scope} · ${view.length} messages · exported ${esc(fmtLocal(ctx.now))}`, nav, rows.join('\n'));
}

export function indexHTML(conv, pages, groups, formats, stemOf, now) {
  const title = conv.name || conv.convId;
  const total = groups.reduce((n, g) => n + g.messages.length, 0);
  const rows = pages.map(p => {
    const first = p.messages[0], last = p.messages[p.messages.length - 1];
    const extra = p.n === 1 ? formats.filter(f => f !== 'html').map(f => `<a href="${esc(encodeURIComponent(stemOf(p.key) + '.' + f))}">${f}</a>`).join(' ') : '';
    return `<tr><td><a href="${esc(encodeURIComponent(p.file))}">${esc(p.key === 'all' ? 'page ' + p.n : p.key + (p.n > 1 ? ' (' + p.n + ')' : ''))}</a></td><td>${p.messages.length}</td><td>${esc(fmtLocal(first.ts))}</td><td>${esc(fmtLocal(last.ts))}</td><td>${extra}</td></tr>`;
  }).join('\n');
  return page(`${title} — all files`, `${total} messages · exported ${esc(fmtLocal(now))}`, '',
    `<table><thead><tr><th>File</th><th>Messages</th><th>First</th><th>Last</th><th>Also as</th></tr></thead><tbody>\n${rows}\n</tbody></table>`);
}
