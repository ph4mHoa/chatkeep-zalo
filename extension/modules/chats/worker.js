// Chats module, service worker side: owns the chat archive (IndexedDB), downloads media into the
// export folder, and writes the export files.
import './normalize.js';
import * as db from './db.js';
import { mediaPath, folderName, urlExt } from './paths.js';
import { buildExport } from './export.js';
import { download, forget, savingStarted, savingEnded, writeFiles } from '../../core/downloads.js';

const { jpegUrl, uidsOf } = globalThis.ZLXNormalize;
const broadcast = msg => chrome.runtime.sendMessage(msg).catch(() => {});
const NAME_RETRY_MS = 7 * 86400e3; // a name Zalo could not give is asked for again after a week

// Addresses a file can be downloaded from, best first. A photo's JPEG copies come before the
// JPEG XL originals, which Chrome cannot show.
export function candidates(att) {
  const urls = [att.url, ...(att.alts || [])].filter(Boolean);
  const out = [];
  const add = (url, ext) => { if (url && !out.some(c => c.url === url)) out.push({ url, ext }); };
  if (att.kind === 'photo') {
    for (const u of urls) add(jpegUrl(u), 'jpg');
    for (const u of urls) add(u, urlExt(u) || 'jpg');
  } else if (att.kind === 'file') {
    for (const u of urls) add(u, null);
  } else {
    const fallback = { gif: 'gif', video: 'mp4', voice: 'aac' }[att.kind] || 'bin';
    for (const u of urls) add(u, urlExt(u) || fallback);
  }
  return out;
}

// Media downloads in flight. Mirrored to storage.session so a restarted worker still knows them.
const inflight = new Map();
const inflightReady = chrome.storage.session.get('chats.inflight').then(r => { for (const e of r['chats.inflight'] || []) inflight.set(e.token, e); });
const saveInflight = () => chrome.storage.session.set({ 'chats.inflight': [...inflight.values()] });

async function finishMedia(token, status, extra = {}) {
  await inflightReady;
  const e = inflight.get(token);
  if (!e) return;
  inflight.delete(token);
  saveInflight();
  savingEnded();
  if (e.downloadId != null) forget(e.downloadId);
  await db.putMedia({ convId: e.convId, id: e.attId, messageId: e.messageId, ts: e.ts, kind: e.att.kind, status, path: status === 'done' ? e.path : null, url: e.url || null, error: null, ...extra });
  const note = { type: 'chats.media.status', convId: e.convId, id: e.attId, status };
  broadcast(note);
  if (e.tabId != null) chrome.tabs.sendMessage(e.tabId, note).catch(() => {});
}

async function startCandidate(e) {
  const c = e.cands[e.tried];
  const conv = (await db.getConv(e.convId)) || { convId: e.convId };
  e.path = mediaPath(conv, { id: e.messageId, ts: e.ts }, e.att, c.ext);
  e.url = c.url;
  e.downloadId = null;
  Object.assign(e, { bytes: 0, progressAt: Date.now(), stalled: false });
  try {
    e.downloadId = await download({ url: c.url, filename: e.path });
    saveInflight();
  } catch (err) {
    await nextCandidate(e, String((err && err.message) || err));
  }
}
async function nextCandidate(e, error) {
  if (e.downloadId != null) forget(e.downloadId);
  e.downloadId = null;
  e.tried++;
  if (e.tried < e.cands.length) { saveInflight(); return startCandidate(e); }
  await finishMedia(e.token, 'failed', { error });
}
// A server that refuses a file sometimes answers with a web page instead: that is not the file.
// Nor is a JPEG XL file sent for a photo's JPEG address.
async function completed(e) {
  const [it] = await chrome.downloads.search({ id: e.downloadId });
  const wrong = !it ? null : it.fileSize === 0 ? 'an empty file' : /^text\/html/i.test(it.mime || '') ? 'a web page'
    : e.cands[e.tried].ext === 'jpg' && /jxl/i.test(it.mime || '') ? 'JPEG XL for a JPEG' : null;
  if (wrong) {
    await chrome.downloads.removeFile(e.downloadId).catch(() => {});
    return nextCandidate(e, `server sent ${wrong}`);
  }
  await finishMedia(e.token, 'done', { mime: (it && it.mime) || null, size: (it && it.fileSize) || null });
}
chrome.downloads.onChanged.addListener(async delta => {
  if (!delta.state) return;
  await inflightReady;
  const e = [...inflight.values()].find(x => x.downloadId === delta.id);
  if (!e) return;
  if (delta.state.current === 'complete') await completed(e);
  else if (delta.state.current === 'interrupted') await nextCandidate(e, e.stalled ? 'no data for 3 minutes' : (delta.error && delta.error.current) || 'interrupted');
});
// A download that never started within five minutes is marked failed; one that has received no
// data for three minutes is cancelled (and tried again on the next run). Checked whenever the tab
// asks how its downloads are doing, since an idle worker's timers do not run.
async function checkStalled() {
  await inflightReady;
  const now = Date.now();
  for (const e of [...inflight.values()]) {
    if (e.downloadId == null) {
      if (now - e.createdAt > 300e3) await finishMedia(e.token, 'failed', { error: 'download did not start' });
      continue;
    }
    const [it] = await chrome.downloads.search({ id: e.downloadId });
    if (!it || it.state !== 'in_progress' || e.stalled) continue;
    if (it.bytesReceived !== e.bytes) { e.bytes = it.bytesReceived; e.progressAt = now; }
    else if (now - (e.progressAt || e.createdAt) > 180e3) { e.stalled = true; chrome.downloads.cancel(e.downloadId).catch(() => {}); }
  }
  saveInflight();
}
setInterval(checkStalled, 60e3);

async function exportConv(convId, options) {
  const conv = await db.getConv(convId);
  if (!conv) return { ok: false, error: 'no archive for this chat yet' };
  const messages = await db.messagesInRange(convId, options.from, options.to);
  const media = Object.fromEntries((await db.mediaForConv(convId)).map(r => [r.id, r]));
  const now = Date.now();
  const files = buildExport({ conv, messages, media, options, now });
  // Unchanged files are not written again ("Rewrite all files" in the panel forces it).
  const out = await writeFiles(files, {
    now, rewrite: options.rewrite,
    getFile: db.getFile,
    putFile: rec => db.putFile({ ...rec, convId }),
    onProgress: (done, total, path) => broadcast({ type: 'chats.export.progress', convId, done, total, path }),
  });
  await db.updateConv(convId, c => { c.lastExportAt = Date.now(); c.lastExportOptions = options; });
  return { ok: true, ...out, messages: messages.length };
}

export default {
  id: 'chats',
  handlers: {
    // Before a chat is read: remember what the chat is, return what earlier runs covered.
    'chats.conv.state': async ({ convId, name, isGroup, members, me }) => {
      const c = await db.updateConv(convId, c => {
        if (name) c.name = name;
        if (!c.folder) c.folder = folderName(c);
        if (isGroup != null) c.isGroup = isGroup;
        if (members) c.members = members;
        if (me && me.id) { c.me = me.id; if (me.name) c.participants = { ...(c.participants || {}), [me.id]: me.name }; }
      });
      return { coverage: c.coverage || [], cloudDone: !!c.cloudDone, cloudCursor: c.cloudCursor || null, messageCount: c.messageCount || 0 };
    },
    'chats.conv.update': async ({ convId, participants, tried, cloudDone, cloudCursor }) => {
      await db.updateConv(convId, c => {
        if (participants) c.participants = { ...(c.participants || {}), ...participants };
        if (tried) { const now = Date.now(); c.namesTried = { ...(c.namesTried || {}) }; for (const u of tried) c.namesTried[u] = now; }
        if (cloudCursor) c.cloudCursor = cloudCursor;
        if (cloudDone != null) { c.cloudDone = cloudDone; c.cloudCheckedAt = Date.now(); }
      });
      return { ok: true };
    },

    'chats.db.upsert': ({ convId, messages, contacts, runId }) => db.upsertMessages(convId, messages, { runId, contacts }),
    'chats.db.finishRun': async args => { const { missing, conv } = await db.finishRun(args.convId, args); return { missing, count: conv.messageCount }; },

    // Ids the chat's messages name without a display name, minus those asked for lately.
    'chats.names.missing': async ({ convId }) => {
      const conv = (await db.getConv(convId)) || {};
      const tried = conv.namesTried || {};
      const uids = (await db.missingNames(convId, uidsOf)).filter(u => !(Date.now() - (tried[u] || 0) < NAME_RETRY_MS));
      return { uids };
    },

    // Attachments of the chosen kinds in the range that are not downloaded yet.
    'chats.media.pending': async ({ convId, kinds = [], from, to }) => {
      const recs = Object.fromEntries((await db.mediaForConv(convId)).map(r => [r.id, r]));
      const items = [];
      let already = 0;
      for (const m of await db.messagesInRange(convId, from, to)) {
        if (m.recalled) continue;
        for (const a of m.attachments || []) {
          if (!kinds.includes(a.kind)) continue;
          const r = recs[a.id];
          if (r && r.status === 'done') { already++; continue; }
          if (r && r.status === 'failed' && (r.attempts || 0) >= 3) continue;
          items.push({ messageId: m.id, attId: a.id, kind: a.kind });
        }
      }
      return { items, already };
    },
    'chats.media.download': async ({ convId, messageId, attId }, sender) => {
      await inflightReady;
      if ([...inflight.values()].some(e => e.convId === convId && e.attId === attId)) return { ok: true, status: 'started' };
      const m = await db.getMessage(convId, messageId);
      const att = m && (m.attachments || []).find(a => a.id === attId);
      if (!att) return { ok: false, status: 'failed', error: 'not in the archive' };
      const prev = (await db.getMedia(convId, [attId]))[attId];
      if (prev && prev.status === 'done') return { ok: true, status: 'done' };
      const attempts = ((prev && prev.attempts) || 0) + 1;
      const cands = candidates(att);
      if (!cands.length) {
        await db.putMedia({ convId, id: attId, messageId, ts: m.ts, kind: att.kind, status: 'failed', attempts, error: 'no download address' });
        return { ok: false, status: 'failed' };
      }
      const e = {
        token: crypto.randomUUID(), convId, attId, messageId, ts: m.ts,
        att: { kind: att.kind, filename: att.filename || null, index: att.index || 0 },
        cands, tried: 0, tabId: sender.tab ? sender.tab.id : null, createdAt: Date.now(),
      };
      inflight.set(e.token, e);
      saveInflight();
      savingStarted();
      await db.putMedia({ convId, id: attId, messageId, ts: m.ts, kind: att.kind, status: 'downloading', attempts });
      await startCandidate(e);
      return { ok: true, status: 'started' };
    },
    'chats.media.status': async ({ convId, ids }) => {
      await checkStalled();
      const recs = await db.getMedia(convId, ids);
      return Object.fromEntries(Object.entries(recs).map(([id, r]) => [id, r.status]));
    },

    'chats.export.conv': async ({ convId, options }) => {
      try { return await exportConv(convId, options); } catch (e) { return { ok: false, error: String(e.message || e) }; }
    },
  },
};
