// Made-up chats for the user guide's pictures. Every name, message, link and picture is invented;
// the records have the shapes Zalo Web's data layer returns (built with the test fixtures).
import { msg, content, quote } from '/fixtures/zalo.mjs';

export const ME = '1000000000000000001';
export const ME_NAME = 'Diệp Chi';
const uid = n => `2000000000000000${String(n).padStart(3, '0')}`;

// Display names Zalo knows (friends and cached profiles), and a few only its profile service knows.
export const names = new Map([[ME, ME_NAME]]);
export const profileOnly = new Map();
const person = (n, name, known = true) => { const id = uid(n); (known ? names : profileOnly).set(id, name); return id; };

const P = {
  ha: person(1, 'Lương Diễm Hà'), bao: person(2, 'Mạc Đình Bảo'), linh: person(3, 'Hứa Tuệ Linh'),
  nam: person(4, 'Lê Hoàng Nam'), huy: person(5, 'Hoàng Gia Huy'), vy: person(6, 'Đặng Thảo Vy'),
  bo: person(10, 'Bố'), meMom: person(11, 'Mẹ'), chi: person(12, 'Chị Quyên'), khai: person(13, 'Anh Khải'), soc: person(14, 'Bé Sóc'),
  hung: person(20, 'Nguyễn Văn Hùng'),
};
const team = ['Lạc Vân Khánh', 'Doãn Trí Viễn', 'Khúc Hạ Lan', 'Tăng Vĩ Khang', 'Mẫn Cát Tường', 'Nghiêm Triều Dương', 'Thân Khuê Tú', 'Quan Hữu Lễ', 'Giang Dạ Thảo', 'Âu Minh Triết']
  .map((n, i) => person(30 + i, n));
const classmates = ['Kha Mộng Tuyền', 'Lục Gia Khiêm', 'Yên Hoài Thương', 'Tiêu Bảo Trâm', 'Ứng Đình Phong', 'Mã Uyển Nhi', 'La Thế Hiển', 'Hầu Thiên Nga', 'Thái Khắc Trung', 'Vương Diệu Hiền', 'Ninh Hạo Nhiên', 'Lều Ý Vân']
  .map((n, i) => person(60 + i, n));
const runners = ['Hà Sub3', 'Tín Ultra', 'Mơ Pacer', 'Lộc Tempo', 'Quyên 5K', 'Đạt Tốc Độ', 'Vân Chạy Đêm', 'Kỳ Half', 'Thu Sneaker', 'Bửu Trail']
  .map((n, i) => person(90 + i, n))
  .concat(['Thùy Trang', 'Bảo Long', 'Kim Chi', 'Hữu Nghĩa', 'Minh Thư', 'Đức Thắng'].map((n, i) => person(120 + i, n, false)));

// Deterministic randomness, so every run makes the same chats.
let seed = 20260925;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = list => list[Math.floor(rnd() * list.length)];

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
let picSeq = 0;
// Photo URLs carry the picture number: the demo server answers /gr/jpg/…<n>x<seq>… with picture n.
const picKey = n => `${n}x${++picSeq}`;
export const PICTURES = { tea: 0, mist: 1, mist2: 2, lake: 3, pines: 4, flowers: 5, sunset: 6, beach: 7, city: 8, lake2: 9, tea2: 10, flowers2: 11 };

function photoMsg(convId, ts, from, pic, caption = '') {
  const [type, body] = content.photo(picKey(pic), caption);
  return msg(convId, ts, from, type, body);
}
const fileMsg = (convId, ts, from, name, size) => { const [t, b] = content.file(`${name.length}${++picSeq}`, name, String(size)); return msg(convId, ts, from, t, b); };
const textMsg = (convId, ts, from, text, extra) => msg(convId, ts, from, 1, text, extra);
const linkMsg = (convId, ts, from, url, title, description) => msg(convId, ts, from, 6, {
  action: 'recommened.link', params: JSON.stringify({ mediaTitle: title, src: 'web', type: 0 }), title: url, href: url, thumb: '', description, childNumber: 0,
});
const quoteOf = (target, extra = {}) => ({ ...quote(target, displayName(target.fromUid)), ownerId: target.fromUid === '0' ? ME : target.fromUid, ...extra });
const displayName = u => (u === '0' ? ME_NAME : names.get(u) || profileOnly.get(u) || '');
const mentionOf = (text, id) => {
  const label = id === '-1' ? '@All' : `@${displayName(id)}`;
  return { uid: id, pos: text.indexOf(label), len: label.length, type: id === '-1' ? 1 : 0 };
};

// ---------- the showcase: a trip, fully scripted ----------
function tripChat(convId, day0) {
  const out = [];
  const at = (d, hm, s = 0) => { const [h, m] = hm.split(':').map(Number); return day0 + d * DAY + h * HOUR + m * MIN + s * 1000; };
  const add = m => { out.push(m); return m; };
  const t = (d, hm, from, text, extra) => add(textMsg(convId, at(d, hm), from, text, extra));
  const ME0 = '0';
  t(-9, '20:05', P.ha, 'Cả nhà ơi, tháng sau đi Đà Lạt không? 🌲');
  t(-9, '20:07', P.bao, 'Đi chứ! Cuối tháng mình rảnh');
  t(-9, '20:09', P.linh, 'Mình đi được, nhưng chỉ 3 ngày thôi nha');
  t(-9, '20:12', ME0, 'Ok, để mình lên lịch trình nhé');
  add(msg(convId, at(-9, '20:15'), P.nam, ...content.poll('Mọi người muốn đi ngày nào?')));
  t(-9, '21:02', P.huy, 'Chốt 22–24 nha, mình đặt xe giường nằm');
  const plan = add(fileMsg(convId, at(-8, '09:30'), ME0, 'Lịch trình Đà Lạt.pdf', 184320));
  const allText = '@All mọi người xem lịch trình góp ý giúp mình nha';
  t(-8, '09:31', ME0, allText, { mentions: [mentionOf(allText, '-1')] });
  const ask = t(-8, '09:40', P.vy, 'Thêm Hồ Tuyền Lâm vào được không?', { quote: quoteOf(plan, { attach: JSON.stringify({ title: 'Lịch trình Đà Lạt.pdf' }) }) });
  t(-8, '09:42', ME0, 'Được luôn, mình thêm vào ngày 2 👍', { quote: quoteOf(ask) });
  add(linkMsg(convId, at(-8, '10:15'), P.huy, 'https://example.com/homestay-thong-xanh', 'Homestay Thông Xanh – view đồi thông', 'Phòng ấm, có bếp chung, cách chợ 2 km'));
  t(-8, '10:16', P.huy, 'Homestay này view đồi thông, 350k/người/đêm');
  add(msg(convId, at(-8, '10:20'), P.bao, ...content.sticker()));
  t(-6, '19:45', P.linh, 'Nhớ mang áo ấm nha, đêm xuống 14 độ đó');
  const charger = `@${displayName(P.bao)} nhớ mang sạc dự phòng nha`;
  t(-6, '19:50', P.nam, charger, { mentions: [mentionOf(charger, P.bao)] });
  t(-6, '19:52', P.bao, 'Ok luôn 👌');
  t(-3, '22:10', P.ha, 'Xe chạy rồi, sáng mai gặp Đà Lạt nha!');
  const tea = add(photoMsg(convId, at(-2, '06:05'), P.ha, PICTURES.tea, 'Đồi chè Cầu Đất sáng nay'));
  t(-2, '06:07', P.vy, 'Đẹp quá trời, gửi mình ảnh gốc nha', { quote: quoteOf(tea, { attach: JSON.stringify({ title: 'Đồi chè Cầu Đất sáng nay', thumbUrl: 'x' }) }) });
  add(photoMsg(convId, at(-2, '06:20', 0), P.bao, PICTURES.mist));
  add(photoMsg(convId, at(-2, '06:20', 1), P.bao, PICTURES.mist2));
  t(-2, '06:21', P.bao, 'Săn mây thành công! ☁️');
  t(-2, '12:30', P.huy, 'Trưa nay ăn bánh căn nha, quán gần chợ');
  add(photoMsg(convId, at(-2, '17:40'), P.linh, PICTURES.lake, 'Hồ Tuyền Lâm lúc chiều'));
  t(-2, '17:45', ME0, 'Đẹp xỉu 😍');
  const [vt, vb] = content.video(`${PICTURES.pines}x${++picSeq}`);
  add(msg(convId, at(-1, '07:10'), P.nam, vt, { ...vb, duration: 3000, params: JSON.stringify({ fileSize: 420000, video_width: 640, video_height: 480, duration: 3000 }) }));
  t(-1, '07:12', P.nam, 'Đồi thông buổi sáng, không khí mát lạnh');
  add(photoMsg(convId, at(-1, '16:55'), P.vy, PICTURES.flowers, 'Cánh đồng hoa'));
  const sunset = add(photoMsg(convId, at(-1, '18:20'), P.ha, PICTURES.sunset, 'Hoàng hôn cuối cùng ở Đà Lạt'));
  t(-1, '18:22', P.bao, 'Ảnh này phải in ra treo tường', { quote: quoteOf(sunset, { attach: JSON.stringify({ title: 'Hoàng hôn cuối cùng ở Đà Lạt', thumbUrl: 'x' }) }) });
  const recallMe = t(-1, '21:30', P.nam, 'Mai 5h sáng dậy săn mây lần nữa nha');
  const deleteMe = t(-1, '21:31', P.huy, 'Ai lấy nhầm áo khoác xám của mình không?');
  t(-1, '21:35', P.linh, 'Không phải mình nha');
  t(0, '09:15', ME0, 'Cảm ơn cả nhóm, chuyến đi quá vui!');
  add(msg(convId, at(0, '09:20'), P.ha, ...content.sticker()));
  return { messages: out, recallMe: recallMe.msgId, deleteMe: deleteMe.msgId };
}

// ---------- the other chats, generated ----------
const POOLS = {
  family: ['Cả nhà ăn cơm chưa?', 'Mẹ nấu canh chua nè', 'Cuối tuần về nhà nha con', 'Bé Sóc hôm nay đi học vui lắm', 'Bố vừa tưới cây xong', 'Nhớ mặc áo ấm nha',
    'Tối nay ai về ăn cơm?', 'Con về trễ chút nha mẹ', 'Mai sinh nhật Bố đó cả nhà', 'Đặt bánh kem rồi nha', 'Trời mưa to quá, đi đường cẩn thận',
    'Mẹ gửi ít trái cây lên cho con rồi', 'Dạ con nhận được rồi ạ', 'Cuối tháng cả nhà đi Vũng Tàu không?', 'Bé Sóc đòi gặp dì', 'Ok mẹ', 'Giỏi quá!', 'Nhớ uống thuốc nha Bố'],
  work: ['Mọi người cập nhật tiến độ giúp mình nhé', 'Brief chiến dịch Tết đã gửi trong nhóm', 'Chiều 3h họp nhanh 15 phút nha', 'Số liệu tuần này tăng 12% so với tuần trước',
    'Mình gửi bản thiết kế v2', 'Khách hàng góp ý đổi màu nền', 'Deadline thứ Sáu nhé', 'Ok anh, em làm ngay', 'Đã cập nhật file báo cáo', 'Ai rảnh review giúp mình bài đăng?',
    'Bài này đăng lúc 8h tối là đẹp', 'Ngân sách quảng cáo tháng 10 đã duyệt', 'Cảm ơn cả team, tuần này làm tốt lắm!', 'Đã chốt lịch chụp sản phẩm thứ Tư', 'Em đang sửa lại caption'],
  class: ['Lâu quá không gặp cả lớp!', 'Họp lớp năm nay tổ chức ở đâu vậy?', 'Mình đề xuất nhà hàng gần trường cũ', 'Ai còn liên lạc với cô chủ nhiệm không?',
    'Cô vẫn khỏe, mới gặp tuần trước', 'Chốt ngày 12/10 nha mọi người', 'Mình đăng ký 2 người', 'Trời ơi nhìn ai kia 😂', 'Nhớ quá thời đi học', 'Quỹ lớp ai giữ vậy?', 'Mình chuyển khoản rồi nha'],
  running: ['Sáng mai chạy 10km ở công viên nha', '5h15 tập trung cổng chính', 'Hôm nay pace 5:30, mệt nhưng vui', 'Ai đăng ký giải marathon tháng 12 chưa?',
    'Nhớ khởi động kỹ trước khi chạy', 'Mưa rồi, hoãn buổi tối nay nha', 'Chúc mừng anh vừa về đích 21km! 🎉', 'Giày mới chạy êm lắm mọi người'],
  casual: ['Tối nay đi cà phê không?', 'Mới xem phim đó, hay lắm', 'Cuối tuần rảnh không?', 'Ok, 7h gặp nha', 'Đang kẹt xe quá trời', 'Gửi mình địa chỉ quán nhé',
    'Hôm qua vui ghê', 'Cảm ơn nha!', 'Để mình hỏi lại rồi báo nhé', 'Haha đúng rồi', 'Mai mình gọi lại nha'],
  work11: ['Anh ơi, em gửi bản báo cáo rồi nhé', 'Ok em, anh xem chiều nay', 'Phần số liệu em kiểm tra lại giúp anh', 'Dạ em sửa xong rồi ạ', 'Mai 9h mình gặp khách nha'],
};
const FILES = ['Báo cáo tuần 38.pdf', 'Kế hoạch Q4.pdf', 'Brief Tết 2027.pdf', 'Thiết kế banner v2.pdf'];
const PHOTO_CAPTIONS = ['', '', 'Ảnh hôm nay nè', 'Nhìn nè', ''];

function generated(convId, { members, count, days, end, pool, photos = 0.03, files = 0, stickers = 0.04, mine = 0.2 }) {
  const first = new Date(end - days * DAY);
  const firstMidnight = new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime();
  const times = [];
  for (let i = 0; i < count; i++) {
    const ts = firstMidnight + Math.floor(rnd() * (days + 1)) * DAY + (7 + rnd() * 16) * HOUR; // 7:00 to 23:00
    times.push(ts < end ? Math.round(ts) : end - Math.round(rnd() * 6 * HOUR));
  }
  times.sort((a, b) => a - b);
  times[times.length - 1] = end;
  const out = [];
  times.forEach((ts, i) => {
    const from = rnd() < mine ? '0' : pick(members);
    const r = rnd();
    if (r < photos) out.push(photoMsg(convId, ts, from, Math.floor(rnd() * 12), pick(PHOTO_CAPTIONS)));
    else if (r < photos + files) out.push(fileMsg(convId, ts, from, pick(FILES), 60000 + Math.floor(rnd() * 900000)));
    else if (r < photos + files + stickers) out.push(msg(convId, ts, from, ...content.sticker()));
    else if (i > 3 && rnd() < 0.08) {
      const target = out[out.length - 1 - Math.floor(rnd() * 3)];
      out.push(textMsg(convId, ts, from, pick(POOLS[pool]), target.msgType === 1 ? { quote: quoteOf(target) } : {}));
    } else out.push(textMsg(convId, ts, from, pick(POOLS[pool])));
  });
  return out;
}

// day0: midnight of the trip's last day (today, or yesterday early in the morning).
export function buildChats(now = Date.now()) {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const day0 = d.getHours() >= 11 ? midnight : midnight - DAY;
  const trip = tripChat('g8000000000000000101', day0);
  // The other chats end a little before the trip's last message, so the trip heads the chat list.
  const tripEnd = +trip.messages[trip.messages.length - 1].sendDttm;
  const before = ago => tripEnd - ago;
  const chats = [
    { id: 'g8000000000000000101', name: 'Nhóm du lịch Đà Lạt', isGroup: true, members: 7, messages: trip.messages, demo: { recallMe: trip.recallMe, deleteMe: trip.deleteMe } },
    { id: 'g8000000000000000102', name: 'Gia đình', isGroup: true, members: 6, messages: generated('g8000000000000000102', { members: [P.bo, P.meMom, P.chi, P.khai, P.soc], count: 300, days: 15, end: before(25 * MIN), pool: 'family', photos: 0.035 }) },
    { id: 'g8000000000000000103', name: 'Team Marketing', isGroup: true, members: 12, messages: generated('g8000000000000000103', { members: [P.hung, ...team], count: 450, days: 15, end: before(70 * MIN), pool: 'work', photos: 0.012, files: 0.02, stickers: 0.015 }) },
    { id: 'g8000000000000000104', name: 'Lớp 12A1 – Họp lớp', isGroup: true, members: 42, messages: generated('g8000000000000000104', { members: classmates, count: 800, days: 16, end: before(3 * HOUR), pool: 'class', photos: 0.013, mine: 0.08 }) },
    { id: 'g8000000000000000105', name: 'CLB Chạy bộ Sài Gòn', isGroup: true, members: 128, messages: generated('g8000000000000000105', { members: runners, count: 250, days: 12, end: before(5 * HOUR), pool: 'running', photos: 0.02, mine: 0.05 }) },
    { id: P.ha, name: names.get(P.ha), messages: generated(P.ha, { members: [P.ha], count: 120, days: 14, end: before(40 * MIN), pool: 'casual', photos: 0.03, mine: 0.45 }) },
    { id: P.hung, name: names.get(P.hung), messages: generated(P.hung, { members: [P.hung], count: 70, days: 12, end: before(2 * HOUR), pool: 'work11', photos: 0, files: 0.04, mine: 0.5 }) },
    { id: P.nam, name: names.get(P.nam), messages: generated(P.nam, { members: [P.nam], count: 40, days: 9, end: before(26 * HOUR), pool: 'casual', mine: 0.5 }) },
    { id: P.linh, name: names.get(P.linh), messages: generated(P.linh, { members: [P.linh], count: 80, days: 13, end: before(50 * HOUR), pool: 'casual', files: 0.02, mine: 0.5 }) },
    { id: P.bao, name: names.get(P.bao), messages: generated(P.bao, { members: [P.bao], count: 25, days: 7, end: before(4 * DAY), pool: 'casual', mine: 0.5 }) },
    { id: P.vy, name: names.get(P.vy), messages: generated(P.vy, { members: [P.vy], count: 18, days: 5, end: before(8 * DAY), pool: 'casual', mine: 0.5 }) },
    { id: P.huy, name: names.get(P.huy), messages: [] },
  ];
  return chats;
}

export { displayName };
