// Service worker: the host for the extension's modules. Shared services are in core/; each
// feature is a module under modules/ and keeps its own content scripts, archive and files.
//
// Module interface (service worker side): a module's worker.js exports default
//   { id, handlers: { [messageType]: (msg, sender) => result | Promise<result> } }
// where every message type starts with `${id}.`. Content scripts and the side panel reach a
// module by sending those types; tab-side commands use the same prefix. Messages of type
// 'core.*' are answered here.
import chats from './modules/chats/worker.js';

const MODULES = [chats];

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const handlers = {
  // A content script asks which tab it runs in (to resume a job that belongs to its tab).
  'core.tabId': (msg, sender) => ({ tabId: sender.tab ? sender.tab.id : null }),
};
for (const m of MODULES) {
  for (const [type, handler] of Object.entries(m.handlers)) {
    if (!type.startsWith(`${m.id}.`) || handlers[type]) throw new Error(`module ${m.id}: message type ${type} is outside its prefix or taken`);
    handlers[type] = handler;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = msg && handlers[msg.type];
  if (!h) return;
  Promise.resolve(h(msg, sender)).then(sendResponse, e => sendResponse({ ok: false, error: String(e && e.stack || e) }));
  return true;
});
