// IndexedDB helpers shared by the modules. Each module keeps its own database.

const opened = new Map();

// Opens (and creates or upgrades) a database once per name.
export function open(name, version, upgrade) {
  if (opened.has(name)) return opened.get(name);
  const p = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = ev => upgrade(req.result, ev.oldVersion);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opened.delete(name); reject(req.error); };
  });
  opened.set(name, p);
  return p;
}

export const done = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
export const finished = tx => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
