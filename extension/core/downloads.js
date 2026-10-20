// Downloads shared by the modules (service worker only): saves files into the Downloads folder
// without flooding Chrome's download bubble, and skips export files that have not changed.
import { fnv1a, isoLocal, fmtLocal } from './util.js';

// Exports can save hundreds of files. So that they do not flood Chrome's download bubble and
// history, the bubble is hidden while the extension is saving files (and shown again a few
// seconds after the last one), and each finished entry is removed from the download history.
// The files themselves stay on disk.
let saving = 0, uiTimer = null;
export function savingStarted() {
  saving++;
  clearTimeout(uiTimer);
  chrome.downloads.setUiOptions({ enabled: false }).catch(() => {});
}
export function savingEnded() {
  saving = Math.max(0, saving - 1);
  clearTimeout(uiTimer);
  if (!saving) uiTimer = setTimeout(() => chrome.downloads.setUiOptions({ enabled: true }).catch(() => {}), 4000);
}
// A worker that restarts has nothing in flight: make sure the bubble is not left hidden.
chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
export const forget = id => chrome.downloads.erase({ id }).catch(() => {});

// Chrome drops the filename given to downloads.download() when any extension's
// onDeterminingFilename listener answers without one, so this listener repeats ours.
const ownDownloads = new Map();
export async function download(opts) {
  ownDownloads.set(opts.url, { filename: opts.filename, conflictAction: 'overwrite' });
  try { return await chrome.downloads.download({ saveAs: false, conflictAction: 'overwrite', ...opts }); }
  finally { setTimeout(() => ownDownloads.delete(opts.url), 120e3); }
}
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const own = item.byExtensionId === chrome.runtime.id && (ownDownloads.get(item.url) || ownDownloads.get(item.finalUrl));
  if (own) suggest(own); else suggest();
});

// ---------- text files ----------
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Turn exported text into files for chrome.downloads' });
}
function waitDownload(id) {
  return new Promise(resolve => {
    const check = async () => {
      const [it] = await chrome.downloads.search({ id });
      if (!it || it.state !== 'in_progress') { chrome.downloads.onChanged.removeListener(onChange); resolve(it ? it.state : 'missing'); }
    };
    const onChange = d => { if (d.id === id && d.state) check(); };
    chrome.downloads.onChanged.addListener(onChange);
    check();
  });
}
export async function saveText(path, text, mime) {
  await ensureOffscreen();
  const { url } = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'blob', text, mime });
  savingStarted();
  try {
    const id = await download({ url, filename: path });
    const state = await waitDownload(id);
    forget(id);
    if (state !== 'complete') throw new Error(`download ${state}`);
  } finally {
    savingEnded();
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
  }
}

// Writes export files ([{ path, mime, content }]) made at time `now`. A file whose content has not
// changed since it was last written is skipped unless `rewrite` is set. Each file states when it
// was exported; the hash leaves that out so unchanged files are recognised. The module keeps the
// hashes: getFile(path) returns its record, putFile({ path, hash, writtenAt }) stores one.
export async function writeFiles(files, { now, rewrite, getFile, putFile, onProgress }) {
  const stamps = [isoLocal(now), fmtLocal(now)];
  const unstamped = s => stamps.reduce((out, stamp) => out.split(stamp).join(''), s);
  let written = 0, skipped = 0;
  for (const [i, f] of files.entries()) {
    const hash = fnv1a(unstamped(f.content));
    const prev = await getFile(f.path);
    if (!rewrite && prev && prev.hash === hash) { skipped++; continue; }
    if (onProgress) onProgress(i, files.length, f.path);
    await saveText(f.path, f.content, f.mime);
    await putFile({ path: f.path, hash, writtenAt: Date.now() });
    written++;
  }
  return { written, skipped, total: files.length };
}
