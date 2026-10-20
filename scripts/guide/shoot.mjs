// Makes the pictures of the user guide (docs/userguide/images/). The real extension runs in a
// separate, headless Chrome for Testing against a stand-in chat.zalo.me with made-up chats
// (demo/); a drawn pointer clicks through the side panel, and the screens become PNGs and GIFs.
// Nothing touches a real Zalo account or another browser: the demo Chrome has its own profile and
// download folder, and every host name except the stand-in ones resolves to nothing.
//
// With --store (npm run store-assets) the same run makes the Chrome Web Store's pictures instead
// (docs/store/: five 1280×800 screenshots and the 440×280 promo tile) and the demo video
// (dist/chatkeep-demo.mp4, 1920×1080); the guide's pictures then stay in the work folder.
//
// usage: npm run guide-images [-- --out <dir>] [-- --work <empty dir>] [-- --keep]
//        npm run store-assets [-- --work <empty dir>] [-- --keep]
// needs: Chrome for Testing (CHROME=/path/to/chrome, or Playwright's copy in ~/.cache/ms-playwright),
//        ffmpeg (with libx264 for the video) and openssl on the PATH.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const EXT = path.join(ROOT, 'extension');
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const OWN_WORK = !arg('--work');
const WORK = OWN_WORK ? fs.mkdtempSync(path.join(os.tmpdir(), 'zlx-guide-')) : path.resolve(arg('--work'));
const KEEP = argv.includes('--keep');
const STORE = argv.includes('--store');
const OUT = path.resolve(arg('--out', STORE ? path.join(WORK, 'guide') : path.join(ROOT, 'docs/userguide/images')));
const STORE_OUT = path.join(ROOT, 'docs/store'), VIDEO = path.join(ROOT, 'dist/chatkeep-demo.mp4');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

const PANEL = { w: 400, h: 781 }, ZALO = { w: 1039, h: 817 };
const TRIP = 'g8000000000000000101';

// ---------- the stand-in servers ----------
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), '.cache/ms-playwright');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  for (const d of dirs) for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) if (fs.existsSync(path.join(base, d, sub))) return path.join(base, d, sub);
  throw new Error('Chrome for Testing not found: set CHROME=/path/to/chrome ("npx playwright install chromium" puts one in ~/.cache/ms-playwright)');
}

function certificate() {
  const key = path.join(WORK, 'key.pem'), cert = path.join(WORK, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=chat.zalo.me'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
// chat.zalo.me serves the stand-in page; Zalo's file servers serve the demo media, a little slowly.
function startServer(media) {
  const server = https.createServer(certificate(), async (req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    const { pathname } = new URL(req.url, 'https://x');
    const send = (file, type) => { res.writeHead(200, { 'content-type': type || TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res); };
    const missing = () => { res.writeHead(404); res.end(); };
    if (host === 'chat.zalo.me') {
      if (pathname === '/') return send(path.join(HERE, 'demo/zalo.html'));
      if (pathname === '/fixtures/zalo.mjs') return send(path.join(ROOT, 'test/fixtures/zalo.mjs'));
      const file = path.join(HERE, 'demo', path.basename(pathname));
      return pathname.startsWith('/demo/') && fs.existsSync(file) ? send(file) : missing();
    }
    await sleep(media.slow[0] + Math.random() * (media.slow[1] - media.slow[0]));
    const pic = /\/jpg\/.*?(\d+)x\d+/.exec(pathname);
    if (/zdn\.vn$/.test(host) && pic && media.photos[pic[1]]) return send(media.photos[pic[1]], 'image/jpeg');
    if (/dlfl\.vn$/.test(host)) return send(media.pdf, 'application/pdf');
    if (/dlmd\.me$/.test(host)) return send(media.video, 'video/mp4');
    return missing();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

function tinyPdf(lines) {
  const body = lines.map((l, i) => `BT /F1 ${i ? 14 : 22} Tf 72 ${760 - i * 34} Td (${l}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return `${out}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

// ---------- Chrome and the DevTools protocol ----------
async function launch(port) {
  const profile = path.join(WORK, 'profile'), downloads = path.join(WORK, 'Downloads');
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true } }));
  const rules = ['chat.zalo.me', '*.zdn.vn', '*.dlmd.me', '*.dlfl.vn'].map(h => `MAP ${h} 127.0.0.1:${port}`).concat('MAP * ~NOTFOUND').join(', ');
  const proc = spawn(findChrome(), [
    '--headless=new', '--no-sandbox', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, `--host-resolver-rules=${rules}`, '--ignore-certificate-errors',
    '--lang=en-US', '--hide-scrollbars', '--force-color-profile=srgb', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--password-store=basic', '--use-mock-keychain',
    '--window-size=1280,900', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const ws = await new Promise((resolve, reject) => {
    let err = '';
    proc.stderr.on('data', d => { err += d; const m = /DevTools listening on (ws:\S+)/.exec(err); if (m) resolve(m[1]); });
    proc.on('exit', code => reject(new Error(`Chrome exited (${code}): ${err.slice(-400)}`)));
  });
  return { proc, ws, downloads };
}

class Browser {
  constructor(url) { this.url = url; this.seq = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error('cannot reach the demo Chrome')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      const p = m.id && this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async open(url, width, height) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', newWindow: true, width, height });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, targetId, sessionId);
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    if (url !== 'about:blank') {
      await page.send('Page.navigate', { url });
      await page.waitFor(`location.href !== 'about:blank' && document.readyState === 'complete'`, 30000, `${url} to load`);
    }
    return page;
  }
  async extensionId() {
    for (let i = 0; i < 100; i++) {
      const { targetInfos } = await this.send('Target.getTargets');
      const sw = targetInfos.find(t => t.type === 'service_worker' && /^chrome-extension:\/\/\w+\/sw\.js$/.test(t.url));
      if (sw) return new URL(sw.url).host;
      await sleep(200);
    }
    throw new Error('the extension did not load');
  }
}

class Page {
  constructor(browser, targetId, sessionId) { Object.assign(this, { browser, targetId, sessionId }); }
  send(method, params) { return this.browser.send(method, params, this.sessionId); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`in the page: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`);
    return r.result.value;
  }
  async waitFor(expression, ms, what) {
    const end = Date.now() + ms;
    for (;;) {
      try { if (await this.eval(expression)) return; } catch { /* not there yet */ }
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  }
  async png(clip) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { scale: 1, ...clip } } : {}) });
    return Buffer.from(data, 'base64');
  }
  close() { return this.browser.send('Target.closeTarget', { targetId: this.targetId }); }
}

// ---------- recording ----------
// Screens are captured about 14 times a second; `speed` shortens waits in the GIF, `pause`
// leaves a gap (the previous screen stays) while a still is taken.
function record(page) {
  const frames = [];
  let on = true, paused = false, speed = 1;
  const loop = (async () => {
    while (on) {
      const t = performance.now();
      if (paused) frames.push({ t, data: null, speed });
      else frames.push({ t, data: (await page.send('Page.captureScreenshot', { format: 'png' })).data, speed });
      await sleep(Math.max(0, 70 - (performance.now() - t)));
    }
  })();
  return {
    speed: v => { speed = v; },
    pause: () => { paused = true; },
    resume: () => { paused = false; },
    async stop() { on = false; await loop; return frames; },
  };
}

// Writes the frames as numbered PNGs with an ffmpeg concat list that keeps their timing.
function frameList(frames, prefix, hold) {
  const dir = fs.mkdtempSync(path.join(WORK, prefix));
  const list = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    const dur = next ? (next.t - f.t) / 1000 / f.speed : hold;
    const last = list[list.length - 1];
    if (last && (f.data === null || f.data === last.data)) last.dur += dur;
    else if (f.data !== null) list.push({ data: f.data, dur });
  });
  list[list.length - 1].dur = Math.max(list[list.length - 1].dur, hold);
  let concat = '';
  list.forEach((f, i) => {
    const file = `f${String(i).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64'));
    concat += `file '${file}'\nduration ${Math.max(0.03, f.dur).toFixed(3)}\n`;
  });
  concat += `file 'f${String(list.length - 1).padStart(4, '0')}.png'\n`;
  fs.writeFileSync(path.join(dir, 'list.txt'), concat);
  return { list: path.join(dir, 'list.txt'), count: list.length, seconds: list.reduce((s, f) => s + f.dur, 0) };
}
function writeGif(frames, name, { hold = 2.5, colors = 96 } = {}) {
  const { list, count, seconds } = frameList(frames, 'gif-', hold);
  const out = path.join(OUT, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
    '-vsync', 'vfr', '-loop', '0', out]);
  log(`${name}: ${count} frames, ${seconds.toFixed(1)} s, ${Math.round(fs.statSync(out).size / 1024)} KB`);
}
function savePng(name, png) {
  fs.writeFileSync(path.join(OUT, name), png);
  log(`${name}: ${Math.round(png.length / 1024)} KB`);
}

// ---------- acting in the panel ----------
const $ = sel => `document.querySelector(${JSON.stringify(sel)})`;
const row = name => `[...document.querySelectorAll('#convs li')].find(li => li.querySelector('.t-title').textContent === ${JSON.stringify(name)})`;
const radio = (name, value) => `document.querySelector('input[name=${name}][value=${value}]').closest('label')`;
const job = `chrome.storage.local.get('chats.job').then(r => r['chats.job'] || {})`;

// Moves the drawn pointer to an element (scrolling it into view first, as a person would) and clicks it.
async function point(page, target, { click = true, pause = 180, after = 420 } = {}) {
  const at = await page.eval(`(async () => {
    const el = ${target};
    if (!el) throw new Error('not found: ' + ${JSON.stringify(target)});
    let r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight - 40) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await new Promise(res => setTimeout(res, 800));
      r = el.getBoundingClientRect();
    }
    return { x: Math.round(r.left + Math.min(r.width / 2, 44)), y: Math.round(r.top + r.height / 2) };
  })()`);
  await page.eval(`__cur.moveTo(${at.x}, ${at.y})`);
  await sleep(pause);
  if (click) await page.eval(`(() => { __cur.click(); (${target}).click(); })()`);
  await sleep(after);
}
const scrollTo = (page, target, block = 'center') => page.eval(`(async () => { (${target}).scrollIntoView({ block: '${block}', behavior: 'smooth' }); await new Promise(r => setTimeout(r, 800)); })()`);
async function still(page, rec) {
  if (rec) { rec.pause(); await sleep(150); }
  await page.eval('__cur.hide()');
  const png = await page.png();
  await page.eval('__cur.show()');
  if (rec) rec.resume();
  return png;
}
// While a job runs the panel stays scrolled to the bottom, where the progress box grows.
const stick = (page, on) => page.eval(on ? 'window.__stick = setInterval(() => scrollTo(0, document.documentElement.scrollHeight), 200)' : 'clearInterval(window.__stick)');
// The options section with a fuller choice than the defaults (photos, a date range, a file per month), then back.
// Returns the whole panel at that moment, for the store.
async function optionsStill(page) {
  await page.eval(`(() => {
    for (const sel of ['input[name=mode][value=photos]', 'input[name=range][value=custom]', 'input[name=split][value=month]']) document.querySelector(sel).click();
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
    set('from', d.getFullYear() + '-' + p(d.getMonth() + 1) + '-01');
    set('to', d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()));
  })()`);
  const clip = await page.eval(`(async () => {
    const sec = document.querySelectorAll('#views section')[1];
    scrollBy(0, sec.getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom - 8);
    await new Promise(r => setTimeout(r, 300));
    const r = sec.getBoundingClientRect();
    // Screenshot clips are in page coordinates.
    return { x: 0, y: Math.round(r.top - 6 + scrollY), width: innerWidth, height: Math.round(Math.min(r.height + 12, innerHeight - r.top + 6)) };
  })()`);
  await page.eval('__cur.hide()');
  savePng('panel-options.png', await page.png(clip));
  const whole = await page.png();
  await page.eval(`(() => {
    __cur.show();
    for (const sel of ['input[name=mode][value=text]', 'input[name=range][value=all]', 'input[name=split][value=none]']) document.querySelector(sel).click();
    for (const id of ['from', 'to']) { const el = document.getElementById(id); el.value = ''; el.dispatchEvent(new Event('change')); }
    scrollTo(0, 0);
  })()`);
  return whole;
}
const selectOnly = (page, names) => page.eval(`(() => {
  for (const li of document.querySelectorAll('#convs li')) if (li.querySelector('input').checked) li.click();
  for (const n of ${JSON.stringify(names)}) [...document.querySelectorAll('#convs li')].find(li => li.querySelector('.t-title').textContent === n).click();
})()`);

// ---------- the pictures ----------
async function makeMedia(browser, media) {
  const dir = path.join(WORK, 'media');
  fs.mkdirSync(dir);
  const page = await browser.open('about:blank', 200, 200);
  const list = await page.eval(`(() => { ${fs.readFileSync(path.join(HERE, 'demo/photos.js'), 'utf8')}\nreturn drawAll(); })()`);
  await page.close();
  list.forEach((b64, i) => { media.photos[i] = path.join(dir, `photo-${i}.jpg`); fs.writeFileSync(media.photos[i], Buffer.from(b64, 'base64')); });
  media.video = path.join(dir, 'video.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', media.photos[4], '-t', '3', '-r', '24', '-vf', 'scale=640:480,format=yuv420p', '-movflags', '+faststart', media.video]);
  media.pdf = path.join(dir, 'file.pdf');
  fs.writeFileSync(media.pdf, tinyPdf(['Lich trinh Da Lat', 'Ngay 1: Doi che Cau Dat', 'Ngay 2: Ho Tuyen Lam', 'Ngay 3: Cho Da Lat']));
}

// chrome://extensions with Developer mode on, the two things to click marked.
async function shootInstall(browser) {
  const page = await browser.open('chrome://extensions/', 1280, 720);
  await page.waitFor(`!!document.querySelector('extensions-manager')`, 10000, 'chrome://extensions');
  await sleep(500);
  const boxes = await page.eval(`(async () => {
    const mgr = document.querySelector('extensions-manager').shadowRoot;
    const bar = mgr.querySelector('extensions-toolbar').shadowRoot;
    const dev = bar.querySelector('#devMode');
    if (!dev.checked) dev.click();
    await new Promise(r => setTimeout(r, 900));
    const item = mgr.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item');
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const devRow = dev.parentElement && dev.parentElement.getBoundingClientRect().width < 400 ? dev.parentElement : dev;
    return [box(devRow), box(bar.querySelector('#loadUnpacked')), box(item)];
  })()`);
  await page.eval(`(() => {
    const marks = ${JSON.stringify(boxes)};
    marks.forEach((b, i) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;border:3px solid #e8453c;border-radius:10px;left:' + (b.x - 7) + 'px;top:' + (b.y - 7) + 'px;width:' + (b.w + 14) + 'px;height:' + (b.h + 14) + 'px';
      const n = document.createElement('div');
      n.textContent = i + 1;
      n.style.cssText = 'position:absolute;left:-14px;top:-14px;width:26px;height:26px;border-radius:50%;background:#e8453c;color:#fff;font:700 15px/26px system-ui;text-align:center';
      d.append(n);
      document.body.append(d);
    });
  })()`);
  const bottom = Math.min(720, Math.ceil(boxes[2].y + boxes[2].h + 24));
  savePng('install.png', await page.png({ x: 0, y: 0, width: 1280, height: bottom }));
  await page.close();
}

async function shootOverview(browser) {
  fs.copyFileSync(path.join(HERE, 'demo/frame.html'), path.join(WORK, 'frame.html'));
  fs.copyFileSync(path.join(EXT, 'icons/icon32.png'), path.join(WORK, 'icon.png'));
  const page = await browser.open(pathToFileURL(path.join(WORK, 'frame.html')).href, 1440, 900);
  await page.waitFor('[...document.images].every(i => i.complete && i.naturalWidth)', 10000, 'the overview frame');
  savePng('overview.png', await page.png());
  await page.close();
}

// ---------- the store's pictures and the demo video (--store) ----------
const WIDE = 1600; // the video's window: 16:9 at 1600×900, scaled to 1920×1080
const HD = 'scale=1920:1080:flags=lanczos,format=yuv420p';
const encode = (inputs, filter, out) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filter,
  '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', out]);

async function makeStore(browser, scenes, stills) {
  fs.mkdirSync(STORE_OUT, { recursive: true });
  fs.mkdirSync(path.dirname(VIDEO), { recursive: true });
  fs.copyFileSync(path.join(HERE, 'demo/cards.html'), path.join(WORK, 'cards.html'));
  fs.copyFileSync(path.join(EXT, 'icons/icon128.png'), path.join(WORK, 'icon128.png'));
  const files = {
    's-start.png': Buffer.from(scenes.scan.find(f => f.data).data, 'base64'), 's-options.png': stills.options,
    's-progress.png': stills.progress, 's-stopped.png': stills.stopped, 's-html.png': stills.html, 's-txt.png': stills.txt,
  };
  for (const [name, png] of Object.entries(files)) fs.writeFileSync(path.join(WORK, name), png);
  // Draws frame.html or cards.html at w×h; returns the PNG (scaled to `width`) and where the panel sits.
  async function render(file, q, w, h, width = w) {
    const page = await browser.open(`${pathToFileURL(path.join(WORK, file)).href}?${new URLSearchParams(q)}`, w, h);
    await page.waitFor('[...document.images].every(i => i.complete && i.naturalWidth)', 10000, `${file} ${q.card || ''}`);
    await sleep(200);
    const box = await page.eval(`(() => { const r = document.querySelector('.side .shot')?.getBoundingClientRect(); return r && { x: Math.round(r.left), y: Math.round(r.top) }; })()`);
    const png = await page.png({ x: 0, y: 0, width: w, height: h, scale: width / w });
    await page.close();
    return { png, box };
  }

  // Five screenshots drawn at 1440×900, like the guide's overview, and scaled to 1280×800.
  const shots = [
    ['1-overview', 'frame.html', { caption: 'Save the Zalo chats you choose, from a panel next to Zalo Web' }],
    ['2-progress', 'frame.html', { tip: '0', panel: 's-progress.png', caption: 'Text only, + photos or + all media, with progress in % and a file count' }],
    ['3-options', 'frame.html', { tip: '0', panel: 's-options.png', caption: 'One file per chat, day, week or month, or just a date range' }],
    ['4-stop', 'frame.html', { tip: '0', panel: 's-stopped.png', caption: 'Stop any time, then Resume: nothing saved is read or downloaded again' }],
    ['5-exports', 'cards.html', { card: 'exports', w: '1440' }],
  ];
  for (const [name, file, q] of shots) {
    fs.writeFileSync(path.join(STORE_OUT, `screenshot-${name}.png`), (await render(file, q, 1440, 900, 1280)).png);
    log(`docs/store/screenshot-${name}.png`);
  }
  fs.writeFileSync(path.join(STORE_OUT, 'promo-440x280.png'), (await render('cards.html', { card: 'tile' }, 440, 280)).png);
  log('docs/store/promo-440x280.png');

  // The video: a title, the Zalo page with the panel's recorded screens over it, the exports, an end.
  const dir = fs.mkdtempSync(path.join(WORK, 'video-'));
  const parts = [];
  const next = ext => path.join(dir, `part${parts.length}.${ext}`);
  async function stillPart(file, q, seconds) {
    const png = next('png'), out = next('mp4');
    fs.writeFileSync(png, (await render(file, q, WIDE, 900)).png);
    encode(['-loop', '1', '-framerate', '30', '-t', String(seconds), '-i', png], `[0:v]${HD}`, out);
    parts.push(out);
  }
  async function scenePart(frames, caption) {
    const bg = next('png'), out = next('mp4');
    const { png, box } = await render('frame.html', { w: WIDE, zalo: 'zalo-wide.png', panel: 'none', tip: '0', caption }, WIDE, 900);
    fs.writeFileSync(bg, png);
    const { list } = frameList(frames, 'vframes-', 1.5);
    encode(['-loop', '1', '-framerate', '30', '-i', bg, '-f', 'concat', '-safe', '0', '-i', list],
      `[1:v]fps=30[p];[0:v][p]overlay=${box.x}:${box.y}:shortest=1,${HD}`, out);
    parts.push(out);
  }
  await stillPart('cards.html', { card: 'title', w: WIDE }, 4);
  await stillPart('frame.html', { w: WIDE, zalo: 'zalo-wide.png', panel: 's-start.png', caption: 'Open Zalo Web, then click the ChatKeep icon' }, 3.5);
  await scenePart(scenes.scan, 'Scan lists your chats: tick the ones to save');
  await scenePart(scenes.export, 'Choose text, photos or all media, then Start: progress in % and a file count');
  await scenePart(scenes.resume, 'Stop any time: Resume goes on where it stopped');
  await stillPart('cards.html', { card: 'exports', w: WIDE }, 6);
  await stillPart('cards.html', { card: 'end', w: WIDE }, 4);
  fs.writeFileSync(path.join(dir, 'parts.txt'), parts.map(p => `file '${p}'\n`).join(''));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'parts.txt'), '-c', 'copy', '-movflags', '+faststart', VIDEO]);
  log(`${path.relative(ROOT, VIDEO)}: ${(fs.statSync(VIDEO).size / 1048576).toFixed(1)} MB`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  const media = { photos: {}, pdf: null, video: null, slow: [250, 600] };
  const server = await startServer(media);
  const { proc, ws, downloads } = await launch(server.address().port);
  const browser = new Browser(ws);
  await browser.connect();
  try {
    const extId = await browser.extensionId();
    log('demo Chrome is up; extension', extId);
    await makeMedia(browser, media);

    const zalo = await browser.open('https://chat.zalo.me/', ZALO.w, ZALO.h);
    await zalo.waitFor(`!!window.__demo && document.querySelectorAll('.conv').length > 5 && [...document.images].every(i => i.complete && i.naturalWidth)`, 20000, 'the stand-in Zalo page');
    fs.writeFileSync(path.join(WORK, 'zalo.png'), await zalo.png());
    if (STORE) {
      // The video's wider window shows more of the Zalo page.
      await zalo.send('Emulation.setDeviceMetricsOverride', { width: WIDE - 401, height: ZALO.h, deviceScaleFactor: 1, mobile: false });
      await sleep(500);
      fs.writeFileSync(path.join(WORK, 'zalo-wide.png'), await zalo.png());
      await zalo.send('Emulation.setDeviceMetricsOverride', { width: ZALO.w, height: ZALO.h, deviceScaleFactor: 1, mobile: false });
    }

    await shootInstall(browser);

    const panel = await browser.open(`chrome-extension://${extId}/panel.html`, PANEL.w, PANEL.h);
    await panel.waitFor(`/Zalo ·/.test((document.getElementById('connText') || {}).textContent || '')`, 30000, 'the panel to find Zalo');
    await panel.eval(fs.readFileSync(path.join(HERE, 'demo/cursor.js'), 'utf8'));

    // 1. Scan, then pick three chats. The recordings and some stills are kept for --store.
    const scenes = {}, stills = {};
    let rec = record(panel);
    await sleep(900);
    await point(panel, $('#scan'), { after: 200 });
    await panel.waitFor(`document.querySelectorAll('#convs li').length >= 10`, 30000, 'the chat list');
    await sleep(1000);
    for (const name of ['Nhóm du lịch Đà Lạt', 'Gia đình', 'Lương Diễm Hà']) await point(panel, row(name), { after: 380 });
    await sleep(1200);
    scenes.scan = await rec.stop();
    writeGif(scenes.scan, 'scan.gif');
    fs.writeFileSync(path.join(WORK, 'panel.png'), await still(panel));
    await shootOverview(browser);
    stills.options = await optionsStill(panel);
    await sleep(400);

    // 2. "+ Photos", Start, progress until done, then the log. The downloads are slowed down so
    // that the halfway still is not missed: the job reports its progress at most every 0.7 s.
    media.slow = [600, 1100];
    rec = record(panel);
    await point(panel, radio('mode', 'photos'), { after: 900 });
    await point(panel, $('#start'), { after: 300 });
    await panel.eval(`__cur.moveTo(${PANEL.w - 40}, 110)`);
    await stick(panel, true);
    rec.speed(1.8);
    await panel.waitFor(`${job}.then(j => j.progress && j.progress.phase === 'media' && j.progress.media && j.progress.media.total >= 6 && j.progress.media.done >= j.progress.media.total / 2)`, 90000, 'downloads halfway');
    savePng('panel-progress.png', stills.progress = await still(panel, rec));
    await panel.waitFor(`${job}.then(j => j.status === 'done')`, 180000, 'the export to finish');
    media.slow = [250, 600];
    rec.speed(1);
    await stick(panel, false);
    await sleep(900);
    await point(panel, $('#logBox summary'), { after: 1600 });
    scenes.export = await rec.stop();
    writeGif(scenes.export, 'export.gif');

    // 3. Stop in the middle of the downloads, then Resume.
    await selectOnly(panel, []);
    await panel.eval(`document.getElementById('logBox').open = false; scrollTo(0, 0);`);
    media.slow = [450, 800];
    rec = record(panel);
    await sleep(600);
    for (const name of ['Team Marketing', 'Lớp 12A1 – Họp lớp']) await point(panel, row(name), { after: 350 });
    await point(panel, radio('mode', 'all'), { after: 700 });
    await point(panel, $('#start'), { after: 300 });
    await stick(panel, true);
    rec.speed(2);
    await panel.waitFor(`${job}.then(j => j.progress && j.progress.phase === 'media' && j.progress.media && j.progress.media.done >= 3)`, 90000, 'downloads to start');
    rec.speed(1);
    await stick(panel, false);
    await point(panel, $('#stop'), { after: 300 });
    await panel.waitFor(`${job}.then(j => j.status === 'stopped')`, 30000, 'the job to stop');
    await sleep(600);
    stills.stopped = await still(panel, rec);
    await sleep(1200);
    await point(panel, $('#resume'), { after: 300 });
    await stick(panel, true);
    rec.speed(2);
    await panel.waitFor(`${job}.then(j => j.status === 'done')`, 240000, 'the resumed export to finish');
    rec.speed(1);
    await sleep(1500);
    await stick(panel, false);
    scenes.resume = await rec.stop();
    writeGif(scenes.resume, 'stop-resume.gif');
    media.slow = [250, 600];

    // 4. Zalo loses two messages; the next export keeps them, marked.
    const trip = (await zalo.eval('__demo.chats()')).find(c => c.id === TRIP);
    await zalo.eval(`(() => {
      __demo.recall('${TRIP}', '${trip.demo.recallMe}');
      __demo.remove('${TRIP}', '${trip.demo.deleteMe}');
      __demo.say('${TRIP}', '2000000000000000001', 'Về tới nhà rồi nha cả nhà 🥰', 30);
    })()`);
    await selectOnly(panel, ['Nhóm du lịch Đà Lạt']);
    await panel.eval(`document.querySelector('input[name=mode][value=text]').click(); document.getElementById('start').click();`);
    await panel.waitFor(`${job}.then(j => j.status === 'done' && j.convs.length === 1)`, 60000, 'the second export to finish');

    const root = path.join(downloads, 'Zalo_Export');
    const folder = fs.readdirSync(root).find(d => d.endsWith(`_${TRIP}`));
    const stem = folder.slice(0, -(TRIP.length + 1));
    const html = await browser.open(pathToFileURL(path.join(root, folder, `${stem}.html`)).href, 900, 860);
    await html.eval(`document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; })`);
    await html.waitFor('[...document.images].every(i => i.complete)', 20000, 'the exported pictures');
    await html.eval(`(() => { const f = document.querySelector('.flag'); scrollTo(0, f.getBoundingClientRect().top + scrollY - innerHeight * 0.6); })()`);
    await sleep(500);
    savePng('export-html.png', stills.html = await html.png());
    const txt = await browser.open(pathToFileURL(path.join(root, folder, `${stem}.txt`)).href, 900, 560);
    // The end of the file, starting at a whole line.
    const lines = await txt.eval(`(() => {
      scrollTo(0, document.documentElement.scrollHeight);
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('pre') || document.body);
      const first = [...range.getClientRects()].find(r => r.top >= 0);
      const top = first ? Math.floor(first.top) : 0;
      // An emoji on the line above can reach into the first whole line's space: paint it over.
      const cover = document.createElement('div');
      cover.style.cssText = 'position:fixed;left:0;top:0;width:100%;background:#fff;height:' + top + 'px';
      document.body.append(cover);
      const y = Math.max(0, top - 4);
      return { x: 0, y: y + scrollY, width: innerWidth, height: innerHeight - y };
    })()`);
    savePng('export-txt.png', stills.txt = await txt.png(lines));
    if (STORE) await makeStore(browser, scenes, stills);
  } finally {
    browser.ws.close();
    proc.kill();
    server.close();
    if (KEEP || !OWN_WORK) log('work folder:', WORK);
    else fs.rmSync(WORK, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
