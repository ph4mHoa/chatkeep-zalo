# Zalo Web from inside

What chat.zalo.me looks like from inside, as far as the extension depends on it. Seen on
2026-09-25: Zalo Web build `826674fb31d2af1b2b59` (the hash in its worker file names), Chrome 153
on Linux. When Zalo changes, start at the
[symptom table](#when-something-breaks) at the end.

## Where the messages are

- IndexedDB, one set of databases per account (`<name>_<uid>`). Messages are in `zdb_<uid>`
  (version 76), store `message`, index `userId_sendDttm_msgId` = `[toUid, sendDttm, msgId]`.
- **Message bodies are encrypted at rest** (AES; `message` and `quote` are base64 strings), and so
  are names and media details in the other stores. Metadata (`msgId`, `msgType`, `sendDttm`,
  `fromUid`, `toUid`, `status`) is plain.
- So the extension does not read the database. It calls the functions Zalo Web itself uses to load
  a chat, which return **decrypted** records.
- The UI is React 16 with Redux; the Redux state holds UI state only. The extension does not use the
  UI at all: no opening chats, no scrolling, no clicks, no "seen".

## Reaching Zalo's data layer

Zalo Web is a webpack 4 bundle. Pushing a chunk with one module of our own onto
`window.webpackJsonp` hands back webpack's `require`, and `require.c` is the module cache (4 176
modules in this build):

```js
window.webpackJsonp.push([[id], { [id]: (module, exports, require) => { req = require; } }, [[id]]]);
```

Modules are found by the **names of their methods**; module ids change with every build. The page
script (`extension/modules/chats/bridge.js`) looks for:

| Name in the code | Found by | This build | What it is used for |
|---|---|---|---|
| `messages` | `getLastMessageFrom` + `getOldestValidMessage` | `XS0u`, export `default` | `getLastMessageFrom(convId, msgId, sendDttm, count, include)`: one page of **decrypted** local messages older than `(sendDttm, msgId)`, oldest first (60 in 6 ms). `include = false` leaves the cursor message out. `getOldestValidMessage(convId)`: the oldest local message |
| `loader` | `loadOldMessagesFromCloudForConversation` + `getLastMessagesForConversation` | `4wTQ`, `default` | `loadOldMessagesFromCloudForConversation(convId, { msgId }, { src })` → `{ messages, hasMore }`: older messages from Zalo's server, without touching the UI (Zalo's media gallery calls it the same way). With a `src` of its own the call gets its own loader instance |
| `profiles` | `getProfileFriendByIds` + `getUidMe` + `getMiniInfo` | `UiPd`, `default` | `getUidMe()`: the account's id. `getProfileFriendByIds(uids)` → `{ uid: profile }`: fetches profiles Zalo does not have yet (10 in 233 ms), after which `getDName` knows them |
| `names` | `getDName` + `getAliasName` + `getProfileByIdFromCache` | `JWY6`, `a` | `getDName(uid)`: the name Zalo shows (alias, phone-book name, profile name) |
| `convs` | an export with an own property `ConvInfoDataManager` | a getter on `QPNp.a` | `getAllConvSync()` → every conversation: `{ userId, isGroup, numMsg, pinned, label, … }` |
| `groups` | `window.groupManager` | | `getDName(gid)`, `getGroupByIdSync(gid)` → `{ displayName, totalMember, … }` |

**Safety rule (learned the hard way).** Finding the modules reads **property descriptors only**,
runs no getter except webpack's own one-line export getters (`get: () => x`, under 80 characters)
and the one `ConvInfoDataManager` getter, and stops after 1.5 s. The first probe read every property
of every export: that ran arbitrary getters, the Zalo tab's memory exploded, the machine's load
reached 87 and the owner had to restart Chrome. The safe search takes about 20 ms.

## Message records

A decrypted record (field names as Zalo has them; the extension's own record is described in
[ARCHITECTURE.md](ARCHITECTURE.md#the-archive)):

| Field | Meaning |
|---|---|
| `msgId` | Server id, a digit string (11 or 13 digits; 17-character non-digit ids exist for a few local messages) |
| `cliMsgId` | The sender's client id (13 digits) |
| `msgType` | The type, below |
| `message` | The content: a string for text, otherwise an object (or an array for type 21); its `params` is a JSON **string** |
| `sendDttm` | Send time, milliseconds, as a 13-digit **string** (index order is string order) |
| `fromUid` | The sender. **`"0"` is the account itself**: the account's own messages never carry its real id (live: 517 of 7 335 messages, none with the real id). Quotes and mentions use the real id |
| `toUid` | The conversation: the other person's id, or `g<digits>` for a group |
| `dName` | A sender name stored with the message (rarely filled) |
| `quote` | A reply: `{ ownerId, msg, attach (JSON string), fromD (name), ts, cliMsgId, globalMsgId, cliMsgType }`; `globalMsgId` is the quoted message's `msgId` |
| `mentions` | `[{ uid, pos, len, type }]`; `uid "-1"` is @All |
| `reference` | JSON; `data.fwLvl` counts forwards and starts at 1: `>= 2` means forwarded |
| `ttl` | Above 0 for a disappearing message |

Types (constants in Zalo's code; counts from the first full export on 2026-09-25, 7 335 messages):

| `msgType` | What | `message` | Live |
|---|---|---|---|
| 1 | Text | a string, or `{ title, params: { styles: [{ start, len, st }] } }` for formatted text (`st`: `b`, `i`, `u`, `s`, colours `c_…`, sizes `f_…`) | 6 042 |
| 2 | Photo | `{ title (caption), hdUrl, oriUrl, normalUrl, thumbUrl, params: { width, height, hd } }` | 788 |
| 3 | Voice | `{ href, params }` (from Zalo's code; none on this device) | 0 |
| 4 / 13 | Sticker | `{ catId, id, type }` | 297 |
| 5 | Doodle | like a photo | 0 |
| 6 | Link or contact card | `{ action: 'recommened.link' \| 'recommened.user', title, href, description, thumb, params: { mediaTitle, … } }`; for a link `title` is what was typed | 86 |
| 7 | GIF | `{ oriUrl (.gif), hdUrl, normalUrl, thumbUrl (.png), params: { width, height, fileSize } }` | 3 |
| 11 | Photo (second variant) | like 2 | 0 |
| 17 | Location | coordinates in the content or its `params` | 0 |
| 18 | Video | `{ oriUrl (no extension, MP4), thumbUrl, duration (ms), params: { fileSize, video_width, video_height, duration } }` | 10 |
| 19 | File | `{ title (file name), href, params: { fileSize (number or digit string), fileExt, checksum } }` | 59 |
| 20 | Recalled ("thu hồi") | the record stays, same `msgId` | 0 |
| 21 | Article cards | an array of `{ title, href, thumb, description }` | 35 |
| 23 / 25 / 26 | Folder / e-card / poll | `title` holds the name or question | 1 poll |
| 27 / 52 / 53 | "zinstant" cards (reminders, official accounts) | text in `params.customMsg.msg` (an object) | 13 |
| 601 | Call | `params` with duration | 0 |
| -27 | Deleted for everyone | | 0 |
| -1909 | Unknown (seen once); exported as `other` with whatever text it has | | 1 |

Reactions are in a separate database (`r_db_<uid>`, empty on this device) and are not exported.
No group events (someone joined, left, renamed the group) appeared among the types on this account.

## Media

- **Photos are JPEG XL.** Every photo URL is `photo-stal-N.zdn.vn/gr/jxl/<hash>/<name>.jxl?…`
  (some use `/no/jxl/`). Chrome cannot show JPEG XL (Zalo decodes it itself). The same photo as a
  JPEG is at `/gr/jpg/<hash>/<name>.jpg` (or `/no/jpg/`): change the folder **and** the extension.
  Changing only the extension returns the JPEG XL bytes. Checked on 2026-09-25 by the first bytes
  (`ff d8 ff e0`); 28 of 28 photos downloaded live were real JPEGs after the `/no/` fix.
- GIFs: `zgif-vN.zdn.vn/….gif`. Videos: `video-stal-N.dlmd.me/<id>` (no extension; MP4). Files:
  `file-stal-N.dlfl.vn/…` or `doN.dlfl.vn/…`. Voice: `.aac`.
- All of these download with `chrome.downloads` directly; no cookies or host permission needed.
  One video took 194 s on its first download and 0.3 s when fetched again: the server can be slow.
- Whether file links expire was not tested (the files of the last two weeks downloaded fine).

## Names

- `names.getDName(uid)` knows friends, phone-book contacts and profiles Zalo has cached: 56 of 276
  senders in the first probe.
- For the rest, `profiles.getProfileFriendByIds(uids)` asks Zalo's server (what Zalo does for a
  group's member list); afterwards `getDName` knows them. Live: 467 of 467 unknown senders resolved,
  in batches of 50. The extension keeps **only display names**; profiles also carry phone numbers
  and other fields, which are never stored.
- Fallbacks in the export: the name in the quote (`fromD`), the text of a mention, then the id.

## Conversations

- `getAllConvSync()` lists 48 conversations on this account. **Hidden (PIN-locked) chats** are
  listed in localStorage under a key ending in `_data_ids_hidden_chat` (a JSON array of
  conversation ids); the extension leaves them out (47 shown).
- A 1-1 conversation's id is the other person's id; a group's id starts with `g`.
- Group names and member counts come from `window.groupManager`.

## History on this device

- Zalo Web keeps what this device received or loaded. On this account local history starts on
  2026-09-10 (where this device's sync started), with one chat going back to 2026-08-31.
- **Older history** comes from Zalo's server through `loadOldMessagesFromCloudForConversation`. In
  the first probe it returned nothing; in the first live export it returned 375 older messages for
  one chat, which Zalo then kept locally (the next run read them locally). The extension asks the
  server once per chat.
- Otherwise older messages need Zalo's own sync from the phone. Zalo Web's own texts point to
  **⚙ → Settings → Sync messages → Sync now** (*⚙ → Cài đặt → Đồng bộ tin nhắn → Đồng bộ ngay*),
  confirmed on the phone, and describe it as "Synchronize text messages from your phone to your
  computer" (from Zalo Web's language files, build `826674fb31d2af1b2b59`; not tried with this
  extension). Messages that arrive this way below what the archive has are picked up by the next
  run automatically; "Check the whole history again" also finds those that land between archived
  ones.

## One tab at a time

Zalo Web runs in one tab. localStorage `sh_singleton_web_app` holds the id of the active tab and
sessionStorage `backup-tab-key` each tab's own id. A new *visible* chat.zalo.me tab takes over; the
old one shows "Bạn đang mở Zalo trên một Tab khác hoặc không sử dụng Zalo quá lâu" with a
**Kích hoạt** button, which reloads it and takes over again. A new hidden tab disables itself.

So the extension works in the tab the user already has open and never opens a second one while one
exists. Before each chat it checks that its tab is the active one and stops with that reason if
not.

## Numbers from the live run (2026-09-25)

| | |
|---|---|
| Whole account, text only | 47 chats, 7 335 messages in 34 s, 375 of them from Zalo's server |
| Again, after clearing the archive | 7 351 messages in 13 s |
| Names looked up | 467, all found |
| Photos | 28 of 28 in 11 s (3 chats), all real JPEGs |
| All media | 2 videos, 2 PDFs (valid MP4 and PDF headers) |
| Zalo tab heap | 118–129 MB throughout |

## When something breaks

| Symptom | Likely cause | Where to look |
|---|---|---|
| Panel: "Zalo has changed: parts not found (messages, …)" | A method name changed in a new Zalo build | Find the new name with a descriptor-only search, then update `WANT` in `bridge.js` |
| Panel: "Zalo is loading…" for good | `window.webpackJsonp` renamed (webpack 5 uses `webpackChunk…`) | `getRequire()` in `bridge.js` |
| Every chat reads 0 messages | `getLastMessageFrom` arguments or cursor types changed | `readPage` in `bridge.js`; compare with `probe-read.js` |
| "not older than the last page; reading stopped" | Zalo ignores the cursor | same |
| Your own messages appear under an id or as "Me" | The "0 is me" convention changed, or `getUidMe` moved | `normalizeMessage` (`me`), `ping` in `bridge.js` |
| Photos saved as `.jxl` | The JPEG copy moved | `jpegUrl` in `normalize.js`; check by first bytes |
| Names show as ids | Name functions moved | `nameOf` / `resolveNames` in `bridge.js` |
| Hidden chats show up | The localStorage key changed | `hiddenIds()` in `bridge.js` |
| "Zalo is active in another tab" although it is not | The single-tab keys changed | `activeTab()` in `bridge.js` |
