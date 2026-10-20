# Architecture

ChatKeep for Zalo is a Manifest V3 extension in `extension/`: a small **host** (service worker,
side panel), shared **core** services, and one feature **module**, `chats`. The layout follows
ChatKeep for Messenger ([chatkeep-messenger](https://github.com/ph4mHoa/chatkeep-messenger)), so more modules can join later as separate folders behind the
same two interfaces instead of as new extensions.

## Where the code runs

| Context | Files | Job |
|---|---|---|
| chat.zalo.me, page world | `modules/chats/bridge.js` | Finds Zalo Web's data-layer modules and answers read commands on a `window.postMessage` channel. The only code that touches Zalo's objects ([ZALO.md](ZALO.md)) |
| chat.zalo.me, isolated world | `modules/chats/normalize.js`, `content.js` | Runs the export job: reads through the bridge, turns Zalo records into archive records, drives names, downloads and files, keeps the job record |
| Service worker | `sw.js` → `modules/chats/worker.js` (with `db.js`, `merge.js`, `export.js`, `paths.js`), `core/downloads.js` | Owns the archive (IndexedDB), downloads media, writes the export files |
| Side panel | `panel.html`, `panel.js` → `modules/chats/view.html`, `view.js` | Chat list, options, Start / Stop / Resume, progress; reads the archive for the counts |
| Offscreen document | `offscreen.html`, `offscreen.js` | Turns export text into `blob:` URLs (a service worker cannot) |

`core/util.js` (date keys, safe names, hash) and `core/idb.js` (IndexedDB promises) are shared.
Every file starts with a comment saying what it does.

`_locales/en` and `_locales/vi` hold the manifest's name, summary and toolbar title
(`__MSG_name__`, `__MSG_description__`, `__MSG_action_title__`; English is the default): Chrome
and the store show them in the browser's language. The panel itself is English only; no code
calls `chrome.i18n`.

## Module interfaces

- **Service worker side** (top of `sw.js`): a module's `worker.js` exports
  `{ id, handlers: { [type]: (msg, sender) => result } }`; every type starts with `<id>.`. `sw.js`
  refuses a type outside the prefix or already taken. `core.*` types are answered by `sw.js`.
- **Panel side** (top of `panel.js`): a module's `view.js` exports `{ id, title, mount(root) }`.
  Each module gets its own container; the tab strip appears only with two or more modules.
- Content scripts answer only their own module's message types, so modules can share a tab.

## Messages

Page channel `__zlx_chats__` (content script ↔ bridge.js, `window.postMessage` to
`location.origin`; request `{ __zlx_chats__: 'req', id, cmd, args }`, reply `'res'` with
`ok`, `result` or `error`):

| Command | Returns |
|---|---|
| `ping` | `{ version, ready, missing, webpack, active, me: { id, name } }` |
| `listConversations { deep }` | `{ me, conversations: [{ id, isGroup, name, members?, lastTs, firstTs? }] }`, newest activity first, hidden chats left out; `deep` adds `firstTs` (where this device's history starts) |
| `bounds { convId }` | `{ newest: { ts, msgId }, oldest }` on this device |
| `readPage { convId, beforeTs, beforeMsgId, count }` | `{ messages, names }`: up to `count` local messages older than the cursor, oldest first, and the names Zalo knows for their senders, quoted authors and mentioned people |
| `readCloud { convId, beforeMsgId }` | `{ messages, hasMore, names }` from Zalo's server (60 s timeout) |
| `resolveNames { uids }` | `{ names, asked }`: Zalo's caches, then Zalo's profile service in batches of 50, 0.8 s apart; only display names are returned |

A newer copy of bridge.js (after an extension update) takes the channel over
(`window.__zlxChatsBridge`); the old one stops answering.

Tab commands (panel → content script, `chrome.tabs.sendMessage`): `chats.ping`,
`chats.listConvs { deep }`, `chats.runJob`, `chats.stop`.

Service worker handlers:

| Type | From | Does |
|---|---|---|
| `core.tabId` | content script | The sender's tab id (to resume only a job that belongs to this tab) |
| `chats.conv.state` | content script | Before a chat is read: stores name, group flag, members, the account; fixes the folder name the first time; returns `{ coverage, cloudDone, cloudCursor, messageCount }` |
| `chats.conv.update` | content script | Stores names found, names not found (`namesTried`), the server-history cursor and done flag |
| `chats.db.upsert` | content script | Merges a page of messages into the archive (`{ added, updated, same }`) |
| `chats.db.finishRun` | content script | Closes a chat's read: coverage, missing flags, counts ([below](#reading-a-chat)) |
| `chats.names.missing` | content script | Ids the chat's messages name without a display name, minus those asked for in the last 7 days |
| `chats.media.pending` | content script | Attachments of the chosen kinds in the range not yet saved (`{ items, already }`); skips recalled messages and items that failed 3 times |
| `chats.media.download` | content script | Starts one download (`started`, `done` or `failed`) |
| `chats.media.status` | content script | Status of the given downloads; also checks for stalled ones |
| `chats.export.conv` | content script, panel ("Files only") | Writes the chat's files from the archive (`{ written, skipped, total, messages }`) |

Broadcasts: `chats.job.progress { job }` (content script → panel), `chats.media.status`
(worker → the job's tab and the panel), `chats.export.progress` (worker → panel). The offscreen
document answers `{ target: 'offscreen', type: 'blob' | 'revoke' }`.

## Storage

`chrome.storage.local`:

| Key | Holds |
|---|---|
| `chats.job` | The current or last job ([below](#the-job-record)) |
| `chats.options` | The panel's options, as last set |
| `chats.selection` | Selected chat ids |
| `chats.convList` | The chat list as last scanned: `{ convs, scannedAt, me }` |
| `panel.view` | The panel tab last shown |

`chrome.storage.session`: `chats.inflight`, the media downloads in progress, so a restarted worker
still knows them.

## The archive

IndexedDB `zlx-chats`, version 1, in the extension's origin (worker and panel):

| Store | Key | Index | Record |
|---|---|---|---|
| `convs` | `convId` | | `name`, `folder` (fixed at the first run), `isGroup`, `members`, `me` (the account id), `participants` (`{ uid: display name }`), `coverage` (sorted, disjoint `[from, to]` time spans read completely), `bottomReachedAt`, `lastRunAt`, `messageCount`, `namesTried` (`{ uid: time }`), `cloudCursor`, `cloudDone`, `cloudCheckedAt`, `lastExportAt`, `lastExportOptions`, `createdAt` |
| `messages` | `[convId, id]` | `conv_ts` = `[convId, ts]` | Below |
| `media` | `[convId, id]` | `conv` | `messageId`, `ts`, `kind`, `status` (`downloading`, `done`, `failed`), `path` (relative to Downloads), `url` used, `error`, `attempts`, `mime`, `size`, `updatedAt` |
| `files` | `path` | | `hash` (FNV-1a of the content without its export time), `writtenAt`, `convId` |

A message record (made by `normalize.js`, merged by `merge.js`):

| Field | Meaning |
|---|---|
| `id`, `convId`, `ts`, `cliMsgId` | Zalo's `msgId` (string), the conversation, `sendDttm` as a number, the client id |
| `type`, `kind` | Zalo's `msgType` and the archive's kind (`text`, `photo`, `gif`, `video`, `voice`, `file`, `sticker`, `link`, `contact`, `cards`, `card`, `location`, `call`, `poll`, `folder`, `ecard`, `recalled`, `other`) |
| `senderId`, `senderName` | The sender's id (Zalo's `"0"`, the account itself, is stored as the account's id) and a name Zalo stored with the message |
| `text`, `styles` | Text or caption; bold / italic / underline / strikethrough ranges |
| `attachments` | `[{ id, kind, url, alts, thumb, width, height, durationMs, size, filename, ext }]`; `id` is the message id |
| `sticker`, `link`, `cards`, `contact`, `location`, `call` | What else the message holds |
| `replyTo` | `{ id, senderId, senderName, text, ts, type, hasMedia }` from Zalo's quote |
| `mentions`, `isForwarded`, `ttl` | `[{ uid, pos, len, type }]` (`uid "-1"` = @All); forwarded; disappearing |
| `recalled`, `recalledDetectedAt` | Recalled on Zalo, and when a run first saw it |
| `editHistory` | `[{ text, replacedAt }]` |
| `missingSince` | Not found where a later run read (deleted, or not on this device) |
| `firstSeenAt`, `lastSeenAt`, `lastSeenRun` | Archive bookkeeping |

Merge rules (`merge.js`): the archive never loses data. A recall marks the message and keeps its
text and attachments; a changed text moves the old one to `editHistory`; attachments merge by id;
content fields take the latest non-empty value; a sighting clears `missingSince`; a sender stored
as `"0"` gets the real id.

## The job record

`chats.job` in `chrome.storage.local`, written by the panel (start, stop, resume) and the content
script (everything else):

| Field | Meaning |
|---|---|
| `id`, `tabId` | The job and the Zalo tab it runs in |
| `status` | `running`, `stopping` (Stop pressed, or a fatal problem), `stopped`, `done` |
| `options` | `mode` (`text`, `photos`, `all`), `split` (`none`, `day`, `week`, `month`), `formats`, `rewrite`, `recheck`, `from`, `to` (ms or null) |
| `convs` | `[{ id, name, isGroup, members }]` in the order they run |
| `index`, `step` | The chat being worked on and its next phase (0 read, 1 names, 2 media, 3 files) |
| `progress` | `phase`, `conv`, `messagesRead`, `messagesNew`, `oldestTs`, `pct`, `media: { total, done, failed, already }` |
| `log` | The last 80 lines `{ t, line }` |
| `results`, `errors`, `error` | Per chat and phase; per-chat errors; the reason a job stopped by itself |
| `startedAt`, `updatedAt` | |

## How a job runs

For each chat, four phases in order: **read → names → media → files**. After each phase the
content script stores `step + 1`, so Resume continues at the phase that was running (an interrupted
read starts that chat's read again, which costs little because of the coverage). An error in one
chat is logged and the job moves on; a **fatal** problem (Zalo not ready, or active in another tab)
stops the whole job with the reason in `job.error`.

- **Stop**: the panel sets `stopping` and sends `chats.stop`; the content script checks both before
  every page and every download round, then sets `stopped`.
- **Resume**: sets `running` with the current tab and sends `chats.runJob`.
- **Reload of the Zalo tab**: the new content script finds a `running` job whose `tabId` is its own
  tab and continues it.
- **The panel** can be closed at any time; the job runs in the tab. It shows Resume for a job that
  says `running` but has not moved for 30 s (for example, its tab was closed).

## Reading a chat

`readConv` in `content.js`, with `finishRun` in `db.js`:

1. Pages of 200 messages go from the newest message down, cursor `(sendDttm, msgId)` exclusive.
   Each page is normalized and merged into the archive at once.
2. **Coverage** (`conv.coverage`) holds the time spans earlier runs read without a gap. Once a
   page reaches into a covered span and 50 archived messages in it were read again (the overlap),
   the read jumps to the span's lower end (cursor `{ ts: lower + 1, msgId: '' }`) and continues
   below it, until Zalo has nothing older. So a second run reads only the new messages, the
   overlap, and any older history that appeared since.
3. **Missing messages**: `finishRun` gets the stretches actually read. Archived messages inside a
   read stretch that were not seen this time get `missingSince`; so do archived messages newer
   than the newest message Zalo had at the start. They are kept. Messages below what this device
   has are not flagged.
4. **Zalo's server**: when the read reaches the oldest local message, Zalo's server is asked for
   older messages, from that message down, 1 s between requests, at most 500 requests. The chat
   records `cloudCursor` after each page and `cloudDone` at the end, so the server is asked once
   per chat.
5. **"Check the whole history again"** (`recheck`) ignores the coverage for that run: every message
   is read again, and messages that appeared inside an archived span (after a sync from the phone)
   are found.
6. **Date range**: the read still starts at the newest message and stops once it passes the start
   date (no server history then); the files hold only the range, in a folder of their own.
7. **Loop guards**: a page that is not older than the previous one stops the chat's read with an
   error; the server loop stops when a page brings no progress.

## Names

After reading, `chats.names.missing` lists ids that the chat's messages name (senders, quoted
authors, mentions) without a display name. The bridge resolves them from Zalo's caches, then from
Zalo's profile service (batches of 50). Only display names are stored, in `conv.participants`; an
id Zalo could not name is asked for again after 7 days.

## Downloads

**Media** (worker): for each attachment the worker builds candidate addresses
(`candidates(att)`): for a photo, the JPEG copies of all its URLs first, then the JPEG XL
originals. It downloads the first with `chrome.downloads` to the planned path (`paths.js`) and
checks the finished file: an empty file, a web page, or JPEG XL bytes at a JPEG address is removed
and the next candidate tried. The content script keeps 3 downloads going and polls
`chats.media.status`; each finished download also sends an event that wakes it. A download that
never starts within 5 minutes fails; one that receives no data for 3 minutes is cancelled and the
next candidate tried. Failed items are tried again on later runs, up to 3 attempts. The downloads in flight are mirrored to
`storage.session`.

**Export files** (`core/downloads.js`): `export.js` builds `[{ path, mime, content }]` from the
archive (pure functions, unit-tested); `writeFiles` skips a file whose hash (content without the
export time) matches the one last written, unless "Rewrite all files" is set; the text becomes a
`blob:` URL in the offscreen document and is saved with `chrome.downloads`. While saving, the
download bubble is hidden (shown again 4 s after the last file) and every finished entry is erased
from the download history; the files stay on disk. An `onDeterminingFilename` listener repeats the
extension's own file names, since another extension's listener could otherwise drop them.

## Adding a module

1. `extension/modules/<id>/` with `worker.js` (handlers prefixed `<id>.`), `view.js` + `view.html`,
   and its content scripts.
2. Import it in `sw.js` (`MODULES`) and `panel.js` (`VIEWS`); add its content scripts to
   `manifest.json`.
3. Its own storage keys (prefixed `<id>.`), its own IndexedDB, its own export folder.
4. Its tests in `test/`, its document in `docs/`, a row in [README.md](README.md).
