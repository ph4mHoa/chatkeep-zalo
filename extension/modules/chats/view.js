// Chats module, side panel view: pick chats and options, start/stop/resume jobs, show progress.
import * as db from './db.js';

let root = null; // this view's container in the panel
const $ = id => root.querySelector(`#${id}`);
const ZALO_URL = 'https://chat.zalo.me/';
const K = { options: 'chats.options', selection: 'chats.selection', list: 'chats.convList', job: 'chats.job' };
const state = { tab: null, convs: [], archive: {}, selected: new Set(), job: null, csRunning: false, scannedAt: null, me: null };

const store = {
  get: async keys => chrome.storage.local.get(keys),
  set: async obj => chrome.storage.local.set(obj),
};

// ---------- tab + content script ----------
const isZalo = url => /^https:\/\/chat\.zalo\.me\//.test(url || '');

async function ping(tabId) {
  try { return await chrome.tabs.sendMessage(tabId, { type: 'chats.ping' }); } catch { return null; }
}
// Zalo Web works in one tab at a time: prefer the tab Zalo is active in.
async function findTab() {
  const tabs = await chrome.tabs.query({ url: 'https://chat.zalo.me/*' });
  if (tabs.length < 2) return tabs[0] || null;
  for (const t of tabs) { const r = await ping(t.id); if (r && r.ready && r.active) return t; }
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find(t => current && t.id === current.id) || tabs[0];
}
// Tabs opened before the extension was installed have no content script yet.
async function ensureContent(tab) {
  let r = await ping(tab.id);
  if (r) return r;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['modules/chats/normalize.js', 'modules/chats/content.js'] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['modules/chats/bridge.js'], world: 'MAIN' });
  for (let i = 0; i < 20 && !r; i++) { await new Promise(res => setTimeout(res, 500)); r = await ping(tab.id); }
  return r;
}
function waitForLoad(tabId) {
  return new Promise(resolve => {
    const onUpdate = (id, info) => { if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(onUpdate); resolve(); } };
    chrome.tabs.onUpdated.addListener(onUpdate);
  });
}
// The existing Zalo tab is used as it is (not focused, not reloaded); a new one only if none.
async function gotoZalo() {
  const tab = await findTab();
  if (tab) return tab;
  const created = await chrome.tabs.create({ url: ZALO_URL });
  await waitForLoad(created.id);
  return chrome.tabs.get(created.id);
}
async function readyTab() {
  const tab = await gotoZalo();
  state.tab = tab;
  const r = await ensureContent(tab);
  if (!r) throw new Error('Zalo did not load in its tab. Reload the Zalo tab and try again.');
  return { tab, r };
}

async function refreshConnection() {
  const tab = await findTab();
  state.tab = tab;
  const conn = $('conn');
  conn.className = 'conn';
  $('openZalo').classList.toggle('hidden', !!tab);
  if (!tab) { conn.classList.add('bad'); $('connText').textContent = 'No Zalo tab. Open Zalo and log in.'; return; }
  const r = await ensureContent(tab).catch(() => null);
  state.csRunning = !!(r && r.running);
  let text;
  if (!r || !r.ready) text = r && r.webpack && r.missing && r.missing.length ? `Zalo has changed: parts not found (${r.missing.join(', ')}). The extension needs an update.` : 'Zalo is loading… (log in, or reload the tab if this stays)';
  else if (!r.active) text = 'Zalo is active in another tab. Use that tab, or press "Kích hoạt" in this one.';
  const ok = r && r.ready && r.active;
  conn.classList.add(ok ? 'ok' : 'bad');
  if (ok) state.me = r.me;
  $('connText').textContent = ok ? `Zalo · ${r.me && r.me.name ? r.me.name : 'logged in'}` : text;
  renderJob();
}

// ---------- chat list ----------
async function loadArchive() {
  state.archive = Object.fromEntries((await db.allConvs()).map(c => [c.convId, c]));
}
const ago = ts => {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  if (d < 86400 * 60) return `${Math.round(d / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
};
const fmtDate = ts => (ts ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
function shownConvs() {
  const q = $('filter').value.trim().toLowerCase();
  const show = (root.querySelector('input[name=show]:checked') || {}).value || 'all';
  return state.convs.filter(c => (!q || (c.name || '').toLowerCase().includes(q)) && (show === 'all' || (show === 'groups') === !!c.isGroup));
}
function renderConvs() {
  const list = $('convs');
  list.textContent = '';
  const shown = shownConvs();
  for (const c of shown) {
    const a = state.archive[c.id];
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(c.id);
    cb.addEventListener('change', () => { if (cb.checked) state.selected.add(c.id); else state.selected.delete(c.id); saveSelection(); });
    li.addEventListener('click', e => { if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } });
    const main = document.createElement('div');
    main.className = 't-main';
    const title = document.createElement('div');
    title.className = 't-title';
    title.textContent = c.name || c.id;
    const sub = document.createElement('div');
    sub.className = 't-sub';
    if (c.isGroup) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = c.members ? `group · ${c.members}` : 'group';
      sub.append(badge);
    }
    const bits = [ago(c.lastTs)];
    if (c.firstTs) bits.push(`on this device since ${fmtDate(c.firstTs)}`);
    if (a && a.messageCount) bits.push(`${a.messageCount.toLocaleString()} archived`);
    sub.append(bits.filter(Boolean).join(' · '));
    main.append(title, sub);
    li.append(cb, main);
    list.append(li);
  }
  const sel = state.convs.filter(c => state.selected.has(c.id)).length;
  $('listInfo').textContent = state.convs.length
    ? `${state.convs.length} chats${shown.length !== state.convs.length ? ` · ${shown.length} shown` : ''} · ${sel} selected${state.scannedAt ? ` · list read ${ago(state.scannedAt)}` : ''}`
    : 'No chat list yet. Press Scan.';
  $('selectAll').checked = shown.length > 0 && shown.every(c => state.selected.has(c.id));
}
const saveSelection = () => { store.set({ [K.selection]: [...state.selected] }); renderConvs(); };

// Scan reads the list with where each chat's history on this device starts; Refresh reads it
// again quickly. Both keep the selection.
async function scan(deep) {
  const btns = [$('scan'), $('refresh')];
  btns.forEach(b => (b.disabled = true));
  $('listInfo').textContent = deep ? 'Reading the chat list…' : 'Refreshing…';
  try {
    const { tab } = await readyTab();
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'chats.listConvs', deep });
    if (!r || !r.ok) throw new Error((r && r.error) || 'no answer from the Zalo tab');
    const old = new Map(state.convs.map(c => [c.id, c]));
    state.convs = r.conversations.map(c => ({ ...(old.get(c.id) || {}), ...c }));
    state.me = r.me;
    state.scannedAt = Date.now();
    await store.set({ [K.list]: { convs: state.convs, scannedAt: state.scannedAt, me: state.me } });
    await loadArchive();
    renderConvs();
    refreshConnection();
  } catch (e) {
    $('listInfo').innerHTML = `<span class="err">${escapeHtml(e.message || String(e))}</span>`;
  } finally {
    btns.forEach(b => (b.disabled = false));
  }
}
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- options ----------
const MODE_HINT = {
  text: 'Message text with sender and time. Photos and files appear by name.',
  photos: 'Also downloads photos and GIFs.',
  all: 'Also downloads videos, voice messages and files. Large chats can take a while.',
};
function readOptions() {
  const val = name => (root.querySelector(`input[name=${name}]:checked`) || {}).value;
  const range = val('range');
  const day = (s, end) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return end ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime(); };
  return {
    mode: val('mode'),
    split: val('split'),
    formats: [...root.querySelectorAll('input[name=format]:checked')].map(i => i.value),
    rewrite: $('rewrite').checked,
    recheck: $('recheck').checked,
    from: range === 'custom' ? day($('from').value, false) : null,
    to: range === 'custom' ? day($('to').value, true) : null,
    rangeInputs: { range, from: $('from').value, to: $('to').value },
  };
}
function applyOptions(o) {
  if (!o) return;
  const set = (name, v) => { const el = root.querySelector(`input[name=${name}][value="${v}"]`); if (el) el.checked = true; };
  set('mode', o.mode); set('split', o.split);
  if (o.rangeInputs) { set('range', o.rangeInputs.range); $('from').value = o.rangeInputs.from || ''; $('to').value = o.rangeInputs.to || ''; }
  root.querySelectorAll('input[name=format]').forEach(i => (i.checked = (o.formats || []).includes(i.value)));
  $('rewrite').checked = !!o.rewrite;
  $('recheck').checked = !!o.recheck;
}
function onOptionsChange() {
  const o = readOptions();
  $('rangeInputs').classList.toggle('hidden', o.rangeInputs.range !== 'custom');
  $('modeHint').textContent = MODE_HINT[o.mode];
  store.set({ [K.options]: o });
}

// ---------- jobs ----------
function validate(o) {
  if (!o.formats.length) return 'Pick at least one format.';
  if (o.rangeInputs.range === 'custom' && !o.from && !o.to) return 'Pick a start or end date.';
  if (o.from && o.to && o.from > o.to) return 'The start date is after the end date.';
  if (!state.convs.some(c => state.selected.has(c.id))) return 'Select at least one chat.';
  return null;
}
async function startJob() {
  const o = readOptions();
  const problem = validate(o);
  if (problem) return showError(problem);
  let tab;
  try { ({ tab } = await readyTab()); } catch (e) { return showError(e.message); }
  const { rangeInputs, ...options } = o;
  const job = {
    id: `job-${Date.now()}`, tabId: tab.id, status: 'running', options,
    convs: state.convs.filter(c => state.selected.has(c.id)).map(c => ({ id: c.id, name: c.name || c.id, isGroup: !!c.isGroup, members: c.members || null })),
    index: 0, step: 0, progress: { phase: 'starting' }, log: [], startedAt: Date.now(), updatedAt: Date.now(),
  };
  await store.set({ [K.job]: job });
  state.job = job;
  renderJob();
  await chrome.tabs.sendMessage(tab.id, { type: 'chats.runJob' });
}
async function stopJob() {
  const job = (await store.get(K.job))[K.job];
  if (!job) return;
  job.status = job.status === 'running' ? 'stopping' : job.status;
  await store.set({ [K.job]: job });
  chrome.tabs.sendMessage(job.tabId, { type: 'chats.stop' }).catch(() => {});
  state.job = job;
  renderJob();
}
async function resumeJob() {
  const job = (await store.get(K.job))[K.job];
  if (!job) return;
  let tab;
  try { ({ tab } = await readyTab()); } catch (e) { return showError(e.message); }
  job.status = 'running';
  job.tabId = tab.id;
  delete job.error;
  await store.set({ [K.job]: job });
  state.job = job;
  renderJob();
  await chrome.tabs.sendMessage(tab.id, { type: 'chats.runJob' });
}
async function rebuildFiles() {
  const o = readOptions();
  const picked = state.convs.filter(c => state.selected.has(c.id) && state.archive[c.id]);
  if (!picked.length) return showError('Select chats that have been exported at least once.');
  const { rangeInputs, ...options } = o;
  $('rebuild').disabled = true;
  showProgressBox();
  for (const [i, c] of picked.entries()) {
    $('pConv').textContent = c.name;
    $('pCount').textContent = `chat ${i + 1}/${picked.length}`;
    $('pPhase').textContent = 'Writing files from the archive…';
    const r = await chrome.runtime.sendMessage({ type: 'chats.export.conv', convId: c.id, options });
    appendLog(r && r.ok ? `"${c.name}": ${r.written} files written, ${r.skipped} unchanged` : `"${c.name}": ${r && r.error}`);
  }
  $('pPhase').textContent = 'Files written.';
  setBar($('pBar'), 100);
  $('rebuild').disabled = false;
}

// ---------- progress view ----------
function showProgressBox() { $('progress').classList.remove('hidden'); $('logBox').classList.remove('hidden'); }
function setBar(el, pct) {
  el.parentElement.classList.toggle('indeterminate', pct == null);
  el.style.width = pct == null ? '' : `${Math.max(0, Math.min(100, pct))}%`;
}
function appendLog(line) {
  const li = document.createElement('li');
  li.textContent = line;
  $('log').append(li);
  li.scrollIntoView({ block: 'nearest' });
}
function showError(msg) {
  showProgressBox();
  $('pPhase').innerHTML = `<span class="err">${escapeHtml(msg)}</span>`;
}
const PHASE_PCT = { read: 0, cloud: 0.5, names: 0.6, media: 0.65, files: 0.95 };
function renderJob() {
  const job = state.job;
  const active = job && (job.status === 'running' || job.status === 'stopping');
  const stale = active && !state.csRunning && Date.now() - job.updatedAt > 30e3;
  $('start').disabled = !!active && !stale;
  $('stop').classList.toggle('hidden', !active);
  $('resume').classList.toggle('hidden', !(job && (job.status === 'stopped' || stale)) || (job && job.index >= job.convs.length));
  if (!job) return;
  showProgressBox();
  const p = job.progress || {};
  const n = job.convs.length;
  const c = job.convs[Math.min(job.index, n - 1)];
  $('pConv').textContent = p.conv || (c && c.name) || '';
  const overall = job.status === 'done' ? 100 : Math.round((100 * (Math.min(job.index, n) + (PHASE_PCT[p.phase] || 0))) / n);
  $('pCount').textContent = `chat ${Math.min(job.index + 1, n)}/${n} · ${overall}%`;
  let phase;
  if (job.status === 'stopping') phase = 'Stopping after the current step…';
  else if (job.status === 'stopped') phase = job.error ? `Stopped: ${job.error}` : 'Stopped. Press Resume to continue; nothing already saved is read again.';
  else if (job.status === 'done') phase = `Finished${job.errors && job.errors.length ? ` with ${job.errors.length} error(s) — see the log` : ''}. Files are in Downloads/Zalo_Export/.`;
  else if (p.phase === 'read') phase = `Reading · ${(p.messagesRead || 0).toLocaleString()} messages (${(p.messagesNew || 0).toLocaleString()} new)${p.oldestTs ? ` · back to ${fmtDate(p.oldestTs)}` : ''}${p.pct != null ? ` · ${p.pct}%` : ''}`;
  else if (p.phase === 'cloud') phase = `Asking Zalo's server for older messages · ${(p.messagesRead || 0).toLocaleString()} read${p.oldestTs ? ` · back to ${fmtDate(p.oldestTs)}` : ''}`;
  else if (p.phase === 'names') phase = 'Looking up names…';
  else if (p.phase === 'media') phase = 'Downloading files…';
  else if (p.phase === 'files') phase = 'Writing files…';
  else phase = 'Starting…';
  $('pPhase').textContent = phase;
  setBar($('pBar'), job.status === 'done' ? 100 : p.phase === 'read' ? p.pct : p.phase === 'media' || p.phase === 'files' || p.phase === 'names' ? 100 : null);
  const m = p.media;
  const showMedia = job.options.mode !== 'text' && m && (m.total || m.done || m.already);
  $('mediaBox').classList.toggle('hidden', !showMedia);
  if (showMedia) {
    $('pMedia').textContent = `${m.done}/${m.total}`;
    $('pMediaNote').textContent = [m.failed ? `${m.failed} failed` : '', m.already ? `${m.already} saved earlier` : ''].filter(Boolean).join(' · ');
    setBar($('pMediaBar'), m.total ? (100 * (m.done + (m.failed || 0))) / m.total : 100);
  }
  const log = $('log');
  log.textContent = '';
  for (const l of (job.log || []).slice(-60)) { const li = document.createElement('li'); li.textContent = `${new Date(l.t).toLocaleTimeString()} ${l.line}`; log.append(li); }
}

// ---------- wiring ----------
async function mount(el) {
  root = el;
  root.innerHTML = await (await fetch(chrome.runtime.getURL('modules/chats/view.html'))).text();
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg) return;
    if (msg.type === 'chats.job.progress' && msg.job) {
      state.job = msg.job;
      state.csRunning = msg.job.status === 'running';
      renderJob();
      if (msg.job.status !== 'running') loadArchive().then(renderConvs);
    } else if (msg.type === 'chats.export.progress') $('pPhase').textContent = `Writing files ${msg.done + 1}/${msg.total}…`;
  });
  chrome.tabs.onActivated.addListener(refreshConnection);
  chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' || info.url) refreshConnection(); });
  chrome.tabs.onRemoved.addListener(refreshConnection);

  const saved = await store.get([K.options, K.selection, K.list, K.job]);
  applyOptions(saved[K.options]);
  onOptionsChange();
  state.selected = new Set(saved[K.selection] || []);
  if (saved[K.list]) { state.convs = saved[K.list].convs || []; state.scannedAt = saved[K.list].scannedAt; state.me = saved[K.list].me || null; }
  state.job = saved[K.job] || null;
  await loadArchive();
  renderConvs();
  renderJob();
  root.querySelectorAll('input[name=mode], input[name=range], input[name=split], input[name=format], #from, #to, #rewrite, #recheck').forEach(i => i.addEventListener('change', onOptionsChange));
  root.querySelectorAll('input[name=show]').forEach(i => i.addEventListener('change', renderConvs));
  $('filter').addEventListener('input', renderConvs);
  $('selectAll').addEventListener('change', () => {
    for (const c of shownConvs()) { if ($('selectAll').checked) state.selected.add(c.id); else state.selected.delete(c.id); }
    saveSelection();
  });
  $('scan').addEventListener('click', () => scan(true));
  $('refresh').addEventListener('click', () => scan(false));
  $('openZalo').addEventListener('click', () => gotoZalo().then(refreshConnection));
  $('start').addEventListener('click', startJob);
  $('stop').addEventListener('click', stopJob);
  $('resume').addEventListener('click', resumeJob);
  $('rebuild').addEventListener('click', rebuildFiles);
  refreshConnection();
}

export default { id: 'chats', title: 'Chats', mount };
