// Job simulation: the real page script (bridge.js, in a vm context like the page's own world)
// talking to a fake Zalo Web data layer found through a fake webpack, the real content script
// (normalize.js + content.js, in a second vm context like Chrome's isolated world), and the real
// service worker with its IndexedDB archive (fake-indexeddb) and a fake Downloads folder. Each
// test runs export jobs the way the side panel does and checks the archive and the files.
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as db from '../extension/modules/chats/db.js';
import { msg, content, quote, photoUrls } from './fixtures/zalo.mjs';

// ---------- timers ----------
const realSetTimeout = setTimeout, realClearTimeout = clearTimeout, realSetInterval = setInterval;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms, ...a).unref();
globalThis.setInterval = (fn, ms, ...a) => realSetInterval(fn, ms, ...a).unref();
const sleep = ms => new Promise(r => realSetTimeout(r, ms));
async function waitUntil(cond, timeoutMs, what) {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}
// The service worker's clock (this realm's Date.now) can be moved forward.
const clock = { skew: 0 };
const realNow = Date.now;
Date.now = () => realNow() + clock.skew;

// ---------- chrome.* ----------
const EXT_ID = 'chatkeep-z-test', TAB_ID = 7, CHANNEL = '__zlx_chats__', ORIGIN = 'https://chat.zalo.me';
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const event = list => ({ addListener: f => list.push(f), removeListener: f => { const i = list.indexOf(f); if (i >= 0) list.splice(i, 1); } });
function deliver(listeners, message, sender) {
  return new Promise(resolve => {
    let answered = false, waiting = false;
    const sendResponse = v => { if (!answered) { answered = true; resolve(clone(v)); } };
    for (const l of [...listeners]) if (l(clone(message), sender, sendResponse) === true) waiting = true;
    if (!waiting && !answered) resolve(undefined);
  });
}
function storageArea() {
  return {
    data: {},
    onGet: null,
    async get(keys) {
      const out = {};
      for (const k of [].concat(keys)) if (k in this.data) out[k] = clone(this.data[k]);
      if (this.onGet) this.onGet(keys);
      return out;
    },
    async set(items) { for (const [k, v] of Object.entries(items)) this.data[k] = clone(v); },
  };
}

const local = storageArea(), session = storageArea();
const disk = new Map();      // the Downloads folder: path -> content
const history = new Map();   // Chrome's download list
const extBlobs = new Map();  // blob: URLs made by the offscreen document
const bubble = [];
const fetchedUrls = [];      // every URL a download was started for
const swListeners = [], changedListeners = [], filenameListeners = [];
let nextDownloadId = 1, blobSeq = 0, offscreenOpen = false;

// What the file servers answer.
const server = { fail: new Set(), html: new Set(), jxl: new Set(), stall: new Set() };
function serve(url) {
  if (url.startsWith('blob:')) return { mime: 'text/plain', body: extBlobs.get(url) };
  if (server.fail.has(url)) return { error: 'SERVER_BAD_CONTENT' };
  if (server.html.has(url)) return { mime: 'text/html', body: '<html>error</html>' };
  if (server.jxl.has(url)) return { mime: 'image/jxl', body: 'jxl bytes' };
  const mime = /\/gr\/jpg\//.test(url) ? 'image/jpg' : /\/gr\/jxl\//.test(url) ? 'image/jxl' : /\.gif$/.test(url) ? 'image/gif'
    : /dlmd\.me/.test(url) ? 'video/mp4' : /\.aac$/.test(url) ? 'audio/aac' : 'application/octet-stream';
  return { mime, body: `bytes of ${url}` };
}

globalThis.chrome = {
  runtime: {
    id: EXT_ID,
    onInstalled: event([]),
    onMessage: event(swListeners),
    async sendMessage(m) {
      if (m.target !== 'offscreen') return undefined;
      if (m.type === 'blob') { const url = `blob:chrome-extension://${EXT_ID}/${++blobSeq}`; extBlobs.set(url, m.text); return { url }; }
      extBlobs.delete(m.url);
      return { ok: true };
    },
  },
  tabs: { sendMessage: (tabId, m) => tabMessage(tabId, m) },
  storage: { local, session },
  offscreen: { hasDocument: async () => offscreenOpen, createDocument: async () => { offscreenOpen = true; } },
  sidePanel: { setPanelBehavior: async () => {} },
  downloads: {
    async download({ url, filename }) {
      const id = nextDownloadId++;
      if (!url.startsWith('blob:')) fetchedUrls.push(url);
      const item = { id, url, finalUrl: url, filename: '', state: 'in_progress', byExtensionId: EXT_ID, mime: '', fileSize: 0, bytesReceived: 0 };
      history.set(id, item);
      if (server.stall.has(url)) return id; // connected, but no data ever arrives
      realSetTimeout(() => {
        let suggested = null;
        for (const l of filenameListeners) l({ ...item }, s => { suggested = (s && s.filename) || null; });
        item.filename = filenameListeners.length ? suggested || url.split('/').pop() : filename;
        const r = serve(url);
        if (r.error) {
          item.state = 'interrupted';
          for (const l of [...changedListeners]) l({ id, state: { previous: 'in_progress', current: 'interrupted' }, error: { current: r.error } });
          return;
        }
        disk.set(item.filename, r.body);
        Object.assign(item, { state: 'complete', mime: r.mime, fileSize: (r.body || '').length });
        for (const l of [...changedListeners]) l({ id, state: { previous: 'in_progress', current: 'complete' } });
      }, 2);
      return id;
    },
    async search({ id }) { return history.has(id) ? [{ ...history.get(id) }] : []; },
    async erase({ id }) { history.delete(id); return [id]; },
    async removeFile(id) { const it = history.get(id); if (it) disk.delete(it.filename); },
    async cancel(id) {
      const it = history.get(id);
      if (!it || it.state !== 'in_progress') return;
      it.state = 'interrupted';
      for (const l of [...changedListeners]) l({ id, state: { previous: 'in_progress', current: 'interrupted' }, error: { current: 'USER_CANCELED' } });
    },
    async setUiOptions({ enabled }) { bubble.push(enabled); },
    onChanged: event(changedListeners),
    onDeterminingFilename: event(filenameListeners),
  },
};
await import('../extension/sw.js');

// ---------- fake Zalo Web: its data layer, reached through webpack ----------
const ME = '1000000000000000001', U1 = '2000000000000000001', U2 = '2000000000000000002';
const U3 = '2000000000000000003'; // unknown to Zalo's caches, known to its profile service
const U4 = '2000000000000000004'; // unknown everywhere
const lt = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
const keyOf = m => [m.sendDttm, m.msgId];
const sortMsgs = list => list.sort((a, b) => (lt(keyOf(a), keyOf(b)) ? -1 : lt(keyOf(b), keyOf(a)) ? 1 : 0));

const zalo = {
  convs: new Map(),
  names: new Map([[ME, 'Tôi'], [U1, 'An'], [U2, 'Bình']]),
  profiles: new Map([[U3, 'Cường']]),
  calls: [],
  cloudCalls: 0,
  dangerCalls: 0,
  convGetterCalls: 0,
  onCall: null, // test hook: (fn, args) before an answer
  ignoreCursor: false, // a broken Zalo that answers every read with the newest page
  add(c) { sortMsgs(c.messages); sortMsgs(c.cloud || (c.cloud = [])); this.convs.set(c.id, c); if (!c.isGroup) this.names.set(c.id, c.name); return c; },
};
function called(fn, args) { zalo.calls.push({ fn, ...args }); if (zalo.onCall) zalo.onCall(fn, args); }
const messagesApi = {
  getLastMessageFrom(convId, msgId, sendDttm, count, include) {
    called('getLastMessageFrom', { convId, msgId, sendDttm, count });
    const c = zalo.convs.get(convId);
    const cur = zalo.ignoreCursor ? ['9999999999999999', '99999999999999999999'] : [String(sendDttm), String(msgId)];
    const list = (c ? c.messages : []).filter(m => (include ? !lt(cur, keyOf(m)) : lt(keyOf(m), cur)));
    return Promise.resolve(structuredClone(list.slice(-count)));
  },
  getOldestValidMessage(convId) {
    const c = zalo.convs.get(convId);
    return Promise.resolve(c && c.messages.length ? structuredClone(c.messages[0]) : undefined);
  },
};
const loaderApi = {
  loadOldMessagesFromCloudForConversation(convId, { msgId }, opts) {
    zalo.cloudCalls++;
    called('cloud', { convId, msgId, src: opts && opts.src });
    const c = zalo.convs.get(convId);
    const all = sortMsgs([...c.cloud, ...c.messages]);
    let idx = all.findIndex(m => m.msgId === String(msgId));
    if (idx < 0) idx = 0;
    const page = all.slice(Math.max(0, idx - 50), idx).filter(m => c.cloud.includes(m));
    return Promise.resolve({ messages: structuredClone(page), hasMore: idx - 50 > 0 && c.cloud.includes(all[idx - 51]) });
  },
  getLastMessagesForConversation() { return Promise.resolve([]); },
};
const profilesApi = {
  getUidMe: () => ME,
  getMiniInfo: uid => ({ dName: zalo.names.get(uid) || '', avatar: '' }),
  getDName: uid => zalo.names.get(uid) || '',
  getProfileFriendByIds(uids) {
    called('profiles', { uids: [...uids] });
    const out = {};
    for (const u of uids) if (zalo.profiles.has(u)) { out[u] = { displayName: zalo.profiles.get(u), zaloName: 'z', phoneNumber: '0900000000' }; zalo.names.set(u, zalo.profiles.get(u)); }
    return Promise.resolve(out);
  },
};
const namesApi = { getDName: uid => zalo.names.get(uid) || '', getAliasName: () => '', getProfileByIdFromCache: () => null };
const convHolder = {};
Object.defineProperty(convHolder, 'ConvInfoDataManager', {
  get() {
    zalo.convGetterCalls++;
    return { getAllConvSync: () => [...zalo.convs.values()].map(c => ({ userId: c.id, isGroup: c.isGroup ? 1 : 0, numMsg: 0, pinned: false, label: 0 })) };
  },
});
const groupManager = {
  getDName: gid => (zalo.convs.get(gid) || {}).name || '',
  getGroupByIdSync: gid => { const c = zalo.convs.get(gid); return c ? { displayName: c.name, totalMember: c.members || 3 } : null; },
};
// Webpack 4 export objects: each binding is a one-line getter.
function exportsOf(bindings) {
  const ex = {};
  Object.defineProperty(ex, '__esModule', { value: true });
  for (const [k, v] of Object.entries(bindings)) Object.defineProperty(ex, k, { enumerable: true, get: () => v });
  return ex;
}
// A module whose export runs code when read: the page script must never read it.
const danger = {};
Object.defineProperty(danger, 'store', {
  enumerable: true,
  get() {
    // Reading this getter would run arbitrary code in the page; the page script checks descriptors only.
    zalo.dangerCalls++;
    return messagesApi;
  },
});
function makeWebpack() {
  const cache = {};
  const req = id => cache[id].exports;
  req.c = cache;
  const add = (id, exports) => { cache[id] = { i: id, l: true, exports }; };
  add('0Nn1', danger);
  add('9x7k', function unrelated() {});
  add('XS0u', exportsOf({ default: messagesApi }));
  add('4wTQ', exportsOf({ default: loaderApi }));
  add('UiPd', exportsOf({ default: profilesApi }));
  add('JWY6', exportsOf({ a: namesApi }));
  add('QPNp', exportsOf({ a: convHolder }));
  return {
    push([, factories]) {
      for (const [id, f] of Object.entries(factories)) { const m = { i: id, l: false, exports: {} }; cache[id] = m; f.call(m.exports, m, m.exports, req); m.l = true; }
    },
  };
}
function fakeStorage(init) {
  const s = {};
  Object.defineProperties(s, {
    getItem: { value: k => (Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null) },
    setItem: { value: (k, v) => { s[k] = String(v); } },
  });
  return Object.assign(s, init);
}
const pageLocal = fakeStorage({ sh_singleton_web_app: 'TAB-1', [`${ME}_data_ids_hidden_chat`]: JSON.stringify(['gHIDDEN0000000000001']) });

// ---------- the tab: the page's world and the content script's world ----------
const BRIDGE_JS = readFileSync(new URL('../extension/modules/chats/bridge.js', import.meta.url), 'utf8');
const NORMALIZE_JS = readFileSync(new URL('../extension/modules/chats/normalize.js', import.meta.url), 'utf8');
const CONTENT_JS = readFileSync(new URL('../extension/modules/chats/content.js', import.meta.url), 'utf8');
const worlds = [];
let tab = null;

function post(data) {
  const payload = structuredClone(data);
  realSetTimeout(() => {
    for (const w of worlds) if (w.alive) for (const l of [...w.listeners]) l({ source: w.inner, data: structuredClone(payload), origin: ORIGIN });
  }, 0);
}
function makeWorld(globals) {
  const w = { alive: true, listeners: [], timers: new Set(), log: [] };
  const win = {
    setTimeout(fn, ms, ...a) {
      if (!w.alive) return 0;
      const t = realSetTimeout(() => { w.timers.delete(t); if (w.alive) fn(...a); }, ms);
      w.timers.add(t);
      return t;
    },
    clearTimeout(t) { w.timers.delete(t); realClearTimeout(t); },
    location: { origin: ORIGIN, href: `${ORIGIN}/` },
    addEventListener: (type, fn) => { if (type === 'message') w.listeners.push(fn); },
    postMessage: data => { if (w.alive) post(data); },
    console: { info: (tag, line) => w.log.push(line), log() {}, warn() {}, error: (...a) => w.log.push(a.join(' ')) },
    performance: { now: () => performance.now() },
    ...globals,
  };
  win.window = win;
  w.ctx = vm.createContext(win);
  w.inner = vm.runInContext('window', w.ctx);
  w.destroy = () => { w.alive = false; for (const t of w.timers) realClearTimeout(t); };
  worlds.push(w);
  return w;
}
function loadTab() {
  const page = makeWorld({ webpackJsonp: makeWebpack(), groupManager, localStorage: pageLocal, sessionStorage: fakeStorage({ 'backup-tab-key': 'TAB-1' }) });
  vm.runInContext(BRIDGE_JS, page.ctx, { filename: 'bridge.js' });
  const iso = makeWorld({});
  const listeners = [];
  iso.chromeListeners = listeners;
  iso.ctx.chrome = {
    runtime: {
      sendMessage: m => (iso.alive ? deliver(swListeners, m, { id: EXT_ID, tab: { id: TAB_ID } }) : new Promise(() => {})),
      onMessage: event(listeners),
    },
    storage: { local },
  };
  vm.runInContext(NORMALIZE_JS, iso.ctx, { filename: 'normalize.js' });
  vm.runInContext(CONTENT_JS, iso.ctx, { filename: 'content.js' });
  tab = { page, iso };
  return tab;
}
function tabMessage(tabId, m) {
  if (tabId !== TAB_ID || !tab || !tab.iso.alive) return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
  return deliver(tab.iso.chromeListeners, m, { id: EXT_ID });
}
// A reload replaces the page and its content script; Chrome injects both again.
function reloadTab() {
  tab.page.destroy();
  tab.iso.destroy();
  loadTab();
}

// ---------- chats ----------
const T0 = new Date(2026, 8, 10, 8, 0).getTime(); // 10 Sep 2026, 08:00
const MIN = 60e3;
let convSeq = 0;
// n messages; message i at start + (i - 1) * gap, with a deterministic 13-digit id. Like Zalo's
// own store, the account's own messages have fromUid "0".
function chat(id, n, { first = 1, gap = 17 * MIN, start = T0, from = [ME, U1, U2], make } = {}) {
  const num = id.num || (id.num = ++convSeq);
  return Array.from({ length: n }, (_, k) => {
    const i = first + k;
    const [type, body] = (make && make(i)) || content.text(`${id.tag} message ${i}`);
    const sender = from[i % from.length];
    return msg(id.id, start + (i - 1) * gap, sender === ME ? '0' : sender, type, body, { msgId: String(7000000000000 + num * 100000 + i) });
  });
}
const convs = {};
function addConv(tag, { isGroup = true, name, members, n = 0, opts = {}, cloud } = {}) {
  const id = isGroup ? `g80000000000000${String(Object.keys(convs).length + 10).padStart(5, '0')}` : `30000000000000${String(Object.keys(convs).length + 10).padStart(5, '0')}`;
  const ref = { tag, id };
  convs[tag] = ref;
  zalo.add({ id, name: name || (isGroup ? `Nhóm ${tag}` : `Bạn ${tag}`), isGroup, members, messages: n ? chat(ref, n, opts) : [], cloud: cloud ? chat(ref, cloud.n, cloud.opts) : [] });
  return ref;
}
const Z = tag => zalo.convs.get(convs[tag].id);
const byText = (tag, text) => Z(tag).messages.find(m => m.message === text);
const tsOf = (i, gap = 17 * MIN) => T0 + (i - 1) * gap;

// ---------- the side panel: Start, Stop, Resume ----------
const OPTIONS = { mode: 'text', split: 'none', formats: ['json', 'html', 'txt'], rewrite: false, recheck: false, from: null, to: null };
let jobSeq = 0;
async function startJob(tags, options = {}) {
  const job = {
    id: `job-${++jobSeq}`, tabId: TAB_ID, status: 'running', options: { ...OPTIONS, ...options },
    convs: tags.map(t => { const c = Z(t); return { id: c.id, name: c.name, isGroup: c.isGroup, members: c.members || null }; }),
    index: 0, step: 0, progress: { phase: 'starting' }, log: [], startedAt: Date.now(), updatedAt: Date.now(),
  };
  await local.set({ 'chats.job': job });
  await tabMessage(TAB_ID, { type: 'chats.runJob' });
}
async function stopJob() {
  const job = local.data['chats.job'];
  job.status = job.status === 'running' ? 'stopping' : job.status;
  tabMessage(job.tabId, { type: 'chats.stop' }).catch(() => {});
}
async function resumeJob() {
  const job = local.data['chats.job'];
  job.status = 'running';
  delete job.error;
  await tabMessage(TAB_ID, { type: 'chats.runJob' });
}
async function finished() {
  try {
    return await waitUntil(() => { const j = local.data['chats.job']; return j && (j.status === 'done' || j.status === 'stopped') && clone(j); }, 30000, 'the job to finish');
  } catch (e) {
    throw new Error(`${e.message}; job log: ${JSON.stringify((local.data['chats.job'] || {}).log)}`);
  }
}
async function runJob(tags, options) {
  const mark = zalo.calls.length, urls = fetchedUrls.length;
  await startJob(tags, options);
  const job = await finished();
  return { job, calls: zalo.calls.slice(mark), urls: fetchedUrls.slice(urls) };
}

// ---------- helpers ----------
const pages = calls => calls.filter(c => c.fn === 'getLastMessageFrom' && c.count > 1).length;
const archived = async tag => Object.fromEntries((await db.messagesInRange(convs[tag].id)).map(m => [m.id, m]));
const dir = tag => `Zalo_Export/${Z(tag).name.replace(/ /g, '_')}_${convs[tag].id}`;
const file = (tag, name) => disk.get(`${dir(tag)}/${name}`);
const json = (tag, name) => JSON.parse(file(tag, name));
const stem = tag => Z(tag).name.replace(/ /g, '_');
const conv = tag => db.getConv(convs[tag].id);
const readResult = job => tag => job.results[convs[tag].id];

loadTab();

// ---------- scenarios ----------
test('the chat list: names, groups and members, hidden chats left out', async () => {
  addConv('A', { members: 12, n: 450, opts: {
    from: [ME, U1, U2, U3],
    make: i => {
      if (i % 50 === 0) return content.photo(`A${i}`);
      if (i === 7) return content.sticker();
      if (i === 13) return content.link('https://example.com/a13');
      if (i === 21) return content.file('A21', 'kế hoạch.pdf');
      if (i === 40) return content.text('tin từ người lạ');
      return null;
    },
  } });
  const a = Z('A');
  a.messages.find(m => m.message === 'tin từ người lạ').fromUid = U4;
  const q = a.messages.find(m => m.message === 'A message 30');
  q.quote = quote(a.messages.find(m => m.message === 'A message 29'), 'An');
  const mention = a.messages.find(m => m.message === 'A message 31');
  mention.message = '@Cường xem';
  mention.mentions = [{ uid: U3, pos: 0, len: 6, type: 0 }];
  addConv('B', { isGroup: false, name: 'An', n: 120, opts: { from: [ME, U1] } });
  zalo.add({ id: 'gHIDDEN0000000000001', name: 'Hidden group', isGroup: true, messages: [], cloud: [] });

  const r = await tabMessage(TAB_ID, { type: 'chats.listConvs', deep: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.me, { id: ME, name: 'Tôi' });
  const byId = Object.fromEntries(r.conversations.map(c => [c.id, c]));
  assert.equal(byId['gHIDDEN0000000000001'], undefined);
  assert.deepEqual(byId[convs.A.id], { id: convs.A.id, isGroup: true, name: 'Nhóm A', members: 12, lastTs: tsOf(450), firstTs: tsOf(1) });
  assert.deepEqual(byId[convs.B.id], { id: convs.B.id, isGroup: false, name: 'An', lastTs: tsOf(120), firstTs: tsOf(1) });
  assert.equal(r.conversations[0].id, convs.A.id); // newest activity first
  assert.equal(zalo.dangerCalls, 0);
  assert.ok(zalo.convGetterCalls >= 1);
});

test('first run: reads the whole local history page by page, archives it, finds names, writes the files', async () => {
  const { job, calls } = await runJob(['A']);
  assert.equal(job.status, 'done');
  assert.equal(job.errors, undefined);
  const r = readResult(job)('A');
  assert.deepEqual(r.read, { seen: 450, added: 450, bottomReached: true, fromCloud: 0 });
  assert.deepEqual(r.names, { asked: 2, found: 1 });
  assert.equal(pages(calls), 4); // 200 + 200 + 50 + an empty page
  assert.deepEqual(calls.filter(c => c.fn === 'profiles').map(c => c.uids.sort()), [[U3, U4].sort()]);
  assert.equal(Object.keys(await archived('A')).length, 450);
  const c = await conv('A');
  assert.deepEqual(c.coverage, [[tsOf(1), tsOf(450)]]);
  assert.equal(c.participants[U3], 'Cường');
  assert.equal(c.me, ME);

  const doc = json('A', `${stem('A')}.json`);
  assert.deepEqual([doc.name, doc.type, doc.id, doc.messages.length], ['Nhóm A', 'private_group', convs.A.id, 450]);
  const stranger = doc.messages.find(m => m.text === 'tin từ người lạ');
  assert.deepEqual([stranger.from, stranger.from_id], [U4, `user${U4}`]);
  const mine = doc.messages.find(m => m.text === 'A message 4'); // stored by Zalo with fromUid "0"
  assert.deepEqual([mine.type, mine.from, mine.from_id], ['message', 'Tôi', `user${ME}`]);
  assert.ok(file('A', `${stem('A')}.html`).includes('<div class="msg me">'));
  const reply = doc.messages.find(m => m.text === 'A message 30');
  assert.equal(reply.reply_to_message_id, Number(byText('A', 'A message 29').msgId));
  const men = doc.messages.find(m => m.zalo.msg_id === byText('A', '@Cường xem').msgId);
  assert.deepEqual(men.text, [{ type: 'mention_name', text: '@Cường', user_id: U3 }, ' xem']);
  assert.equal(doc.messages.find(m => m.zalo.kind === 'photo').photo, '(File not included. Change data exporting settings to download.)');
  assert.match(file('A', `${stem('A')}.txt`), /\n\[\d\d\/09\/2026, \d\d:\d\d:00\] (Tôi|An|Bình|Cường): <photo not downloaded: 2026-09-\d\d_\d\d-\d\d-00_photo_\d{8}\.jpg>\n/);
  assert.ok(file('A', `${stem('A')}.html`).includes('<div class="note">sticker</div>'));
  assert.equal(zalo.dangerCalls, 0);
});

test('second run: reads only the new messages and a small overlap', async () => {
  Z('A').messages.push(...chat(convs.A, 10, { first: 451 }));
  const { job, calls } = await runJob(['A']);
  const r = readResult(job)('A');
  assert.equal(r.read.added, 10);
  assert.ok(r.read.seen <= 202, `read ${r.read.seen} messages`);
  assert.ok(pages(calls) <= 3, `${pages(calls)} pages`);
  assert.deepEqual(r.names, { asked: 0, found: 0 }); // the unknown one is not asked again this week
  assert.equal(Object.keys(await archived('A')).length, 460);
  assert.deepEqual((await conv('A')).coverage, [[tsOf(1), tsOf(460)]]);
  assert.equal(json('A', `${stem('A')}.json`).messages.length, 460);
});

test('a run with nothing new rewrites no files; "Rewrite all files" writes them again', async () => {
  await sleep(1100);
  const { job } = await runJob(['A']);
  const r = readResult(job)('A');
  assert.equal(r.read.added, 0);
  assert.deepEqual([r.files.written, r.files.skipped], [0, 3]);
  const again = await runJob(['A'], { rewrite: true });
  assert.deepEqual([readResult(again.job)('A').files.written, readResult(again.job)('A').files.skipped], [3, 0]);
});

test('the end of the last run gone (deleted, or never synced here): kept and flagged; recalls and edits kept too', async () => {
  await runJob(['B']);
  const b = Z('B');
  const gone = b.messages.splice(115, 5); // B 116..120
  const m110 = b.messages[109];
  Object.assign(m110, { msgType: 20, message: { msgId: '0' } }); // recalled on Zalo
  b.messages[104].message = 'B message 105 (sửa)';
  b.messages.push(...chat(convs.B, 8, { first: 121, from: [ME, U1] }));

  const { job } = await runJob(['B']);
  assert.equal(readResult(job)('B').read.added, 8);
  const arch = await archived('B');
  assert.equal(Object.keys(arch).length, 128);
  for (const m of gone) {
    assert.equal(arch[m.msgId].text, m.message, 'kept');
    assert.equal(typeof arch[m.msgId].missingSince, 'number', 'flagged');
  }
  assert.equal(arch[b.messages[114].msgId].missingSince, undefined);
  assert.deepEqual([arch[m110.msgId].recalled, arch[m110.msgId].text, arch[m110.msgId].kind], [true, 'B message 110', 'text']);
  assert.equal(arch[b.messages[104].msgId].text, 'B message 105 (sửa)');
  assert.deepEqual(arch[b.messages[104].msgId].editHistory.map(e => e.text), ['B message 105']);

  const doc = json('B', `${stem('B')}.json`);
  assert.equal(doc.type, 'personal_chat');
  assert.equal(doc.messages.length, 128);
  assert.ok(doc.messages.find(m => m.text === 'B message 118').zalo.missing_since);
  const rec = doc.messages.find(m => m.text === 'B message 110');
  assert.equal(rec.zalo.recalled, true);
  const txt = file('B', `${stem('B')}.txt`);
  assert.match(txt, /B message 118 \(not found in Zalo since \d{4}-\d\d-\d\d — kept from the archive\)/);
  assert.match(txt, /\(recalled on Zalo — kept from the archive\) B message 110/);

  b.messages.push(...gone); // they sync back
  sortMsgs(b.messages);
  await runJob(['B']);
  const back = await archived('B');
  for (const m of gone) assert.equal(back[m.msgId].missingSince, undefined);
});

test('the newest messages gone with nothing new after them: flagged, kept', async () => {
  addConv('B2', { isGroup: false, name: 'Bình', n: 60, opts: { from: [ME, U2] } });
  await runJob(['B2']);
  const gone = Z('B2').messages.splice(57, 3);
  await runJob(['B2']);
  const arch = await archived('B2');
  assert.equal(Object.keys(arch).length, 60);
  for (const m of gone) assert.equal(typeof arch[m.msgId].missingSince, 'number');
  assert.equal(Object.values(arch).filter(m => m.missingSince).length, 3);
  assert.equal(json('B2', `${stem('B2')}.json`).messages.length, 60);
});

test('a device with less history than the archive: older archived messages are kept, not flagged', async () => {
  addConv('C', { n: 100 });
  await runJob(['C']);
  const c = Z('C');
  c.messages = [...c.messages.slice(90), ...chat(convs.C, 5, { first: 101 })];
  const { job } = await runJob(['C']);
  assert.equal(readResult(job)('C').read.added, 5);
  const arch = Object.values(await archived('C'));
  assert.equal(arch.length, 105);
  assert.equal(arch.filter(m => m.missingSince).length, 0);
  assert.equal(json('C', `${stem('C')}.json`).messages.length, 105);
});

test('older history that appears later (synced from the phone) is read without re-reading the middle', async () => {
  addConv('D', { n: 300, opts: { first: 301 } });
  await runJob(['D']);
  Z('D').messages.push(...chat(convs.D, 300), ...chat(convs.D, 3, { first: 601 }));
  sortMsgs(Z('D').messages);
  const { job } = await runJob(['D']);
  const r = readResult(job)('D').read;
  assert.equal(r.added, 303);
  assert.ok(r.seen < 603, `read ${r.seen} of 603`);
  assert.equal(Object.keys(await archived('D')).length, 603);
  assert.deepEqual((await conv('D')).coverage, [[tsOf(1), tsOf(603)]]);
});

test('"Check the whole history again" finds messages that appeared inside an archived stretch', async () => {
  addConv('E', { n: 600 });
  await runJob(['E']);
  const e = Z('E');
  const inserted = [1, 2, 3].map(k => msg(e.id, tsOf(100) + k * 1000, U1, 1, `E inserted ${k}`, { msgId: String(7000000000000 + convs.E.num * 100000 + 90000 + k) }));
  e.messages.push(...inserted);
  sortMsgs(e.messages);
  assert.equal(readResult((await runJob(['E'])).job)('E').read.added, 0);
  const { job } = await runJob(['E'], { recheck: true });
  assert.equal(readResult(job)('E').read.added, 3);
  assert.equal(Object.keys(await archived('E')).length, 603);
});

test('photos: the JPEG copy first, the JPEG XL original as fallback, a failed one retried next run, other media once the mode widens', async () => {
  addConv('F', { n: 60, opts: {
    make: i => {
      if (i === 33) return content.gif('F33');
      if (i === 34) return content.video('F34');
      if (i === 47) return content.file('F47', 'report.pdf');
      if (i === 52) return content.voice('F52');
      if (i % 5 === 0) return i % 10 === 0 ? content.photo(`F${i}`) : content.groupPhoto(`F${i}`);
      return null;
    },
  } });
  const jpg = u => u.replace('/gr/jxl/', '/gr/jpg/').replace('.jxl?', '.jpg?');
  const p10 = photoUrls('F10'), p20 = photoUrls('F20'), p25 = photoUrls('F25');
  for (const u of [p10.hd, p10.ori, p10.normal]) server.fail.add(jpg(u));     // no JPEG copy: the original is kept
  server.html.add(jpg(p20.hd));                                                 // a web page instead of the file
  server.jxl.add(jpg(p20.ori));                                                 // JPEG XL bytes at a JPEG address
  for (const u of [p25.ori, p25.normal]) { server.fail.add(u); server.fail.add(jpg(u)); } // nothing works

  const run1 = await runJob(['F'], { mode: 'photos' });
  const r1 = readResult(run1.job)('F');
  assert.deepEqual(r1.media, { total: 13, done: 12, failed: 1, already: 0 });
  const id = i => String(7000000000000 + convs.F.num * 100000 + i);
  let rec = await db.getMedia(convs.F.id, [id(10), id(20), id(25), id(15), id(33)]);
  assert.match(rec[id(10)].path, /_photo_\d{8}\.jxl$/);
  assert.equal(disk.get(rec[id(10)].path), `bytes of ${p10.hd}`);
  assert.equal(disk.get(rec[id(20)].path), `bytes of ${jpg(p20.normal)}`);
  assert.match(rec[id(15)].path, new RegExp(`^${dir('F')}/media/2026-09/2026-09-1\\d_\\d\\d-\\d\\d-00_photo_\\d{8}\\.jpg$`));
  assert.equal(disk.get(rec[id(15)].path), `bytes of ${jpg(photoUrls('F15').ori)}`);
  assert.deepEqual([rec[id(25)].status, rec[id(25)].attempts], ['failed', 1]);
  assert.match(rec[id(33)].path, /_gif_\d{8}\.gif$/);
  assert.ok(![...disk.values()].includes('<html>error</html>'), 'the web page was removed');
  assert.ok(![...disk.values()].includes('jxl bytes'), 'the JPEG XL file under a .jpg name was removed');

  for (const u of [p25.ori, jpg(p25.ori)]) server.fail.delete(u);
  const run2 = await runJob(['F'], { mode: 'photos' });
  assert.deepEqual(readResult(run2.job)('F').media, { total: 1, done: 1, failed: 0, already: 12 });
  assert.deepEqual(run2.urls, [jpg(p25.ori)]);
  rec = await db.getMedia(convs.F.id, [id(25)]);
  assert.deepEqual([rec[id(25)].status, rec[id(25)].attempts], ['done', 2]);

  const run3 = await runJob(['F'], { mode: 'all' });
  assert.deepEqual(run3.urls.sort(), ['https://file-stal-1.dlfl.vn/fF47', 'https://video-stal-1.dlmd.me/vF34', 'https://voice-stal-1.zdn.vn/aF52.aac']);
  rec = await db.getMedia(convs.F.id, [id(34), id(47), id(52)]);
  assert.match(rec[id(34)].path, /_video_\d{8}\.mp4$/);
  assert.match(rec[id(47)].path, /_report\.pdf$/);
  assert.match(rec[id(52)].path, /_voice_\d{8}\.aac$/);
  const doc = json('F', `${stem('F')}.json`);
  const m15 = doc.messages.find(m => m.zalo.msg_id === id(15));
  const rec15 = (await db.getMedia(convs.F.id, [id(15)]))[id(15)];
  assert.equal(m15.photo, rec15.path.slice(dir('F').length + 1));
  const m33 = doc.messages.find(m => m.zalo.msg_id === id(33));
  assert.deepEqual([m33.media_type, m33.mime_type, m33.width], ['animation', 'image/gif', 200]);
  const m47 = doc.messages.find(m => m.zalo.msg_id === id(47));
  assert.deepEqual([m47.file_name, m47.file_size, m47.mime_type], ['report.pdf', 50000, 'application/pdf']);
  assert.match(m47.file, /^media\/2026-09\/.*_report\.pdf$/);
});

test('stop while reading, then resume: the chat completes and no photo is downloaded twice', async () => {
  addConv('G', { n: 900, opts: { make: i => (i % 30 === 0 ? content.photo(`G${i}`) : null) } });
  let n = 0;
  zalo.onCall = (fn, args) => { if (fn === 'getLastMessageFrom' && args.convId === convs.G.id && args.count > 1 && ++n === 2) stopJob(); };
  const run1 = await runJob(['G'], { mode: 'photos' });
  zalo.onCall = null;
  assert.equal(run1.job.status, 'stopped');
  const part = Object.keys(await archived('G')).length;
  assert.ok(part >= 200 && part < 900, `archived ${part} before the stop`);
  const cov = (await conv('G')).coverage;
  assert.equal(cov.length, 1);
  assert.ok(cov[0][0] > tsOf(1));
  assert.equal(file('G', `${stem('G')}.json`), undefined);

  const mark = fetchedUrls.length;
  await resumeJob();
  const job = await finished();
  assert.equal(job.status, 'done');
  assert.equal(Object.keys(await archived('G')).length, 900);
  assert.deepEqual((await conv('G')).coverage, [[tsOf(1), tsOf(900)]]);
  const all = [...run1.urls, ...fetchedUrls.slice(mark)];
  assert.equal(all.length, 30);
  assert.equal(new Set(all).size, 30);
});

test('stop while downloading, then resume: the rest is downloaded, nothing twice', async () => {
  addConv('H', { n: 40, opts: { make: i => content.photo(`H${i}`) } });
  const mark = fetchedUrls.length;
  let seen = 0;
  const hook = d => { if (d.state && d.state.current === 'complete' && ++seen === 5) stopJob(); };
  changedListeners.push(hook);
  const run1 = await runJob(['H'], { mode: 'photos' });
  changedListeners.splice(changedListeners.indexOf(hook), 1);
  assert.equal(run1.job.status, 'stopped');
  assert.ok(fetchedUrls.length - mark < 40);
  await resumeJob();
  assert.equal((await finished()).status, 'done');
  await waitUntil(async () => Object.values(await db.getMedia(convs.H.id, Z('H').messages.map(m => m.msgId))).filter(r => r.status === 'done').length === 40, 5000, 'all photos');
  const urls = fetchedUrls.slice(mark);
  assert.equal(urls.length, 40);
  assert.equal(new Set(urls).size, 40);
});

test('a Stop that lands while the content script saves progress still stops the job', async () => {
  addConv('S', { n: 30, opts: { make: i => content.photo(`S${i}`) } });
  // The panel's write lands between the content script's read and write of the job record.
  zalo.onCall = (fn, args) => {
    if (fn === 'getLastMessageFrom' && args.convId === convs.S.id && !local.onGet) {
      zalo.onCall = null;
      let reads = 0;
      local.onGet = keys => {
        if (!String(keys).includes('chats.job') || ++reads < 2) return;
        local.onGet = null;
        local.data['chats.job'].status = 'stopping';
        tabMessage(TAB_ID, { type: 'chats.stop' }).catch(() => {});
      };
    }
  };
  const { job, urls } = await runJob(['S'], { mode: 'photos' });
  assert.equal(job.status, 'stopped');
  assert.ok(urls.length <= 3, `${urls.length} photos downloaded after Stop`);
});

test('a date range: reading stops at the start date and the files go to their own folder', async () => {
  addConv('I', { n: 1000, opts: { gap: 36 * MIN } }); // 10 Sep .. 5 Oct
  const from = new Date(2026, 8, 30).getTime();
  const { job } = await runJob(['I'], { from });
  const r = readResult(job)('I').read;
  assert.equal(r.bottomReached, false);
  assert.equal(r.seen, 400);
  const inRange = Z('I').messages.filter(m => Number(m.sendDttm) >= from);
  const doc = json('I', `range_2026-09-30_to_now/${stem('I')}.json`);
  assert.equal(doc.messages.length, inRange.length);
  assert.equal(doc.messages[0].zalo.msg_id, inRange[0].msgId);
  assert.equal(file('I', `${stem('I')}.json`), undefined);

  const full = await runJob(['I']);
  assert.equal(readResult(full.job)('I').read.added, 600);
  assert.equal(json('I', `${stem('I')}.json`).messages.length, 1000);
});

test('older messages from Zalo\'s server: fetched once, then never asked again', async () => {
  addConv('K', { isGroup: false, name: 'Chị Lan', n: 100, opts: { first: 101, from: [ME, U1] }, cloud: { n: 100, opts: { from: [ME, U1] } } });
  const { job } = await runJob(['K']);
  const r = readResult(job)('K').read;
  assert.deepEqual([r.added, r.fromCloud, r.bottomReached], [200, 100, true]);
  const c = await conv('K');
  assert.equal(c.cloudDone, true);
  assert.equal(Object.keys(await archived('K')).length, 200);
  const calls = zalo.cloudCalls;
  const again = await runJob(['K']);
  assert.equal(zalo.cloudCalls, calls);
  assert.equal(readResult(again.job)('K').read.added, 0);
  assert.equal(json('K', `${stem('K')}.json`).messages.length, 200);
});

test('a download that gets no data for three minutes is cancelled, and tried again on the next run', async () => {
  addConv('V', { n: 5, opts: { make: i => (i === 3 ? content.video('V3') : null) } });
  const url = 'https://video-stal-1.dlmd.me/vV3';
  server.stall.add(url);
  await startJob(['V'], { mode: 'all' });
  await waitUntil(() => [...history.values()].some(it => it.url === url && it.state === 'in_progress'), 10000, 'the download to start');
  clock.skew += 200e3;
  const job = await finished();
  assert.deepEqual(readResult(job)('V').media, { total: 1, done: 0, failed: 1, already: 0 });
  const id = Z('V').messages[2].msgId;
  let rec = (await db.getMedia(convs.V.id, [id]))[id];
  assert.deepEqual([rec.status, rec.error], ['failed', 'no data for 3 minutes']);
  server.stall.delete(url);
  const again = await runJob(['V'], { mode: 'all' });
  assert.deepEqual(readResult(again.job)('V').media, { total: 1, done: 1, failed: 0, already: 0 });
  rec = (await db.getMedia(convs.V.id, [id]))[id];
  assert.deepEqual([rec.status, rec.attempts], ['done', 2]);
});

test('several chats in one job; a reload of the tab mid-job resumes where it was', async () => {
  addConv('L', { n: 700 });
  addConv('M', { n: 50 });
  const first = tab;
  let n = 0;
  zalo.onCall = (fn, args) => { if (fn === 'getLastMessageFrom' && args.convId === convs.L.id && args.count > 1 && ++n === 2) { zalo.onCall = null; realSetTimeout(reloadTab, 0); } };
  await startJob(['L', 'M']);
  const job = await finished();
  assert.equal(job.status, 'done');
  assert.equal(job.errors, undefined);
  assert.notEqual(tab, first);
  assert.equal(first.iso.alive, false);
  assert.deepEqual(Object.keys(job.results).sort(), [convs.L.id, convs.M.id].sort());
  assert.equal(json('L', `${stem('L')}.json`).messages.length, 700);
  assert.equal(json('M', `${stem('M')}.json`).messages.length, 50);
});

test('a Zalo that answers every read with the same page does not trap the job in a loop', async () => {
  addConv('O', { n: 500 });
  addConv('P', { n: 20 });
  zalo.ignoreCursor = true;
  const { job, calls } = await runJob(['O', 'P']).finally(() => { zalo.ignoreCursor = false; });
  assert.equal(job.status, 'done'); // each chat stops with an error; the job goes on and ends
  assert.deepEqual(job.errors.map(e => e.convId), [convs.O.id, convs.P.id]);
  for (const e of job.errors) assert.match(e.error, /not older than the last page/);
  for (const t of ['O', 'P']) assert.equal(calls.filter(c => c.fn === 'getLastMessageFrom' && c.convId === convs[t].id && c.count > 1).length, 2);
  assert.equal(Object.keys(await archived('O')).length, 200); // what was read is kept
  assert.equal(Object.keys(await archived('P')).length, 20);
});

test('Zalo active in another tab: the job stops with the reason, and resumes once this tab is active again', async () => {
  addConv('N', { n: 20 });
  pageLocal.setItem('sh_singleton_web_app', 'TAB-2');
  const { job } = await runJob(['N']);
  assert.equal(job.status, 'stopped');
  assert.match(job.error, /active in another tab/);
  pageLocal.setItem('sh_singleton_web_app', 'TAB-1');
  await resumeJob();
  assert.equal((await finished()).status, 'done');
  assert.equal(json('N', `${stem('N')}.json`).messages.length, 20);
});

test('downloads stay out of the way; nothing but names is kept from profiles; the page script ran no getter', async () => {
  assert.ok(bubble.includes(false));
  assert.equal(history.size, 0);
  for (const [path, body] of disk) {
    assert.ok(path.startsWith('Zalo_Export/'), `stray file ${path}`);
    assert.doesNotMatch(path, /[\s()[\]]/, `space or bracket in ${path}`);
    assert.notEqual(body, undefined, `${path} saved without data`);
  }
  for (const c of await db.allConvs()) assert.ok(!JSON.stringify(c).includes('0900000000'), 'a phone number was stored');
  assert.equal(zalo.dangerCalls, 0);
  await waitUntil(() => bubble.at(-1) === true, 6000, 'the download bubble to come back');
});
