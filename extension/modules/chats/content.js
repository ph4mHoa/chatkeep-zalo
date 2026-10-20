// Chats module, content script (isolated world). Runs export jobs in this tab: reads each
// selected conversation through bridge.js (Zalo's own data layer: no scrolling, no clicking, no
// "seen"), hands the messages to the service worker's archive, looks up missing names, drives the
// media downloads and asks for the files. Job state lives in chrome.storage.local, so a reload or
// a closed side panel does not lose progress: the job resumes where it stopped.
(() => {
  'use strict';
  const CHANNEL = '__zlx_chats__';
  const PAGE = 200;            // messages per read
  const OVERLAP = 50;          // archived messages read again where earlier runs' coverage starts
  const CLOUD_PAGES = 500;     // safety cap on requests for older messages from Zalo's server
  const MEDIA_PARALLEL = 3;    // downloads at a time
  const MEDIA_KINDS = { text: [], photos: ['photo', 'gif'], all: ['photo', 'gif', 'video', 'voice', 'file'] };
  const PHASES = ['read', 'names', 'media', 'files'];
  const JOB = 'chats.job';
  const { normalizeMessage } = globalThis.ZLXNormalize;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  class Stopped extends Error {}
  class Fatal extends Error {}   // ends the job: nothing else would work either
  const counts = m => (m ? { total: m.total, done: m.done, failed: m.failed, already: m.already } : null);

  // ---------- bridge.js channel ----------
  const pending = new Map();
  window.addEventListener('message', ev => {
    const d = ev.data;
    if (ev.source !== window || !d || d[CHANNEL] !== 'res') return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error));
  });
  function bridge(cmd, args = {}, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`bridge.${cmd} timed out`)); }, timeoutMs);
      pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      window.postMessage({ [CHANNEL]: 'req', id, cmd, args }, location.origin);
    });
  }
  async function bridgeReady() {
    let last = null;
    for (let i = 0; i < 30; i++) {
      try { last = await bridge('ping', {}, 2000); if (last.ready) break; } catch { /* page script not there yet */ }
      await sleep(1000);
    }
    if (!last || !last.ready) {
      throw new Fatal(last && last.webpack ? `Zalo's data layer was not found (${last.missing.join(', ')}). Zalo may have changed; the extension needs an update.` : 'Zalo Web did not finish loading in this tab.');
    }
    if (!last.active) throw new Fatal('Zalo is active in another tab. Close the other Zalo tab, or press "Kích hoạt" in this one, then Resume.');
    return last;
  }
  const sw = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });

  // ---------- job state ----------
  const loadJob = async () => (await chrome.storage.local.get(JOB))[JOB] || null;
  async function patchJob(fn) {
    const job = await loadJob();
    if (!job) return null;
    fn(job);
    job.updatedAt = Date.now();
    await chrome.storage.local.set({ [JOB]: job });
    return job;
  }
  let lastPush = 0;
  async function report(progress, { force = false, line } = {}) {
    const now = Date.now();
    if (line) console.info('[chatkeep-zalo]', line);
    if (!force && !line && now - lastPush < 700) return;
    lastPush = now;
    const job = await patchJob(j => {
      j.progress = { ...j.progress, ...progress };
      if (line) j.log = [...(j.log || []).slice(-80), { t: now, line }];
    });
    chrome.runtime.sendMessage({ type: 'chats.job.progress', job }).catch(() => {});
  }
  // The panel's Stop also arrives as a message: its write to the job record can be overwritten
  // by a progress update that read the record just before.
  let stopRequested = false;
  async function checkStop() {
    if (stopRequested) throw new Stopped();
    const job = await loadJob();
    if (!job || job.status !== 'running') throw new Stopped();
  }

  // ---------- phase 1: read the messages ----------
  // Pages go from the newest message down. Inside a stretch an earlier run covered, the read
  // skips to the stretch's lower end after OVERLAP messages, then reads on below it (older
  // history that appeared since, e.g. synced from the phone) until Zalo has nothing older.
  const intervalAt = (coverage, ts) => coverage.find(iv => iv[0] <= ts && ts <= iv[1]) || null;
  // Zalo's own order: [sendDttm, msgId], both digit strings.
  const before = (a, b) => String(a.ts) < String(b.ts) || (String(a.ts) === String(b.ts) && String(a.msgId) < String(b.msgId));

  async function readConv(job, c) {
    const opts = job.options;
    const ready = await bridgeReady();
    const st = await sw('chats.conv.state', { convId: c.id, name: c.name, isGroup: c.isGroup, members: c.members, me: ready.me });
    const meId = ready.me && ready.me.id;
    const coverage = opts.recheck ? [] : st.coverage || [];
    const bounds = await bridge('bounds', { convId: c.id });
    const top = bounds.newest ? bounds.newest.ts : null;
    const floor = Math.max(opts.from || 0, bounds.oldest ? bounds.oldest.ts : 0);
    const pctAt = ts => (top && top > floor ? Math.min(99, Math.max(0, Math.round((100 * (top - ts)) / (top - floor)))) : null);
    const runId = `${job.id}:${c.id}:${Date.now()}`;
    const segments = [];
    let seg = null;            // the stretch being read: { min, max }
    let cursor = null;         // read below this { ts, msgId } (exclusive); null = from the newest
    let seen = 0, added = 0, overlap = 0, bottomReached = false, stoppedAtFrom = false, fromCloud = 0, newestTs = null;
    const closeSeg = () => { if (seg && seg.min <= seg.max) segments.push([seg.min, seg.max]); seg = null; };
    const store = async (list, names) => {
      const recs = list.map(m => normalizeMessage(m, c.id, meId)).filter(Boolean);
      if (!recs.length) return recs;
      const s = await sw('chats.db.upsert', { convId: c.id, messages: recs, contacts: names || {}, runId });
      added += s.added;
      seen += recs.length;
      if (!seg) seg = { min: Infinity, max: -Infinity };
      for (const m of recs) { seg.min = Math.min(seg.min, m.ts); seg.max = Math.max(seg.max, m.ts); }
      return recs;
    };

    await report({ phase: 'read', conv: c.name, convIndex: job.index, messagesRead: 0, messagesNew: 0, oldestTs: null, pct: 0, media: null },
      { force: true, line: `Reading "${c.name}"${coverage.length ? ' (new messages only)' : ''}` });
    let completed = false;
    try {
      for (;;) {
        await checkStop();
        const r = await bridge('readPage', { convId: c.id, beforeTs: cursor && cursor.ts, beforeMsgId: cursor && cursor.msgId, count: PAGE });
        if (!r.messages.length) { bottomReached = true; break; }
        const recs = await store(r.messages, r.names);
        if (!cursor) newestTs = Number(r.messages[r.messages.length - 1].sendDttm);
        const oldest = r.messages[0];
        const oldestTs = Number(oldest.sendDttm);
        const next = { ts: oldest.sendDttm, msgId: oldest.msgId };
        if (cursor && !before(next, cursor)) throw new Error('Zalo returned messages that are not older than the last page; reading stopped');
        cursor = next;
        await report({ messagesRead: seen, messagesNew: added, oldestTs, pct: pctAt(oldestTs) });
        if (opts.from && oldestTs < opts.from) { stoppedAtFrom = true; break; }
        const iv = intervalAt(coverage, oldestTs);
        if (!iv) { overlap = 0; continue; }
        overlap += recs.filter(m => m.ts >= iv[0] && m.ts <= iv[1]).length;
        if (overlap < OVERLAP || iv[0] >= oldestTs) continue;
        // Enough overlap: skip what earlier runs have, go on below it.
        closeSeg();
        if (opts.from && iv[0] <= opts.from) { stoppedAtFrom = true; break; }
        seg = { min: iv[0], max: iv[0] };
        cursor = { ts: String(iv[0] + 1), msgId: '' };   // everything at iv[0] and older
        overlap = 0;
      }

      // Older messages from Zalo's server, once per chat (continued if an earlier run stopped).
      const oldestId = st.cloudCursor || (bounds.oldest && bounds.oldest.msgId);
      if (bottomReached && !stoppedAtFrom && !st.cloudDone && oldestId) {
        closeSeg();
        await report({ phase: 'cloud' }, { force: true, line: `Asking Zalo's server for older messages of "${c.name}"` });
        let cur = oldestId, more = true;
        for (let i = 0; i < CLOUD_PAGES && more; i++) {
          await checkStop();
          const r = await bridge('readCloud', { convId: c.id, beforeMsgId: cur }, 90000);
          const recs = await store(r.messages, r.names);
          if (!recs.length || String(r.messages[0].msgId) === String(cur)) { more = false; break; }
          fromCloud += recs.length;
          cur = r.messages[0].msgId;
          more = r.hasMore;
          await sw('chats.conv.update', { convId: c.id, cloudCursor: cur });
          await report({ messagesRead: seen, messagesNew: added, oldestTs: Number(r.messages[0].sendDttm) });
          if (more) await sleep(1000);
        }
        await sw('chats.conv.update', { convId: c.id, cloudDone: !more });
      }
      completed = true;
    } finally {
      closeSeg();
      const fin = await sw('chats.db.finishRun', { convId: c.id, runId, segments, newestTs, bottomReached: completed && bottomReached });
      await report({ messagesRead: seen, messagesNew: added, ...(completed ? { pct: 100 } : {}) }, {
        force: true,
        line: `"${c.name}": ${seen} messages read, ${added} new` + (fromCloud ? `, ${fromCloud} from Zalo's server` : '') +
          (completed && bottomReached ? ', reached the oldest message on this device' : '') +
          (fin.missing ? `, ${fin.missing} archived messages no longer in Zalo (kept)` : '') + ` · ${fin.count} archived`,
      });
    }
    return { seen, added, bottomReached, fromCloud };
  }

  // ---------- phase 2: names ----------
  async function namesConv(job, c) {
    const { uids } = await sw('chats.names.missing', { convId: c.id });
    if (!uids.length) return { asked: 0, found: 0 };
    await report({ phase: 'names' }, { force: true, line: `Looking up ${uids.length} names in "${c.name}"` });
    const r = await bridge('resolveNames', { uids }, 300000);
    const found = Object.keys(r.names).length;
    await sw('chats.conv.update', { convId: c.id, participants: r.names, tried: uids.filter(u => !r.names[u]) });
    await report({}, { force: true, line: `"${c.name}": ${found} of ${uids.length} names found` });
    return { asked: uids.length, found };
  }

  // ---------- phase 3: media ----------
  // The service worker downloads each file and reports back; this loop keeps a few going.
  let mediaEvents = 0, mediaWake = null;
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || msg.type !== 'chats.media.status') return;
    mediaEvents++;
    if (mediaWake) mediaWake();
  });
  // Resolves once a download has finished since `mark` (or after `ms` as a fallback).
  const waitMedia = (mark, ms) => (mediaEvents !== mark ? Promise.resolve() : new Promise(resolve => {
    const t = setTimeout(wake, ms);
    function wake() { clearTimeout(t); mediaWake = null; resolve(); }
    mediaWake = wake;
  }));

  async function mediaConv(job, c) {
    const kinds = MEDIA_KINDS[job.options.mode] || [];
    if (!kinds.length) return null;
    const { items, already } = await sw('chats.media.pending', { convId: c.id, kinds, from: job.options.from, to: job.options.to });
    const media = { total: items.length, done: 0, failed: 0, already };
    await report({ phase: 'media', media: counts(media) }, {
      force: true,
      line: items.length ? `"${c.name}": downloading ${items.length} files${already ? ` (${already} saved earlier)` : ''}` : `"${c.name}": no files to download${already ? ` (${already} saved earlier)` : ''}`,
    });
    const queue = [...items];
    const active = new Set();
    while (queue.length || active.size) {
      await checkStop();
      while (active.size < MEDIA_PARALLEL && queue.length) {
        const it = queue.shift();
        const r = await sw('chats.media.download', { convId: c.id, messageId: it.messageId, attId: it.attId });
        if (r && r.status === 'started') active.add(it.attId);
        else if (r && r.status === 'done') media.done++;
        else media.failed++;
      }
      await report({ media: counts(media) });
      if (!active.size) continue;
      const mark = mediaEvents;
      const status = await sw('chats.media.status', { convId: c.id, ids: [...active] });
      const before = active.size;
      for (const id of [...active]) {
        if (status[id] === 'done') { media.done++; active.delete(id); }
        else if (status[id] === 'failed') { media.failed++; active.delete(id); }
      }
      if (active.size === before) await waitMedia(mark, 3000);
    }
    if (items.length) await report({ media: counts(media) }, { force: true, line: `"${c.name}": ${media.done} of ${media.total} files saved${media.failed ? `, ${media.failed} failed` : ''}` });
    return counts(media);
  }

  // ---------- phase 4: files ----------
  async function filesConv(job, c) {
    await report({ phase: 'files' }, { force: true, line: `Writing files for "${c.name}"` });
    const out = await sw('chats.export.conv', { convId: c.id, options: job.options });
    await report({}, { force: true, line: out.ok ? `"${c.name}": ${out.written} files written, ${out.skipped} unchanged` : `Export failed: ${out.error}` });
    return out;
  }

  // ---------- job loop ----------
  const RUN = { read: readConv, names: namesConv, media: mediaConv, files: filesConv };
  let running = false;
  async function runJob() {
    if (running) return;
    running = true;
    stopRequested = false;
    try {
      let job = await loadJob();
      while (job && job.status === 'running' && !stopRequested && job.index < job.convs.length) {
        const c = job.convs[job.index];
        let fatal = null;
        try {
          for (let step = job.step || 0; step < PHASES.length; step++) {
            await checkStop();
            const result = await RUN[PHASES[step]](job, c);
            job = await patchJob(j => { j.step = step + 1; j.results = { ...(j.results || {}), [c.id]: { ...((j.results || {})[c.id] || {}), [PHASES[step]]: result } }; });
          }
        } catch (e) {
          if (e instanceof Stopped) break;
          await report({}, { force: true, line: `${e instanceof Fatal ? 'Stopped' : `Error in "${c.name}"`}: ${e.message || e}` });
          if (e instanceof Fatal) fatal = e;
          else await patchJob(j => { j.errors = [...(j.errors || []), { convId: c.id, error: String(e.message || e) }]; });
        }
        if (fatal) { await patchJob(j => { j.status = 'stopping'; j.error = fatal.message; }); break; }
        job = await patchJob(j => { if (j.status === 'running') { j.index++; j.step = 0; } });
      }
      job = await patchJob(j => {
        if (j.status === 'stopping' || (j.status === 'running' && stopRequested)) j.status = 'stopped';
        else if (j.status === 'running') j.status = 'done';
        j.progress = { ...j.progress, phase: j.status };
      });
      chrome.runtime.sendMessage({ type: 'chats.job.progress', job }).catch(() => {});
    } finally {
      running = false;
    }
  }

  // Commands from the side panel. Other modules' content scripts may share this tab, so only
  // this module's own message types are answered.
  const COMMANDS = {
    'chats.ping': async () => {
      try { return { ...(await bridge('ping', {}, 2500)), ok: true, running }; } catch { return { ok: true, ready: false, running }; }
    },
    'chats.listConvs': async msg => {
      await bridgeReady();
      return bridge('listConversations', { deep: !!msg.deep }, 120000);
    },
    'chats.runJob': () => { runJob(); return { ok: true }; },
    'chats.stop': () => { stopRequested = true; return { ok: true }; },
  };
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const command = msg && COMMANDS[msg.type];
    if (!command) return;
    Promise.resolve().then(() => command(msg)).then(sendResponse, e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  });

  // Resume a running job after a reload of this tab.
  (async () => {
    const job = await loadJob();
    if (!job || (job.status !== 'running' && job.status !== 'stopping')) return;
    const me = await sw('core.tabId');
    if (!me || me.tabId !== job.tabId) return;
    if (job.status === 'running') { runJob(); return; }
    const stopped = await patchJob(j => { j.status = 'stopped'; j.progress = { ...j.progress, phase: 'stopped' }; });
    chrome.runtime.sendMessage({ type: 'chats.job.progress', job: stopped }).catch(() => {});
  })();
})();
