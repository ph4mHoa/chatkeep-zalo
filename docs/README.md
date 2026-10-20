# ChatKeep for Zalo documentation

The index of every document about ChatKeep for Zalo, the Chrome extension in `extension/`. Start
here, read what fits your question, and add a row here for any new document.

## Where to start

| You want to | Read |
|---|---|
| Install it and export chats | [userguide/README.md](userguide/README.md) |
| Use the exported files | [FORMAT.md](FORMAT.md) |
| Change the code | [ARCHITECTURE.md](ARCHITECTURE.md), then [TESTING.md](TESTING.md) |
| Fix it after Zalo changed Zalo Web | [ZALO.md](ZALO.md) (the symptom table at its end) |

## Documents

| Document | What it covers | Checked against the code |
|---|---|---|
| [../README.md](../README.md) | What the project is, install, development commands, layout | 2026-09-25 |
| [userguide/README.md](userguide/README.md) | For users, with pictures and GIFs of a demo run (`userguide/images/`, made by `npm run guide-images`): install, first export, options, progress, stop and resume, later exports, what is kept, how far back, files, privacy, limits, troubleshooting | 2026-09-25 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Host, core and the `chats` module; where code runs; messages, storage keys, the archive's stores and records, the job record; how a job runs; reading a chat; names; downloads; adding a module | 2026-09-25 |
| [ZALO.md](ZALO.md) | What Zalo Web looks like from inside (September 2026): where messages are, reaching Zalo's data layer and the safety rule, message records and types, media, names, conversations, history on this device, the single-tab lock, live numbers, the symptom table | 2026-09-25 |
| [FORMAT.md](FORMAT.md) | Why this format (research with sources), folder layout, JSON (Telegram Desktop shape), TXT (WhatsApp style), HTML, how the archive keeps values between runs | 2026-09-25 |
| [TESTING.md](TESTING.md) | The automated tests and how the simulation works; the demo run that makes the user guide's pictures | 2026-09-25 |
| [PRIVACY.md](PRIVACY.md) | The privacy policy to host for a store listing | 2026-09-25 |

## Outside this folder

- **Code comments**: every file starts with a comment saying what it does; the module interfaces
  are also described at the top of `extension/sw.js` and `extension/panel.js`.
- **Not in the repo, on purpose**: exports (`~/Downloads/Zalo_Export/`), raw probe output, Zalo's
  JavaScript bundles, screenshots with readable chats, screenshots of the owner's dashboard or
  YouTube Studio, and the demo video (`dist/chatkeep-demo.mp4`, rebuilt by `npm run
  store-assets`; the uploaded copy is on YouTube).

## Keeping this documentation alive

When you change something, update the document that describes it in the same commit:

| Change | Update |
|---|---|
| A message type, storage key, database store, job field or content script | [ARCHITECTURE.md](ARCHITECTURE.md) |
| A new fact about Zalo Web, or an old one that stopped being true | [ZALO.md](ZALO.md), with the month it was seen and the Zalo build |
| A panel label, option, limit or message the user sees | [userguide/README.md](userguide/README.md), and its pictures: `npm run guide-images`, then look at each one and run the privacy scan before committing ([TESTING.md](TESTING.md#the-user-guides-pictures)); the store's pictures and video too, `npm run store-assets` |
| An export file or field | [FORMAT.md](FORMAT.md) |
| A test file | [TESTING.md](TESTING.md) |
| A permission or what data is read | [PRIVACY.md](PRIVACY.md) |
| The extension's name or store summary | `extension/_locales/en` and `vi` (132 characters at most for the summary); a new package for the store |
| [PRIVACY.md](PRIVACY.md) | Its public copy |
| A new document | a row in the table above |

Then set the date in the last column of the table above.
