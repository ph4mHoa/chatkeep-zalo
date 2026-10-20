# Testing

Two kinds of checks: automated tests that run in Node without a browser, and live runs in the
owner's Chrome. Run the automated tests before every commit; do a live run after anything that
touches how the extension reads Zalo.

## Automated tests

```
npm install     # once: fake-indexeddb
npm test        # all 36 tests, about 25 s
node --test test/unit.test.mjs    # one file (set TZ=Asia/Ho_Chi_Minh as npm test does)
```

`npm test` pins the time zone (`TZ=Asia/Ho_Chi_Minh`), because file names and day/week/month keys
use local time. It passes a glob (`"test/*.test.mjs"`): `node --test <directory>` fails on Node 22.

| File | Tests | What it covers |
|---|---|---|
| `test/unit.test.mjs` | 16 | Date keys and ISO weeks, safe names, normalizing every message kind (including `fromUid "0"` as the account and `/no/jxl/` photos), JPEG copies of photo URLs, the merge rules (recall, edit, missing), coverage spans, media paths, Telegram text entities, the JSON / TXT / HTML writers |
| `test/job.sim.test.mjs` | 20 | Whole jobs: the chat list; first, second and empty runs; the end of the last run gone; the newest messages gone; less history on this device; older history appearing; "Check the whole history again"; photo fallbacks and retries; Stop while reading, while downloading, and a Stop that races a progress write; date ranges; server history asked once; a stalled download; several chats with a tab reload; a Zalo that repeats a page; Zalo active in another tab; downloads kept out of the way, names only from profiles, no getter run |
| `test/fixtures/zalo.mjs` | — | Builders for Zalo-shaped message records (September 2026 shapes, made-up text and ids): every content type, quotes, forwards |

### How the simulation works

`job.sim.test.mjs` runs the shipped code in the roles Chrome gives it:

- **The real service worker.** `globalThis.chrome` is a fake (storage local and session, runtime
  messages, tabs, scripting, downloads, offscreen) and `extension/sw.js` is imported, so the
  handlers, the archive (on `fake-indexeddb`) and the export writers are the real ones. Downloads
  go to a `Map` standing for the Downloads folder, fed by a fake server whose `fail`, `html`,
  `jxl` and `stall` sets make an address fail, answer with a web page, send JPEG XL bytes, or
  connect and never send data. `downloads.search` reports `mime`, `fileSize` and `bytesReceived`;
  `cancel`, `removeFile` and `erase` work.
- **The real page script.** `bridge.js` runs in a `vm` context standing for the page's own world,
  with a fake `window.webpackJsonp` whose module cache holds fake Zalo modules under this build's
  ids (`XS0u` messages, `4wTQ` loader, `UiPd` profiles, `JWY6` names, `QPNp` with the
  `ConvInfoDataManager` getter), a fake `groupManager`, and the single-tab and hidden-chat keys in
  fake local and session storage. Module `0Nn1` has a getter that counts calls: every test that
  reads checks it was never run (the safety rule of [ZALO.md](ZALO.md)).
- **The real content script.** `normalize.js` and `content.js` run in a second `vm` context
  standing for the isolated world; a small bus carries `window.postMessage` between the two
  contexts. A tab reload destroys the content-script context and starts a fresh one; the job must
  resume from storage.
- **Fake Zalo data.** Chats are built with the fixtures; the account's own messages carry
  `fromUid "0"`, as Zalo stores them. A test changes the fake store between runs (removes, recalls,
  edits, adds older history) and checks the archive and the files.
- **Time.** The worker's `Date.now` can be moved forward (`clock.skew`) to reach the 3-minute stall
  rule without waiting; the test's own waits use `performance.now`, which the skew does not touch.
  Timers are `unref`ed so the worker's 60 s sweep does not keep Node running.

### Habits

- For a bug found live, first write the test that fails, then fix it. The live bugs found so far
  (`fromUid "0"`, `/no/jxl/` photos, the stalled download) each have a test now.
- Fixtures hold made-up content only. Never paste real messages, names, ids or photo addresses
  into a test.

## The user guide's pictures

```
npm run guide-images    # about 1.5 minutes; writes docs/userguide/images/
```

`scripts/guide/shoot.mjs` runs the real extension in a separate, headless Chrome for Testing
(Playwright's copy in `~/.cache/ms-playwright`, or `CHROME=/path`) against a stand-in chat.zalo.me
with made-up chats, and records what a person would see:

- **Isolated.** The demo Chrome has its own profile and download folder in a temporary directory.
  `--host-resolver-rules` sends chat.zalo.me and Zalo's file servers to a local HTTPS server
  (self-signed, `--ignore-certificate-errors`) and every other host name to nothing, so no request
  reaches Zalo and nothing lands in `~/Downloads`. It never touches the owner's Chrome.
- **The stand-in** (`scripts/guide/demo/`): `zalo.html` + `zalo.js` draw a plain chat page and put
  the fake data layer of the simulation behind it (webpack chunk list, the same modules), a little
  slow on purpose; `chats.js` builds the demo chats with the test fixtures (a scripted trip group
  with photos, a PDF and a video, plus generated chats); `photos.js` paints the demo photos on a
  canvas; ffmpeg makes the video; the PDF is written by hand.
- **The scenes**: Scan and pick chats (`scan.gif`); "+ Photos", Start, progress, log
  (`export.gif`, with `panel-progress.png` taken halfway); Stop during the downloads, then Resume
  (`stop-resume.gif`); then Zalo recalls one message and loses another, and a second export keeps
  both, marked (`export-html.png`, `export-txt.png`). `cursor.js` draws the pointer; `frame.html`
  draws a browser window around the Zalo page and the panel (`overview.png`); `install.png` is
  chrome://extensions with the steps marked.
- It is also an end-to-end check in a real browser: the real panel, content scripts, service worker,
  downloads and export files, against a fake Zalo.
- The pictures change on every run (dates, times): look at each one before committing.
- A made-up name can happen to be the name of one of the owner's contacts or chats. After changing
  the demo chats, run `privacy-scan.mjs` ([Tools](#tools)) and replace any name it flags.

Pitfalls met while writing it: `Page.captureScreenshot` clips are in page coordinates (add
`scrollY`); the exported HTML's images are `loading="lazy"` and never finish off-screen unless made
eager; headless Chrome started in dark mode until `prefers-color-scheme` was emulated; ffmpeg 4.4
knows `-vsync vfr`, not `-fps_mode`; branded Chrome 137+ ignores `--load-extension`, Chrome for
Testing does not.

### The store's pictures and the demo video

```
npm run store-assets    # about 2 minutes; writes docs/store/ and dist/chatkeep-demo.mp4
```

The same run with `--store`: the guide's pictures stay in the work folder, and the kept recordings
and stills become the Chrome Web Store's pictures and the demo video:

- `docs/store/screenshot-1…5-*.png` (1280×800): `frame.html` drawn at 1440×900 with a caption and
  scaled down (the clip's `scale`), the fifth from `cards.html` (the exported HTML and TXT);
  `docs/store/promo-440x280.png`, the small promo tile, from `cards.html`.
- `dist/chatkeep-demo.mp4` (1920×1080, 30 fps, about 75 s, git-ignored): a title card, the panel's
  recorded screens laid over a 1600×900 `frame.html` (the Zalo page is shot again at that width),
  a caption per scene, the exports, an end card; drawn at 1600×900 and scaled up.
- The first export's downloads are slowed to 0.6–1.1 s each: the job reports its progress at most
  every 0.7 s, so faster downloads could finish before the halfway still (the wait timed out once).
- Look at every picture and a contact sheet of the video before uploading them.


