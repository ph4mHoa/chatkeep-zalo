// Chats module, page script (runs in the page's own JavaScript world on chat.zalo.me). Reads Zalo
// Web's data through Zalo's own data layer — the functions Zalo Web itself uses to list
// conversations and load messages from its local database and its cloud — and answers the content
// script's requests on a window.postMessage channel. It only reads; it never changes the page, opens
// a chat or marks anything as seen.
//
// How the data layer is reached: Zalo Web is a webpack 4 bundle (window.webpackJsonp). Pushing a
// chunk with one module of our own hands us webpack's require, whose module cache holds Zalo's
// modules. They are recognised by the names of their methods: module ids change with every Zalo
// build, method names rarely do. See docs/ZALO.md.
//
// Safety: finding the modules touches only property descriptors, runs no getter other than
// webpack's own one-line export getters (plus the one ConvInfoDataManager getter, which Zalo calls
// all the time), and stops after a time budget. Reading every property of every module once ran
// arbitrary getters and exhausted the tab's memory.
(() => {
  'use strict';
  const CHANNEL = '__zlx_chats__';
  const VERSION = 1;
  const MAX_TS = '9999999999999999';
  const MAX_ID = '99999999999999999999';
  const FIND_BUDGET_MS = 1500;
  const PROFILE_BATCH = 50;

  // After an extension update the old copy of this script is still in the page: the newest copy
  // takes over the channel and the older one stops answering.
  const self = { version: VERSION };
  window.__zlxChatsBridge = self;
  const current = () => window.__zlxChatsBridge === self;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function withTimeout(promise, ms, what) {
    let t;
    return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out`)), ms); })]).finally(() => clearTimeout(t));
  }

  // ---------- finding Zalo's modules ----------
  let req = null;
  let parts = null; // { messages, loader, profiles, names, convs, groups }
  function getRequire() {
    if (req) return req;
    const chunk = window.webpackJsonp;
    if (!chunk || typeof chunk.push !== 'function') return null;
    const id = `zlx_${Date.now().toString(36)}`;
    let r = null;
    try { chunk.push([[id], { [id]: (module, exports, require) => { r = require; } }, [[id]]]); } catch { return null; }
    if (r && r.c) req = r;
    return req;
  }
  // obj (or its prototype chain) defines `name` as a plain function value — checked without
  // running anything.
  function hasFn(obj, name) {
    for (let p = obj, i = 0; p && p !== Object.prototype && p !== Function.prototype && i < 6; p = Object.getPrototypeOf(p), i++) {
      const d = Object.getOwnPropertyDescriptor(p, name);
      if (d) return typeof d.value === 'function';
    }
    return false;
  }
  // An export binding; webpack defines them as one-line getters, anything else is not run.
  function readExport(ex, key) {
    const d = Object.getOwnPropertyDescriptor(ex, key);
    if (!d) return undefined;
    if ('value' in d) return d.value;
    if (d.get && d.get.toString().length < 80) { try { return d.get.call(ex); } catch { return undefined; } }
    return undefined;
  }
  const WANT = {
    // getLastMessageFrom(convId, msgId, sendDttm, count, include) -> decrypted local messages
    messages: o => hasFn(o, 'getLastMessageFrom') && hasFn(o, 'getOldestValidMessage'),
    // loadOldMessagesFromCloudForConversation(convId, { msgId }, { src }) -> { messages, hasMore }
    loader: o => hasFn(o, 'loadOldMessagesFromCloudForConversation') && hasFn(o, 'getLastMessagesForConversation'),
    // profile manager: getUidMe, getMiniInfo(uid).dName, getProfileFriendByIds(uids)
    profiles: o => hasFn(o, 'getProfileFriendByIds') && hasFn(o, 'getUidMe') && hasFn(o, 'getMiniInfo'),
    // getDName(uid): alias, phonebook name, cached profile name
    names: o => hasFn(o, 'getDName') && hasFn(o, 'getAliasName') && hasFn(o, 'getProfileByIdFromCache'),
    groups: o => hasFn(o, 'getGroupByIdSync') && hasFn(o, 'getDName'),
  };
  function find() {
    // A failed search is repeated at most every few seconds while Zalo is still loading.
    if (parts && (parts.ready || performance.now() - parts.at < 5000)) return parts;
    const r = getRequire();
    const got = { groups: window.groupManager && WANT.groups(window.groupManager) ? window.groupManager : null };
    if (r) {
      const t0 = performance.now();
      for (const mid of Object.keys(r.c)) {
        if (performance.now() - t0 > FIND_BUDGET_MS) break;
        const ex = r.c[mid] && r.c[mid].exports;
        if (!ex || (typeof ex !== 'object' && typeof ex !== 'function')) continue;
        const cands = [ex];
        for (const k of Object.keys(ex).slice(0, 40)) cands.push(readExport(ex, k));
        for (const v of cands) {
          if (!v || (typeof v !== 'object' && typeof v !== 'function')) continue;
          for (const [name, test] of Object.entries(WANT)) if (!got[name] && test(v)) got[name] = v;
          if (!got.convs) {
            const d = Object.getOwnPropertyDescriptor(v, 'ConvInfoDataManager');
            if (d) { try { got.convs = 'value' in d ? d.value : d.get.call(v); } catch { /* not ready */ } }
          }
        }
        if (Object.keys(WANT).every(n => got[n]) && got.convs) break;
      }
    }
    const missing = ['messages', 'loader', 'profiles', 'convs'].filter(n => !got[n]);
    if (got.convs && !hasFn(got.convs, 'getAllConvSync')) missing.push('convs.getAllConvSync');
    parts = { ...got, ready: !missing.length, missing, webpack: !!r, at: performance.now() };
    return parts;
  }
  function need() {
    const p = find();
    if (!p.ready) throw new Error(p.webpack ? `Zalo's data layer was not found (${p.missing.join(', ')}). Zalo may have changed; the extension needs an update.` : 'Zalo Web has not finished loading.');
    return p;
  }

  // ---------- helpers ----------
  const plain = v => JSON.parse(JSON.stringify(v));
  const byTime = (a, b) => (+a.sendDttm - +b.sendDttm) || (String(a.msgId) < String(b.msgId) ? -1 : String(a.msgId) > String(b.msgId) ? 1 : 0);
  function me() {
    const p = need();
    const id = String(p.profiles.getUidMe() || '');
    return { id, name: nameOf(id) || '' };
  }
  function nameOf(uid) {
    if (!uid) return '';
    const p = parts;
    for (const f of [p.names, p.profiles]) {
      if (!f) continue;
      try { const n = f.getDName(uid); if (n) return String(n); } catch { /* not known */ }
    }
    return '';
  }
  const groupName = gid => { try { return (parts.groups && parts.groups.getDName(gid)) || ''; } catch { return ''; } };
  // Everyone a page of messages names: senders, quoted authors, mentioned people.
  function namesFor(messages) {
    const out = {};
    const add = u => { u = u == null ? '' : String(u); if (u && !(u in out)) { const n = nameOf(u); if (n) out[u] = n; } };
    for (const m of messages) {
      add(m.fromUid);
      if (m.quote && m.quote.ownerId) add(m.quote.ownerId);
      for (const x of m.mentions || []) add(x.uid);
    }
    return out;
  }
  // Zalo keeps the ids of hidden (PIN-locked) chats in localStorage. They are never listed.
  function hiddenIds() {
    const out = new Set();
    for (const k of Object.keys(localStorage)) {
      if (!/_data_ids_hidden_chat$/.test(k)) continue;
      try { for (const id of JSON.parse(localStorage.getItem(k)) || []) out.add(String(id)); } catch { /* not a list */ }
    }
    return out;
  }
  // Zalo Web runs in one tab at a time; another tab disables this one ("Kích hoạt" to take over).
  function activeTab() {
    try {
      const mine = sessionStorage.getItem('backup-tab-key');
      const owner = localStorage.getItem('sh_singleton_web_app');
      return !mine || !owner || mine === owner;
    } catch { return true; }
  }

  // ---------- commands ----------
  const COMMANDS = {
    ping() {
      const p = find();
      return { ok: true, version: VERSION, ready: p.ready, missing: p.missing, webpack: p.webpack, active: activeTab(), me: p.ready ? me() : null };
    },

    // Every conversation Zalo has, except hidden ones. deep adds where this device's history starts.
    async listConversations({ deep = false } = {}) {
      const p = need();
      const hidden = hiddenIds();
      const out = [];
      for (const c of Array.from(p.convs.getAllConvSync() || [])) {
        const id = c && c.userId != null ? String(c.userId) : '';
        if (!id || hidden.has(id)) continue;
        const isGroup = id.startsWith('g') || !!c.isGroup;
        const row = { id, isGroup, name: isGroup ? groupName(id) : nameOf(id) };
        if (isGroup) { try { const g = p.groups && p.groups.getGroupByIdSync(id); if (g && g.totalMember) row.members = g.totalMember; } catch { /* unknown */ } }
        try {
          const [last] = await p.messages.getLastMessageFrom(id, MAX_ID, MAX_TS, 1, false);
          if (last) row.lastTs = +last.sendDttm;
          if (deep) { const first = await p.messages.getOldestValidMessage(id); if (first) row.firstTs = +first.sendDttm; }
        } catch { /* no messages on this device */ }
        out.push(row);
      }
      out.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
      return { ok: true, me: me(), conversations: out };
    },

    // Newest and oldest message of a conversation on this device.
    async bounds({ convId }) {
      const p = need();
      const [last] = await p.messages.getLastMessageFrom(convId, MAX_ID, MAX_TS, 1, false);
      const first = await p.messages.getOldestValidMessage(convId);
      const pick = m => (m ? { ts: +m.sendDttm, msgId: String(m.msgId) } : null);
      return { ok: true, newest: pick(last), oldest: pick(first) };
    },

    // One page of local messages older than (beforeTs, beforeMsgId), oldest first.
    async readPage({ convId, beforeTs, beforeMsgId, count = 200 }) {
      const p = need();
      const list = await p.messages.getLastMessageFrom(convId, beforeMsgId != null ? String(beforeMsgId) : MAX_ID, beforeTs != null ? String(beforeTs) : MAX_TS, count, false);
      const messages = plain(list || []).sort(byTime);
      return { ok: true, messages, names: namesFor(messages) };
    },

    // Older messages from Zalo's cloud, the way Zalo's media gallery asks for them. `src` gives
    // this extension a message loader of its own, apart from the one the open chat uses.
    async readCloud({ convId, beforeMsgId }) {
      const p = need();
      const res = await withTimeout(p.loader.loadOldMessagesFromCloudForConversation(convId, { msgId: beforeMsgId != null ? String(beforeMsgId) : MAX_ID }, { src: 'zlx' }), 60000, 'cloud history');
      const messages = plain((res && res.messages) || []).filter(m => m && m.msgId && m.sendDttm).sort(byTime);
      return { ok: true, messages, hasMore: !!(res && res.hasMore), names: namesFor(messages) };
    },

    // Display names. Zalo's caches first; the rest from Zalo's profile service in small batches
    // (what Zalo does for a group's member list). Only names leave this function.
    async resolveNames({ uids = [] }) {
      const p = need();
      const names = {};
      const unknown = [];
      for (const u of new Set(uids.map(String))) {
        if (!u || u === '0') continue;
        const n = nameOf(u);
        if (n) names[u] = n; else unknown.push(u);
      }
      for (let i = 0; i < unknown.length; i += PROFILE_BATCH) {
        const batch = unknown.slice(i, i + PROFILE_BATCH);
        let res = {};
        try { res = (await withTimeout(p.profiles.getProfileFriendByIds(batch), 30000, 'profile lookup')) || {}; } catch { /* keep going */ }
        for (const u of batch) {
          const prof = res[u];
          const n = nameOf(u) || (prof && (prof.displayName || prof.zaloName)) || '';
          if (n) names[u] = String(n);
        }
        if (i + PROFILE_BATCH < unknown.length) await sleep(800);
      }
      return { ok: true, names, asked: unknown.length };
    },
  };

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (ev.source !== window || !d || d[CHANNEL] !== 'req' || !current()) return;
    const cmd = COMMANDS[d.cmd];
    Promise.resolve()
      .then(() => { if (!cmd) throw new Error(`unknown command ${d.cmd}`); return cmd(d.args || {}); })
      .then(result => ({ ok: true, result }), e => ({ ok: false, error: String((e && e.message) || e) }))
      .then(reply => window.postMessage({ [CHANNEL]: 'res', id: d.id, ...reply }, location.origin));
  });
})();
