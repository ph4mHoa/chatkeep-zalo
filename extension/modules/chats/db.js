// Chats module: the chat archive in IndexedDB (extension origin). Used by the service worker and
// the side panel. Messages and media are keyed by [convId, id], so ids only need to be unique
// within a conversation.
import { open, done, finished } from '../../core/idb.js';
import { mergeMessage, addInterval } from './merge.js';

export const openDB = () => open('zlx-chats', 1, db => {
  db.createObjectStore('convs', { keyPath: 'convId' });
  db.createObjectStore('messages', { keyPath: ['convId', 'id'] }).createIndex('conv_ts', ['convId', 'ts']);
  db.createObjectStore('media', { keyPath: ['convId', 'id'] }).createIndex('conv', 'convId');
  db.createObjectStore('files', { keyPath: 'path' });
});

const rangeFor = (convId, from = 0, to = Number.MAX_SAFE_INTEGER) => IDBKeyRange.bound([convId, from], [convId, to]);

export async function getConv(convId) {
  const db = await openDB();
  return done(db.transaction('convs').objectStore('convs').get(convId));
}
export async function allConvs() {
  const db = await openDB();
  return done(db.transaction('convs').objectStore('convs').getAll());
}
export async function updateConv(convId, fn) {
  const db = await openDB();
  const tx = db.transaction('convs', 'readwrite');
  const store = tx.objectStore('convs');
  const cur = (await done(store.get(convId))) || { convId, coverage: [], participants: {}, createdAt: Date.now() };
  const next = fn(cur) || cur;
  store.put(next);
  await finished(tx);
  return next;
}

export async function countMessages(convId) {
  const db = await openDB();
  return done(db.transaction('messages').objectStore('messages').index('conv_ts').count(rangeFor(convId)));
}
export async function getMessage(convId, id) {
  const db = await openDB();
  return done(db.transaction('messages').objectStore('messages').get([convId, id]));
}

// Upserts one batch of messages seen in the current run.
export async function upsertMessages(convId, messages, { runId, now = Date.now(), contacts = {} } = {}) {
  const db = await openDB();
  const tx = db.transaction(['messages', 'convs'], 'readwrite');
  const store = tx.objectStore('messages');
  const stats = { added: 0, updated: 0, same: 0 };
  for (const m of messages) {
    if (!m || !m.id || !m.ts) continue;
    const inc = { ...m, convId };
    const old = await done(store.get([convId, m.id]));
    const { record, change } = mergeMessage(old, inc, { runId, now });
    stats[change]++;
    if (change !== 'same' || old.lastSeenRun !== runId) store.put(record);
  }
  if (Object.keys(contacts).length) {
    const convs = tx.objectStore('convs');
    const c = (await done(convs.get(convId))) || { convId, coverage: [], participants: {}, createdAt: now };
    c.participants = { ...(c.participants || {}), ...contacts };
    convs.put(c);
  }
  await finished(tx);
  return stats;
}

// Closes a read run. `segments` are the [from, to] stretches read from top to bottom without a
// gap; each becomes covered, and archived messages inside one that were not seen this time are
// flagged `missingSince`. So are archived messages newer than `newestTs`, the newest message
// Zalo had when the run started. Flagged messages are kept; the flag clears if they show up again.
export async function finishRun(convId, { runId, segments = [], newestTs = null, bottomReached = false, now = Date.now() }) {
  const db = await openDB();
  let missing = 0;
  const read = segments.filter(([from, to]) => from <= to);
  const flag = newestTs ? [...read, [newestTs + 1, Number.MAX_SAFE_INTEGER]] : read;
  if (flag.length) {
    const tx = db.transaction('messages', 'readwrite');
    const idx = tx.objectStore('messages').index('conv_ts');
    for (const [from, to] of flag) {
      await new Promise((resolve, reject) => {
        const req = idx.openCursor(rangeFor(convId, from, to));
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve();
          const v = c.value;
          if (v.lastSeenRun !== runId && !v.missingSince) { v.missingSince = now; c.update(v); missing++; }
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    }
    await finished(tx);
  }
  const total = await countMessages(convId);
  const conv = await updateConv(convId, c => {
    for (const s of read) c.coverage = addInterval(c.coverage, s);
    if (bottomReached) c.bottomReachedAt = now;
    c.lastRunAt = now;
    c.messageCount = total;
    return c;
  });
  return { missing, conv };
}

export async function messagesInRange(convId, from, to) {
  const db = await openDB();
  return done(db.transaction('messages').objectStore('messages').index('conv_ts').getAll(rangeFor(convId, from || 0, to || Number.MAX_SAFE_INTEGER)));
}

// Account ids the conversation's messages name that have no display name yet.
export async function missingNames(convId, uidsOf) {
  const conv = (await getConv(convId)) || { participants: {} };
  const known = conv.participants || {};
  const out = new Set();
  for (const m of await messagesInRange(convId)) for (const u of uidsOf(m)) if (!known[u]) out.add(u);
  return [...out];
}

export async function getMedia(convId, ids) {
  const db = await openDB();
  const store = db.transaction('media').objectStore('media');
  const out = {};
  for (const id of ids) { const r = await done(store.get([convId, id])); if (r) out[id] = r; }
  return out;
}
export async function putMedia(rec) {
  const db = await openDB();
  const tx = db.transaction('media', 'readwrite');
  const store = tx.objectStore('media');
  const old = await done(store.get([rec.convId, rec.id]));
  store.put({ ...(old || {}), ...rec, updatedAt: Date.now() });
  return finished(tx);
}
export async function mediaForConv(convId) {
  const db = await openDB();
  return done(db.transaction('media').objectStore('media').index('conv').getAll(convId));
}

export async function getFile(path) {
  const db = await openDB();
  return done(db.transaction('files').objectStore('files').get(path));
}
export async function putFile(rec) {
  const db = await openDB();
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').put(rec);
  return finished(tx);
}
