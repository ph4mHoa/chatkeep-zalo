// Side panel shell: one tab per module.
//
// Module interface (side panel side): a module's view.js exports default
//   { id, title, mount(root) }
// mount() fills `root`, the module's own container, and wires its controls; it runs once when
// the panel opens, so a view keeps receiving its progress messages while another tab is shown.
import chats from './modules/chats/view.js';

const VIEWS = [chats];
const KEY = 'panel.view';
const tabs = document.getElementById('tabs');
const views = document.getElementById('views');

function show(id) {
  for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.view === id));
  for (const v of views.children) v.hidden = v.dataset.view !== id;
  chrome.storage.local.set({ [KEY]: id });
}

(async function init() {
  const saved = (await chrome.storage.local.get(KEY))[KEY];
  for (const v of VIEWS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.view = v.id;
    b.textContent = v.title;
    b.addEventListener('click', () => show(v.id));
    tabs.append(b);
    const root = document.createElement('div');
    root.dataset.view = v.id;
    root.setAttribute('role', 'tabpanel');
    root.hidden = true;
    views.append(root);
  }
  // With one module the tab strip is noise; it appears once there are two.
  tabs.classList.toggle('hidden', VIEWS.length < 2);
  show(VIEWS.some(v => v.id === saved) ? saved : VIEWS[0].id);
  await Promise.all(VIEWS.map((v, i) => v.mount(views.children[i])));
})();
