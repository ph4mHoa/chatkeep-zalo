// Chats module: turns a Zalo message record (as Zalo Web's data layer returns it, decrypted) into
// the archive's message record. A classic script shared by the content script (globalThis in the
// isolated world) and the unit tests. Field meanings are in docs/ZALO.md.
(() => {
  'use strict';

  // Zalo's msgType values (constants in Zalo Web's code).
  const T = {
    TEXT: 1, PHOTO: 2, VOICE: 3, STICKER: 4, DOODLE: 5, LINK: 6, GIF: 7, PHOTO_2: 11, STICKER_2: 13,
    LOCATION: 17, VIDEO: 18, FILE: 19, RECALLED: 20, CARDS: 21, FOLDER: 23, ECARD: 25, POLL: 26,
    CALL: 601, DELETED_FOR_ALL: -27,
  };
  const ZINSTANT = [27, 52, 53];

  const parse = v => {
    if (v == null || v === '') return null;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return null; }
  };
  const str = v => (v == null ? '' : String(v));
  const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
  const clean = o => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]; return o; };
  const firstUrl = (...list) => list.find(u => typeof u === 'string' && /^https?:\/\//.test(u)) || null;
  const uniqUrls = list => [...new Set(list.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)))];

  // Zalo serves photos as JPEG XL (.../gr/jxl/<hash>/<name>.jxl, also /no/jxl/), which Chrome
  // cannot show. The same photo as a JPEG is at .../gr/jpg/<hash>/<name>.jpg: both the folder and
  // the extension change (changing only the extension returns the JPEG XL file).
  function jpegUrl(url) {
    if (typeof url !== 'string' || !/\/jxl\/[^?#]*\.jxl(?=$|[?#])/.test(url)) return null;
    return url.replace('/jxl/', '/jpg/').replace(/\.jxl(?=$|[?#])/, '.jpg');
  }

  // Formatted text keeps Zalo's style ranges ({start, len, st}); b, i, u and s are exported.
  function styleRanges(params) {
    const list = params && Array.isArray(params.styles) ? params.styles : [];
    const out = [];
    for (const s of list) {
      const start = Number(s.start), len = Number(s.len);
      if (!Number.isInteger(start) || !Number.isInteger(len) || len <= 0) continue;
      for (const st of str(s.st).split(',')) if (['b', 'i', 'u', 's'].includes(st.trim())) out.push({ start, len, st: st.trim() });
    }
    return out.length ? out : undefined;
  }

  // Some text inside Zalo's rich cards: the first non-empty string, looking a few levels deep.
  function someText(v, depth = 0) {
    if (typeof v === 'string') return v.trim();
    if (!v || typeof v !== 'object' || depth > 3) return '';
    const obj = Array.isArray(v) ? v : ['vi', 'en', 'text', 'title', 'msg', 'content', 'desc', 'description'].map(k => v[k]).concat(Object.values(v));
    for (const x of obj) { const t = someText(x, depth + 1); if (t && !/^https?:\/\//.test(t)) return t; }
    return '';
  }

  function quoteOf(q) {
    if (!q || typeof q !== 'object') return undefined;
    const attach = parse(q.attach);
    let text = typeof q.msg === 'string' ? q.msg : '';
    if (!text && attach && typeof attach === 'object') text = str(attach.title || attach.description);
    return clean({
      id: str(q.globalMsgId) || undefined,
      senderId: str(q.ownerId) || undefined,
      senderName: str(q.fromD) || undefined,
      text: text || undefined,
      ts: num(q.ts),
      type: q.cliMsgType != null ? Number(q.cliMsgType) : undefined,
      hasMedia: attach && typeof attach === 'object' && (attach.thumbUrl || attach.href || attach.oriUrl) ? true : undefined,
    });
  }

  function forwarded(raw) {
    const ref = parse(raw.reference);
    const data = ref && parse(ref.data);
    return !!(data && Number(data.fwLvl) >= 2);
  }

  function mentionsOf(raw) {
    const list = Array.isArray(raw.mentions) ? raw.mentions : parse(raw.mentions);
    if (!Array.isArray(list) || !list.length) return undefined;
    const out = list
      .map(x => ({ uid: str(x.uid), pos: Number(x.pos), len: Number(x.len), type: Number(x.type) || 0 }))
      .filter(x => x.uid && Number.isInteger(x.pos) && Number.isInteger(x.len) && x.len > 0);
    return out.length ? out : undefined;
  }

  // `me` is the account's own id: Zalo's local store marks the account's own messages with
  // fromUid "0" (quotes and mentions use the real id).
  function normalizeMessage(raw, convId, me) {
    if (!raw || raw.msgId == null || raw.sendDttm == null) return null;
    const ts = Number(raw.sendDttm);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const type = Number(raw.msgType);
    const id = str(raw.msgId);
    const c = typeof raw.message === 'string' || Array.isArray(raw.message) ? raw.message : raw.message || {};
    const obj = c && typeof c === 'object' && !Array.isArray(c) ? c : {};
    const params = parse(obj.params) || {};
    const rec = {
      id,
      convId: str(convId || raw.toUid),
      ts,
      cliMsgId: str(raw.cliMsgId) || undefined,
      type,
      kind: 'other',
      senderId: str(raw.fromUid) === '0' && me ? str(me) : str(raw.fromUid),
      senderName: str(raw.dName) || undefined,
      text: null,
    };
    const att = (kind, fields) => ({ id, kind, ...clean(fields) });

    switch (type) {
      case T.TEXT:
        rec.kind = 'text';
        if (typeof c === 'string') rec.text = c;
        else { rec.text = str(obj.title) || null; rec.styles = styleRanges(params); }
        break;
      case T.PHOTO: case T.PHOTO_2: case T.DOODLE: {
        rec.kind = 'photo';
        const urls = uniqUrls([obj.hdUrl, params.hd, obj.oriUrl, obj.normalUrl, obj.href]);
        rec.text = str(obj.title || obj.description) || null;
        if (urls.length) rec.attachments = [att('photo', { url: urls[0], alts: urls.length > 1 ? urls.slice(1) : undefined, thumb: firstUrl(obj.thumbUrl, obj.thumb), width: num(params.width), height: num(params.height) })];
        break;
      }
      case T.GIF: {
        rec.kind = 'gif';
        const urls = uniqUrls([obj.oriUrl, obj.hdUrl, params.hd, obj.normalUrl, obj.href]);
        if (urls.length) rec.attachments = [att('gif', { url: urls[0], alts: urls.length > 1 ? urls.slice(1) : undefined, thumb: firstUrl(obj.thumbUrl), width: num(params.width), height: num(params.height), size: num(params.fileSize) })];
        rec.text = str(obj.title) || null;
        break;
      }
      case T.VIDEO: {
        rec.kind = 'video';
        const url = firstUrl(obj.oriUrl, obj.href, obj.hdUrl, obj.normalUrl);
        const dur = num(obj.duration) || num(params.duration);
        if (url) rec.attachments = [att('video', { url, thumb: firstUrl(obj.thumbUrl, obj.thumb), width: num(params.video_width), height: num(params.video_height), durationMs: dur, size: num(params.fileSize) })];
        rec.text = str(obj.title || obj.description) || null;
        break;
      }
      case T.VOICE: {
        rec.kind = 'voice';
        const url = firstUrl(obj.href, obj.oriUrl);
        const dur = num(params.duration) || num(obj.duration);
        if (url) rec.attachments = [att('voice', { url, durationMs: dur, size: num(params.fileSize) })];
        break;
      }
      case T.FILE: {
        rec.kind = 'file';
        const url = firstUrl(obj.href, obj.oriUrl);
        const name = str(obj.title) || (params.fileExt ? `file.${params.fileExt}` : 'file');
        rec.attachments = [att('file', { url, filename: name, size: num(params.fileSize), ext: str(params.fileExt).toLowerCase() || undefined })];
        break;
      }
      case T.STICKER: case T.STICKER_2:
        rec.kind = 'sticker';
        rec.sticker = clean({ catId: num(obj.catId), id: num(obj.id) });
        break;
      case T.LINK: {
        const action = str(obj.action);
        if (/user/.test(action)) {
          rec.kind = 'contact';
          rec.contact = clean({ name: str(obj.title) || undefined, description: str(obj.description) || undefined, uid: str(params.uid || params.userId) || undefined });
          rec.text = str(obj.title) || null;
        } else {
          rec.kind = 'link';
          rec.text = str(obj.title) || str(obj.href) || null;
          rec.link = clean({ url: firstUrl(obj.href, params.href) || undefined, title: str(params.mediaTitle) || undefined, description: str(obj.description) || undefined, thumb: firstUrl(obj.thumb) || undefined });
        }
        break;
      }
      case T.CARDS: {
        rec.kind = 'cards';
        const list = Array.isArray(c) ? c : [];
        rec.cards = list.map(x => clean({ title: str(x && x.title) || undefined, url: firstUrl(x && x.href) || undefined, description: str(x && x.description) || undefined })).filter(x => x.title || x.url);
        if (!rec.cards.length) delete rec.cards;
        break;
      }
      case T.LOCATION: {
        rec.kind = 'location';
        const lat = Number(obj.latitude ?? obj.lat ?? params.latitude ?? params.lat);
        const lng = Number(obj.longitude ?? obj.long ?? obj.lng ?? params.longitude ?? params.long ?? params.lng);
        rec.location = clean({ lat: Number.isFinite(lat) && lat ? lat : undefined, lng: Number.isFinite(lng) && lng ? lng : undefined, title: str(obj.title || obj.description) || undefined });
        rec.text = str(obj.title || obj.description) || null;
        break;
      }
      case T.CALL: {
        rec.kind = 'call';
        const secs = Number(params.duration ?? params.callDuration ?? obj.duration);
        rec.call = clean({ durationSec: Number.isFinite(secs) && secs > 0 ? secs : undefined, video: params.calltype != null ? Number(params.calltype) === 1 : undefined, reason: params.reason != null ? Number(params.reason) : undefined });
        rec.text = str(obj.title) || null;
        break;
      }
      case T.POLL:
        rec.kind = 'poll';
        rec.text = str(obj.title || params.question) || null;
        break;
      case T.RECALLED: case T.DELETED_FOR_ALL:
        rec.kind = 'recalled';
        rec.recalled = true;
        break;
      default:
        rec.kind = ZINSTANT.includes(type) ? 'card' : type === T.FOLDER ? 'folder' : type === T.ECARD ? 'ecard' : 'other';
        rec.text = typeof c === 'string' ? c || null : someText(params.customMsg) || str(obj.title || obj.description) || someText(obj) || null;
    }

    const q = quoteOf(raw.quote);
    if (q && (q.id || q.text)) rec.replyTo = q;
    const mentions = mentionsOf(raw);
    if (mentions) rec.mentions = mentions;
    if (forwarded(raw)) rec.isForwarded = true;
    if (Number(raw.ttl) > 0) rec.ttl = Number(raw.ttl);
    return clean(rec);
  }

  // Every account id a message names: its sender, the author it quotes, the people it mentions.
  function uidsOf(m) {
    const out = [];
    if (m.senderId && m.senderId !== '0') out.push(m.senderId);
    if (m.replyTo && m.replyTo.senderId && m.replyTo.senderId !== '0') out.push(m.replyTo.senderId);
    for (const x of m.mentions || []) if (x.uid && x.uid !== '-1' && x.uid !== '0') out.push(x.uid);
    return out;
  }

  globalThis.ZLXNormalize = { normalizeMessage, jpegUrl, uidsOf, T };
})();
