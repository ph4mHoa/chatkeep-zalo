// Synthetic Zalo message records, shaped like the ones Zalo Web's data layer returns (field names
// and value types seen on Zalo Web in September 2026). No real content.

let seq = 0;
// Message ids are 13-digit strings, as in Zalo's own database.
export const nextId = () => String(7000000000000 + ++seq);

export function msg(convId, ts, fromUid, msgType, message, extra = {}) {
  const id = extra.msgId || nextId();
  return {
    msgId: id,
    cliMsgId: String(1750000000000 + Number(id.slice(-6))),
    msgType,
    status: 1,
    notify: '1',
    mentions: '',
    quote: null,
    message,
    sendDttm: String(ts),
    serverTime: String(ts),
    fromUid,
    toUid: convId,
    dName: '',
    localDttm: String(ts),
    properties: { size: 0, type: 0, subType: 0, ext: '{"sSrcType":-1,"sSrcStr":"","msg_warning_type":0}' },
    ttl: 0,
    refMessageId: '',
    st: 3,
    at: 0,
    cmd: 501,
    originMsgType: msgType,
    subState: 0,
    e2eeStatus: 0,
    platformType: 1,
    src: 1,
    ...extra,
    msgId: id,
  };
}

const J = JSON.stringify;
export const photoUrls = key => ({
  hd: `https://photo-stal-1.zdn.vn/gr/jxl/h${key}/hd_${key}.jxl?jxlstatus=1`,
  ori: `https://photo-stal-1.zdn.vn/gr/jxl/o${key}/o_${key}.jxl?jxlstatus=1`,
  normal: `https://photo-stal-1.zdn.vn/gr/jxl/n${key}/n_${key}.jxl?jxlstatus=1`,
  thumb: `https://photo-stal-1.zdn.vn/gr/jxl/t${key}/t_${key}.jxl?jxlstatus=1`,
});

export const content = {
  text: s => [1, s],
  styled: (s, styles) => [1, { action: 'rtf', params: J({ styles, ver: 0 }), title: s, childNumber: 0 }],
  photo: (key, caption = '') => {
    const u = photoUrls(key);
    return [2, { title: caption, description: '', childnumber: 0, action: '', params: J({ width: 1280, convertible: 'jxl', hd: u.hd, height: 960 }), type: '', thumbUrl: u.thumb, oriUrl: u.ori, hdUrl: u.hd, normalUrl: u.normal }];
  },
  // A photo sent in a group of photos: no hdUrl, no params.hd.
  groupPhoto: key => {
    const u = photoUrls(key);
    return [2, { title: '', description: '', childnumber: 0, action: '', params: J({ width: 800, height: 600, is_group_layout: 1, contentId: '1234567890', convertible: 'jxl', is_original: 0 }), type: '', thumbUrl: u.thumb, oriUrl: u.ori, normalUrl: u.normal }];
  },
  gif: key => [7, { title: '', description: '', childnumber: 0, action: '', params: J({ width: 200, height: 150, small: `https://zgif-v1.zdn.vn/s${key}.gif`, contentId: '99', formatType: 1, fileSize: 12345, contentType: 1, hd: `https://zgif-v1.zdn.vn/h${key}.gif` }), type: '', thumbUrl: `https://zgif-v1.zdn.vn/t${key}.png`, oriUrl: `https://zgif-v1.zdn.vn/o${key}.gif`, normalUrl: `https://zgif-v1.zdn.vn/n${key}.gif` }],
  video: key => [18, { action: '', description: '', childnumber: 0, duration: 12000, params: J({ fileSize: 3000000, video_height: 720, video_width: 1280, isHD: 1, video_rotation: 0, duration: 12000 }), oriUrl: `https://video-stal-1.dlmd.me/v${key}`, thumbUrl: `https://photo-stal-1.zdn.vn/vt${key}.jpg`, type: '' }],
  voice: key => [3, { href: `https://voice-stal-1.zdn.vn/a${key}.aac`, params: J({ duration: 8000 }) }],
  file: (key, name = 'report.pdf', size = '50000') => [19, { type: '', action: '', params: J({ fileSize: size, checksum: 'abc', checksumSha: 'def', fileExt: name.split('.').pop(), fdata: '{}', fType: 1 }), title: name, href: `https://file-stal-1.dlfl.vn/f${key}`, thumb: '', description: '', childNumber: 0, childnumber: 0 }],
  sticker: () => [4, { type: '7', extInfo: J({ params: '{}' }), catId: 10, id: 1234, childNumber: 0 }],
  link: url => [6, { action: 'recommened.link', params: J({ streamUrl: '', mediaTitle: 'Page title', stream_icon: '', tType: 0, src: 'web', artist: '', tHeight: 0, type: 0, tWidth: 0 }), title: url, href: url, thumb: 'https://photo-stal-1.zdn.vn/l.jpg', description: 'Page description', childNumber: 0 }],
  contact: name => [6, { action: 'recommened.user', params: J({ type: 0 }), title: name, href: '', thumb: '', description: '', childNumber: 0 }],
  cards: () => [21, [
    { type: 'x', title: 'News one', href: 'https://example.com/news/1.epi', thumb: 'https://example.com/1.jpg', description: 'first', childNumber: 0 },
    { type: 'x', title: 'News two', href: 'https://example.com/news/2.epi', thumb: 'https://example.com/2.jpg', description: 'second', childNumber: 0 },
  ]],
  location: () => [17, { title: 'Ben Thanh Market', description: 'District 1', params: J({ latitude: 10.7725, longitude: 106.698 }) }],
  call: secs => [601, { action: 'recommened.calltime', params: J({ duration: secs, calltype: 0, reason: 0 }), title: '' }],
  poll: q => [26, { title: q, params: J({ options: [] }) }],
  recalled: () => [20, { msgId: '0' }],
  zinstant: () => [52, { action: '', params: J({ item: { version: 1, data_type: 1, data_url: 'https://zinst-stc.zadn.vn/x' }, type: 1, customMsg: { msg: { vi: 'Nhắc hẹn: họp nhóm', en: 'Reminder: team meeting' }, highLightsV2: [] } }), title: '', href: '', thumb: '', description: '', childnumber: 0 }],
};

export const quote = (target, ownerName, extra = {}) => ({
  ownerId: target.fromUid,
  msg: typeof target.message === 'string' ? target.message : '',
  attach: '',
  fromD: ownerName,
  ts: Number(target.sendDttm),
  cliMsgId: Number(target.cliMsgId),
  globalMsgId: Number(target.msgId),
  cliMsgType: target.msgType,
  ...extra,
});
export const forwardedRef = () => ({ type: 3, data: J({ fwLvl: 2 }) });
