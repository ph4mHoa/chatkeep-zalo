// Chats module: where exported chats and their media go, relative to the Downloads folder.
import { safeName, monthKey, fmtLocal } from '../../core/util.js';

const fileStamp = ts => fmtLocal(ts).replace(' ', '_').replace(/:/g, '-');

export const ROOT_DIR = 'Zalo_Export';
// The folder name is fixed when a chat is first archived (conv.folder), so renaming a group
// does not split its files across two folders.
export const folderName = conv => `${safeName(conv.name || conv.convId, 60)}_${conv.convId}`;
export const convDir = conv => `${ROOT_DIR}/${conv.folder || folderName(conv)}`;

export function urlExt(url) {
  try { const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname); return m ? m[1].toLowerCase() : null; } catch { return null; }
}
const KIND_EXT = { photo: 'jpg', gif: 'gif', video: 'mp4', voice: 'aac' };
export function defaultExt(att) {
  if (att.kind === 'file') {
    const m = /\.([a-z0-9]{1,8})$/i.exec(att.filename || '');
    return m ? m[1].toLowerCase() : att.ext || 'bin';
  }
  if (att.kind === 'voice') return urlExt(att.url) || 'aac';
  return KIND_EXT[att.kind] || 'bin';
}

// Media file path, relative to the Downloads folder. Deterministic, so a text-only export can
// name the file that a later media export will create.
export function mediaPath(conv, msg, att, ext) {
  const month = monthKey(msg.ts);
  const tail = String(msg.id).replace(/[^0-9A-Za-z]/g, '').slice(-8);
  let name;
  if (att.kind === 'file' && att.filename) name = `${fileStamp(msg.ts)}_${safeName(att.filename, 100)}`;
  else name = `${fileStamp(msg.ts)}_${att.kind}_${tail}${att.index ? '_' + att.index : ''}.${ext || defaultExt(att)}`;
  return `${convDir(conv)}/media/${month}/${name}`;
}

export const MEDIA_KINDS = {
  text: [],
  photos: ['photo', 'gif'],
  all: ['photo', 'gif', 'video', 'voice', 'file'],
};
