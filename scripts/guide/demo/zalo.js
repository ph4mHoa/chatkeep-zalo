// Stand-in for chat.zalo.me in the user guide's pictures: a plain chat page showing made-up chats,
// and behind it the part of Zalo Web's data layer the extension uses, reached the same way (a
// webpack 4 chunk list, modules found by method name). It is the fake of test/job.sim.test.mjs,
// running in a real page, a little slow on purpose so progress is visible. window.__demo lets
// shoot.mjs change the chats between runs (recall, delete, new message).
import { msg } from '/fixtures/zalo.mjs';
import { buildChats, ME, ME_NAME, names, profileOnly, displayName } from './chats.js';

const chats = buildChats();
const byId = new Map(chats.map(c => [c.id, c]));
const lt = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
const keyOf = m => [m.sendDttm, m.msgId];
const sortMsgs = list => list.sort((a, b) => (lt(keyOf(a), keyOf(b)) ? -1 : lt(keyOf(b), keyOf(a)) ? 1 : 0));
chats.forEach(c => sortMsgs(c.messages));
const pace = { factor: 1 };
const wait = ms => new Promise(r => setTimeout(r, ms * pace.factor));

// ---------- the data layer ----------
const messagesApi = {
  async getLastMessageFrom(convId, msgId, sendDttm, count, include) {
    await wait(25 + count * 1.5);
    const c = byId.get(convId);
    const cur = [String(sendDttm), String(msgId)];
    const list = (c ? c.messages : []).filter(m => (include ? !lt(cur, keyOf(m)) : lt(keyOf(m), cur)));
    return structuredClone(list.slice(-count));
  },
  async getOldestValidMessage(convId) {
    await wait(20);
    const c = byId.get(convId);
    return c && c.messages.length ? structuredClone(c.messages[0]) : undefined;
  },
};
const loaderApi = {
  async loadOldMessagesFromCloudForConversation() { await wait(600); return { messages: [], hasMore: false }; },
  async getLastMessagesForConversation() { return []; },
};
const profilesApi = {
  getUidMe: () => ME,
  getMiniInfo: uid => ({ dName: names.get(uid) || '' }),
  getDName: uid => names.get(uid) || '',
  async getProfileFriendByIds(uids) {
    await wait(900);
    const out = {};
    for (const u of uids) if (profileOnly.has(u)) { out[u] = { displayName: profileOnly.get(u) }; names.set(u, profileOnly.get(u)); }
    return out;
  },
};
const namesApi = { getDName: uid => names.get(uid) || '', getAliasName: () => '', getProfileByIdFromCache: () => null };
const convHolder = {};
Object.defineProperty(convHolder, 'ConvInfoDataManager', {
  get() { return { getAllConvSync: () => chats.map(c => ({ userId: c.id, isGroup: c.isGroup ? 1 : 0, numMsg: c.messages.length, pinned: false, label: 0 })) }; },
});
window.groupManager = {
  getDName: gid => (byId.get(gid) || {}).name || '',
  getGroupByIdSync: gid => { const c = byId.get(gid); return c ? { displayName: c.name, totalMember: c.members } : null; },
};
// webpack 4 export objects define each binding as a one-line getter.
function exportsOf(bindings) {
  const ex = {};
  Object.defineProperty(ex, '__esModule', { value: true });
  for (const [k, v] of Object.entries(bindings)) Object.defineProperty(ex, k, { enumerable: true, get: () => v });
  return ex;
}
const cache = {};
const req = id => cache[id].exports;
req.c = cache;
const add = (id, exports) => { cache[id] = { i: id, l: true, exports }; };
add('XS0u', exportsOf({ default: messagesApi }));
add('4wTQ', exportsOf({ default: loaderApi }));
add('UiPd', exportsOf({ default: profilesApi }));
add('JWY6', exportsOf({ a: namesApi }));
add('QPNp', exportsOf({ a: convHolder }));
window.webpackJsonp = {
  push([, factories]) {
    for (const [id, f] of Object.entries(factories)) { const m = { i: id, l: false, exports: {} }; cache[id] = m; f.call(m.exports, m, m.exports, req); m.l = true; }
  },
};
// This tab is the one Zalo is active in.
localStorage.setItem('sh_singleton_web_app', 'TAB-1');
sessionStorage.setItem('backup-tab-key', 'TAB-1');

// ---------- controls for shoot.mjs ----------
window.__demo = {
  pace: f => { pace.factor = f; },
  chats: () => chats.map(c => ({ id: c.id, name: c.name, isGroup: !!c.isGroup, count: c.messages.length, demo: c.demo || null })),
  recall(convId, msgId) { const m = byId.get(convId).messages.find(x => x.msgId === msgId); m.msgType = 20; m.message = { msgId: '0' }; },
  remove(convId, msgId) { const c = byId.get(convId); c.messages = c.messages.filter(x => x.msgId !== msgId); },
  say(convId, fromUid, text, minutesAgo = 5) { const c = byId.get(convId); c.messages.push(msg(convId, Date.now() - minutesAgo * 60e3, fromUid, 1, text)); sortMsgs(c.messages); },
};

// ---------- the page ----------
const pad = n => String(n).padStart(2, '0');
const hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayLabel = ts => {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hôm nay';
  if (d.toDateString() === new Date(now - 864e5).toDateString()) return 'Hôm qua';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};
const listTime = ts => (new Date(ts).toDateString() === new Date().toDateString() ? hm(ts) : dayLabel(ts));
const initials = name => { const w = name.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/); return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
const colorOf = name => `hsl(${[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)}, 55%, 52%)`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const text = m => (typeof m.message === 'string' ? m.message : (m.message && m.message.title) || '');
const photoOf = m => (m.message.hdUrl || m.message.oriUrl).replace('/jxl/', '/jpg/').replace(/\.jxl/, '.jpg');
function preview(m) {
  const who = m.fromUid === '0' ? 'Bạn: ' : '';
  switch (m.msgType) {
    case 1: return who + text(m);
    case 2: return `${who}[Hình ảnh]`;
    case 4: return `${who}[Sticker]`;
    case 6: return `${who}[Link] ${text(m)}`;
    case 18: return `${who}[Video]`;
    case 19: return `${who}[File] ${text(m)}`;
    case 26: return `${who}[Bình chọn] ${text(m)}`;
    default: return who;
  }
}
const avatar = (name, size = 48) => `<div class="av" style="background:${colorOf(name)};width:${size}px;height:${size}px">${esc(initials(name))}</div>`;
const ICONS = {
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  contacts: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  todo: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
};
const icon = (name, on) => `<div class="ico${on ? ' on' : ''}"><svg viewBox="0 0 24 24">${ICONS[name]}</svg></div>`;

function render() {
  const shown = [...chats].filter(c => c.messages.length).sort((a, b) => b.messages[b.messages.length - 1].sendDttm - a.messages[a.messages.length - 1].sendDttm);
  const open = byId.get('g8000000000000000101');
  const recent = open.messages.slice(-8);
  let lastDay = null, lastFrom = null;
  const bubbles = recent.map(m => {
    const mine = m.fromUid === '0';
    const day = dayLabel(+m.sendDttm);
    let out = '';
    if (day !== lastDay) { out += `<div class="day">${day}</div>`; lastDay = day; lastFrom = null; }
    const who = !mine && m.fromUid !== lastFrom ? `<div class="who">${esc(displayName(m.fromUid))}</div>` : '';
    lastFrom = m.fromUid;
    let body;
    if (m.msgType === 2) body = `<img src="${photoOf(m)}" alt="">${text(m) ? `<div class="b">${esc(text(m))}</div>` : ''}`;
    else if (m.msgType === 4) body = '<div class="st">🌸</div>';
    else if (m.msgType === 18) body = `<div class="b">▶ Video</div>`;
    else body = `<div class="b">${esc(text(m))}</div>`;
    return out + `<div class="m${mine ? ' mine' : ''}">${who}${body}<div class="ts">${hm(+m.sendDttm)}</div></div>`;
  }).join('');
  document.getElementById('app').innerHTML = `
    <nav class="rail"><div class="me">${avatar(ME_NAME, 40)}</div>${icon('chat', true)}${icon('contacts')}${icon('todo')}<div class="grow"></div>${icon('cloud')}${icon('gear')}</nav>
    <section class="list">
      <div class="search"><div>🔍 Tìm kiếm</div></div>
      <div class="filters"><span class="on">Tất cả</span><span>Chưa đọc</span></div>
      ${shown.slice(0, 11).map(c => {
        const last = c.messages[c.messages.length - 1];
        return `<div class="conv${c === open ? ' sel' : ''}">${avatar(c.name)}<div class="body"><div class="top"><span class="name">${esc(c.name)}</span><span class="time">${listTime(+last.sendDttm)}</span></div><div class="prev">${esc(preview(last))}</div></div></div>`;
      }).join('')}
    </section>
    <section class="chat">
      <header>${avatar(open.name, 44)}<div><div class="t">${esc(open.name)}</div><div class="s">${open.members} thành viên</div></div></header>
      <div class="msgs">${bubbles}</div>
      <div class="input">Nhập @, tin nhắn tới ${esc(open.name)}</div>
    </section>`;
}
render();
