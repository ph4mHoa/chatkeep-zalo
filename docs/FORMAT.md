# Export format

## Why this format

Zalo has no readable export of its own (checked September 2026):

| Option | What it is | Why not |
|---|---|---|
| Zalo's backup ([help.zalo.me](https://help.zalo.me/huong-dan/chuyen-muc/quan-ly-tai-khoan-zalo/sao-luu-va-khoi-phuc/chi-tiet-ve-cac-du-lieu-duoc-zalo-sao-luu/)) | Text messages to Zalo's servers, photos of the last 120 days to Google Drive; no voice, files, videos, or photos from groups over 100 members | Restores into Zalo only; nothing to read |
| Zalo PC backup | A `.zip` of raw, encrypted data | Not readable |
| [ZaloSave](https://chromewebstore.google.com/detail/zalosave-sao-l%C6%B0u-zalo-web/laeangldglicmlkmbjoocpiomhbgddng) (Chrome extension, 38 users, June 2026) | Archives what the user sees in Zalo Web, restores recalled messages, exports JSON | Its own JSON shape, no media files, only what was seen |
| [Zalo Assist App](https://chromewebstore.google.com/detail/zalo-assist-app/jlcknhjndljigonmefepojbdjddffico) (16 users, May 2025) | Exports personal messages as TXT or JSON | Undocumented shape |
| Telegram Desktop's export ([telegram.org](https://telegram.org/blog/export-and-more)) | `result.json`: `name`, `type`, `id`, `messages[id, type, date, date_unixtime, from, from_id, reply_to_message_id, photo, file, media_type, text, text_entities]`, media as relative paths | Telegram's, but the most widely read chat export: many tools and libraries parse it |
| WhatsApp's export ([WhatsApp help](https://faq.whatsapp.com/1180414079177245)) | A `.txt` of lines `[24/09/2026, 12:41:10] Name: text`, attachments as `<attached: file>` | Text only, no ids; but every chat parser reads it |

**Choice:** since no Zalo format exists to follow, the extension writes the formats other tools
already read:

- **JSON in the shape of Telegram Desktop's `result.json`**, one per chat (or per period).
  Everything Telegram has no field for — Zalo ids, quotes, recalls, edit history, archive flags,
  link previews, stickers — goes under a `zalo` key on each message and on the file, which Telegram
  readers ignore.
- **TXT in WhatsApp's style**, to read and search.
- **HTML** to read the chat in a browser, with photos and videos inline.

## Folder layout

```
Downloads/Zalo_Export/
  <chat_name>_<chat_id>/
    <chat_name>.json .html .txt        one file per chat, or one per period:
    2026-09.json                       month
    2026-W39.json                      ISO week (weeks start on Monday)
    2026-09-24.json                    day
    index.html                         when the HTML is more than one page
    range_2026-09-15_to_now/           a date-range export, in its own folder
    media/2026-09/2026-09-24_12-41-10_photo_23456789.jpg
    media/2026-09/2026-09-24_12-41-10_video_23456790.mp4
    media/2026-09/2026-09-24_12-41-10_Bao_cao_quy_3.xlsx     files keep their name
```

- No folder or file name contains spaces or brackets: anything other than letters (Vietnamese
  ones included), digits, `.`, `-` and `_` becomes `_`, so paths work in a shell unquoted.
- The chat folder is named when the chat is first archived and keeps that name if the group is
  renamed later. A group's id starts with `g`.
- Dates and times are in the browser's time zone.
- An HTML file holds at most 1 000 messages; longer periods continue in `_p2`, `_p3`… with
  previous/next links, and `index.html` lists them all.
- Media names are fixed in advance (time, kind, the end of the message id), so a text-only export
  already names the file a later media export will create.
- A date-range export never overwrites the full files; its media links point to the shared `media/`
  folder (`../media/…`).
- Photos are saved as JPEG. If Zalo has no JPEG copy of a photo, the original JPEG XL file (`.jxl`)
  is kept; Chrome cannot show those (other viewers can).

## JSON

```json
{
 "name": "Nhóm bạn thân",
 "type": "private_group",
 "id": "g8000000000000000001",
 "messages": [
  {
   "id": 7000000123456,
   "type": "message",
   "date": "2026-09-24T12:41:00",
   "date_unixtime": "1790228460",
   "from": "Bình",
   "from_id": "user2000000000000000002",
   "text": ["Chào ", { "type": "mention_name", "text": "@An", "user_id": "1000000000000000001" }],
   "text_entities": [{ "type": "plain", "text": "Chào " }, { "type": "mention_name", "text": "@An", "user_id": "1000000000000000001" }],
   "zalo": { "msg_id": "7000000123456", "cli_msg_id": "1750000123456", "msg_type": 1, "kind": "text" }
  },
  {
   "id": 7000000123457,
   "type": "message",
   "date": "2026-09-24T12:43:00",
   "date_unixtime": "1790228580",
   "from": "An",
   "from_id": "user1000000000000000001",
   "reply_to_message_id": 7000000123456,
   "photo": "media/2026-09/2026-09-24_12-43-00_photo_00123457.jpg",
   "width": 1280,
   "height": 960,
   "text": "ảnh đây",
   "text_entities": [{ "type": "plain", "text": "ảnh đây" }],
   "zalo": {
    "msg_id": "7000000123457", "msg_type": 2, "kind": "photo",
    "quote": { "msg_id": "7000000123456", "from": "Bình", "from_id": "user2000000000000000002", "text": "Chào @An", "date": "2026-09-24T12:41:00" },
    "media": { "kind": "photo", "status": "downloaded", "planned_name": "2026-09-24_12-43-00_photo_00123457.jpg", "url": "https://photo-stal-…" }
   }
  }
 ],
 "zalo": {
  "format": "zalo-chat-export",
  "version": 1,
  "exported_at": "2026-09-25T14:20:11+07:00",
  "conversation_id": "g8000000000000000001",
  "is_group": true,
  "members": 12,
  "me": { "id": "1000000000000000001", "name": "An" },
  "participants": [{ "id": "1000000000000000001", "name": "An", "is_self": true }, { "id": "2000000000000000002", "name": "Bình" }],
  "period": { "split": "none", "key": "all", "first": "2026-09-10T08:00:00", "last": "2026-09-25T14:02:00" },
  "message_count": 1423
 }
}
```

Messages are in time order.

| Field | Meaning (as in Telegram's export) |
|---|---|
| `name`, `type`, `id` | Chat name; `personal_chat` or `private_group`; the Zalo conversation id (a string) |
| `id` (message) | Zalo's message id, as a number (a string when it is not all digits or longer than 15) |
| `type` (message) | `message`, or `service` for a call |
| `date`, `date_unixtime` | Local time without offset; seconds since 1970 as a string |
| `from`, `from_id` | Display name; `user<Zalo id>`. For a call: `actor`, `actor_id`, `action: "phone_call"`, `duration_seconds` |
| `reply_to_message_id` | The quoted message |
| `photo`, `width`, `height` | Relative path of the photo, or Telegram's own words `(File not included. Change data exporting settings to download.)` when it was not downloaded |
| `file`, `file_name`, `file_size`, `mime_type`, `media_type`, `duration_seconds` | For GIFs (`animation`), videos (`video_file`), voice messages (`voice_message`) and files; `file` is a relative path or the words above |
| `media_type: "sticker"` | A sticker (not downloaded; its ids are in `zalo.sticker`) |
| `location_information`, `contact_information` | A location's coordinates; a contact card's name |
| `text` | A string, or an array of strings and entity objects when the text has formatting |
| `text_entities` | The whole text as pieces: `plain`, `mention_name` (with `user_id`), `mention` (@All), `link`, `bold`, `italic`, `underline`, `strikethrough` |

| `zalo` on a message | Meaning |
|---|---|
| `msg_id`, `cli_msg_id`, `msg_type`, `kind` | Zalo's ids and type; `kind` is `text`, `photo`, `gif`, `video`, `voice`, `file`, `sticker`, `link`, `contact`, `cards`, `card`, `location`, `call`, `poll`, `folder`, `ecard`, `recalled` or `other` |
| `quote` | The quoted message as Zalo stored it: `msg_id`, `from`, `from_id`, `text`, `date` |
| `forwarded` | Forwarded from another chat |
| `recalled`, `recalled_detected_at` | Recalled on Zalo ("thu hồi"); the archived text and files stay |
| `missing_since` | Not found in Zalo in a later run (deleted, or not on this device); kept |
| `edit_history` | Earlier texts `[{ "text", "replaced_at" }]` seen by earlier runs |
| `media` | For photos, GIFs, videos, voice and files: `status` (`downloaded`, `not-downloaded`, `failed`), `planned_name`, the Zalo `url`, `error` |
| `link`, `cards`, `sticker`, `contact`, `location`, `call` | Link preview (`url`, `title`, `description`, `thumb`), article cards, sticker ids, contact card, coordinates, call details |
| `disappearing_ttl` | A disappearing message's time to live |

The file's own `zalo` object: format name and version, export time with offset, conversation id,
group flag, member count, the account (`me`), participants with names, the period and date range
of the file, and the message count.

## TXT

```
# Nhóm bạn thân
# Participants: An (you), Bình, Cường
# All messages · 1423 messages · exported 2026-09-25 14:20:11

[24/09/2026, 12:41:00] Bình: Chào @An
[24/09/2026, 12:43:00] An: (reply to Bình: "Chào @An") ảnh đây <attached: media/2026-09/2026-09-24_12-43-00_photo_00123457.jpg>
[24/09/2026, 12:44:00] Bình: <photo not downloaded: 2026-09-24_12-44-00_photo_00123458.jpg>
[24/09/2026, 12:45:00] Cường: <file not downloaded: Bao cao.pdf (2.0 MB)>
[24/09/2026, 12:46:00] Bình: (recalled on Zalo — kept from the archive) lỡ gửi
[24/09/2026, 12:47:00] An: hẹn 7h (not found in Zalo since 2026-10-02 — kept from the archive)
```

Other markers: `<photo download failed: …>`, `<sticker>`, `<link: title — url>`, `<card: title — url>`,
`<location: https://www.google.com/maps?q=…>`, `<contact card: name>`, `<call, 3:05>`,
`<video call>`, `<poll>`, `<message recalled>`, `(edited)`, `(forwarded)`. A message with several
lines continues on the next lines, as in WhatsApp's file.

## HTML

Bubbles (yours on the right, in Zalo's blue), a header for each day, the sender's name when the
sender changes or after a 10-minute pause, reply quotes, @mentions and formatting, photos and GIFs
inline (a JPEG XL photo as a link), videos and voice messages playable, files as links, link
previews and article cards, earlier versions of edited messages, and the same archive notes as the
TXT file. The styles are inside the page, so it opens on its own; it follows light and dark mode.

## How the archive keeps values between runs

The archive (IndexedDB in the extension) holds every message by `[conversation, message id]`;
files are always written from it:

- A new message is added; one seen again is updated (names, mentions, attachments, previews).
- Changed text: the new text is used and the old one goes to `edit_history`.
- Recalled: marked; archived text and attachments stay.
- Not seen again where a run read: marked `missing_since`, never removed; seen again later: the mark
  goes.
- Each chat records the time spans read completely, so later runs skip them.
