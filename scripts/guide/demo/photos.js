// Demo pictures for the made-up chats, drawn on a canvas (no real photos). Evaluated in a page by
// shoot.mjs: drawAll() returns base64 JPEGs in the order of PICTURES in chats.js.
function drawAll() {
  const W = 1280, H = 960;
  let s = 7;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const canvas = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return [c, c.getContext('2d')]; };
  const sky = (g, stops) => { const gr = g.createLinearGradient(0, 0, 0, H); stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
  const glow = (g, x, y, r, core, halo) => {
    const gr = g.createRadialGradient(x, y, r * 0.3, x, y, r * 5);
    gr.addColorStop(0, halo); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = core; g.fill();
  };
  const ridge = (g, base, amp, rough, color) => {
    const a = rand() * 6.3, b = rand() * 6.3, c = rand() * 6.3, pts = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      pts.push([t * W, base - amp * (0.55 * Math.sin(t * 4.1 + a) + 0.3 * Math.sin(t * 11.3 + b) + rough * Math.sin(t * 37 + c))]);
    }
    g.beginPath(); g.moveTo(0, H); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(W, H); g.closePath();
    g.fillStyle = color; g.fill();
    return pts;
  };
  const rows = (g, pts, color, n, gap) => {
    g.strokeStyle = color; g.lineWidth = 5;
    for (let k = 1; k <= n; k++) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y + k * gap + k * k * 1.5) : g.moveTo(x, y + k * gap))); g.stroke(); }
  };
  const pine = (g, x, base, h, color) => {
    g.fillStyle = color;
    g.fillRect(x - h * 0.025, base - h * 0.16, h * 0.05, h * 0.16);
    for (let k = 0; k < 4; k++) {
      const w = h * (0.3 - k * 0.06), y0 = base - h * 0.1 - k * h * 0.2;
      g.beginPath(); g.moveTo(x - w, y0); g.lineTo(x + w, y0); g.lineTo(x, y0 - h * 0.32); g.closePath(); g.fill();
    }
  };
  const mist = (g, y, h, alpha) => {
    const gr = g.createLinearGradient(0, y - h, 0, y + h);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${alpha})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, y - h, W, h * 2);
  };
  const water = (g, top, c1, c2) => {
    const gr = g.createLinearGradient(0, top, 0, H); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.fillRect(0, top, W, H - top);
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2;
    for (let i = 0; i < 60; i++) { const y = top + 10 + rand() * (H - top), x = rand() * W, l = 30 + rand() * 120; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke(); }
  };
  const flowers = (g, top, colors) => {
    for (let i = 0; i < 2600; i++) {
      const y = top + Math.pow(rand(), 0.7) * (H - top), k = (y - top) / (H - top);
      g.beginPath(); g.arc(rand() * W, y, 2 + k * 11, 0, Math.PI * 2);
      g.fillStyle = colors[Math.floor(rand() * colors.length)]; g.fill();
    }
  };

  const scenes = {
    tea(g) {
      sky(g, [[0, '#8ec5f0'], [0.45, '#e9f4fb'], [1, '#f6fbff']]);
      ridge(g, 380, 60, 0.05, '#7fa7b5');
      const mid = ridge(g, 520, 70, 0.04, '#5f9c4a'); rows(g, mid, 'rgba(160,210,110,0.55)', 9, 22);
      const near = ridge(g, 700, 60, 0.03, '#4e8f36'); rows(g, near, 'rgba(175,225,120,0.6)', 10, 30);
      for (let i = 0; i < 6; i++) pine(g, 120 + i * 210 + rand() * 60, 640 + rand() * 60, 170 + rand() * 60, '#2f5e22');
    },
    mist(g) {
      sky(g, [[0, '#c9b8d8'], [0.5, '#f4d9c6'], [1, '#fdf1e2']]);
      glow(g, 900, 330, 38, '#fff6e0', 'rgba(255,225,180,0.9)');
      ridge(g, 430, 70, 0.06, '#8b95b4'); mist(g, 470, 70, 0.8);
      ridge(g, 560, 80, 0.05, '#65708f'); mist(g, 610, 80, 0.75);
      ridge(g, 700, 60, 0.04, '#46506b');
      for (let i = 0; i < 14; i++) pine(g, rand() * W, 900 + rand() * 60, 180 + rand() * 120, '#252b3a');
    },
    mist2(g) {
      sky(g, [[0, '#9fb4cf'], [0.55, '#e8e1dc'], [1, '#f7efe6']]);
      ridge(g, 400, 90, 0.05, '#9aa6be'); mist(g, 460, 90, 0.85);
      ridge(g, 540, 70, 0.06, '#77829e'); mist(g, 600, 70, 0.8);
      ridge(g, 690, 70, 0.04, '#566079'); mist(g, 760, 60, 0.5);
      ridge(g, 860, 40, 0.03, '#39405a');
    },
    lake(g) {
      sky(g, [[0, '#5aa2e6'], [0.5, '#bfe1f7'], [1, '#e6f4fb']]);
      const far = ridge(g, 420, 70, 0.05, '#6f93a8');
      ridge(g, 500, 60, 0.04, '#3f7a52');
      for (let i = 0; i < 18; i++) pine(g, rand() * W, 560, 110 + rand() * 80, '#2a5a37');
      water(g, 560, '#4d8fb3', '#2c5f7c');
      g.globalAlpha = 0.25; g.save(); g.translate(0, 1120); g.scale(1, -1); g.beginPath(); g.moveTo(0, H); far.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(W, H); g.fillStyle = '#6f93a8'; g.fill(); g.restore(); g.globalAlpha = 1;
    },
    pines(g) {
      sky(g, [[0, '#a7cfe8'], [0.6, '#e5f1e6'], [1, '#f2f7ee']]);
      ridge(g, 460, 80, 0.05, '#7da08a');
      for (let i = 0; i < 26; i++) pine(g, rand() * W, 560 + rand() * 40, 160 + rand() * 90, '#3d6e4a');
      ridge(g, 760, 50, 0.03, '#4f7d3f');
      for (let i = 0; i < 12; i++) pine(g, rand() * W, 930 + rand() * 30, 300 + rand() * 160, '#1f4128');
      g.fillStyle = 'rgba(255,250,220,0.12)';
      for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(200 + i * 190, 0); g.lineTo(290 + i * 190, 0); g.lineTo(-100 + i * 260, H); g.lineTo(-220 + i * 260, H); g.closePath(); g.fill(); }
    },
    flowers(g) {
      sky(g, [[0, '#6fb3ec'], [0.5, '#d6ecfa'], [1, '#eef7fd']]);
      ridge(g, 440, 50, 0.05, '#86a9b9');
      ridge(g, 520, 40, 0.04, '#6c9a5a');
      g.fillStyle = '#5d8f43'; g.fillRect(0, 540, W, H - 540);
      flowers(g, 540, ['#f7a8c4', '#f06f9b', '#ffd34f', '#fff2a8', '#c89af2']);
    },
    sunset(g) {
      sky(g, [[0, '#2d2a6e'], [0.35, '#b74b7c'], [0.62, '#f28a4b'], [0.8, '#ffc36b'], [1, '#ffe2a6']]);
      glow(g, 640, 640, 70, '#fff1c9', 'rgba(255,200,120,0.85)');
      ridge(g, 660, 70, 0.05, '#5a2f4f');
      ridge(g, 760, 60, 0.04, '#3a1f36');
      for (let i = 0; i < 16; i++) pine(g, rand() * W, 900 + rand() * 50, 200 + rand() * 160, '#1e1022');
    },
    beach(g) {
      sky(g, [[0, '#4aa3e8'], [0.55, '#bde3f8'], [1, '#e8f6fd']]);
      glow(g, 1030, 190, 46, '#fffbe6', 'rgba(255,245,200,0.8)');
      water(g, 470, '#2f8fc4', '#58c3d6');
      g.fillStyle = '#f1dcae'; g.beginPath(); g.moveTo(0, 740); for (let x = 0; x <= W; x += 40) g.lineTo(x, 720 + Math.sin(x / 130) * 18); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 6; g.beginPath(); for (let x = 0; x <= W; x += 20) g.lineTo(x, 712 + Math.sin(x / 130) * 18 + Math.sin(x / 25) * 3); g.stroke();
    },
    city(g) {
      sky(g, [[0, '#0b1433'], [0.6, '#2b2a5e'], [1, '#5a3f73']]);
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.7})`; g.fillRect(rand() * W, rand() * 480, 2, 2); }
      glow(g, 1040, 170, 36, '#f5f1dc', 'rgba(220,220,255,0.35)');
      for (let x = 0; x < W;) {
        const w = 60 + rand() * 110, h = 180 + rand() * 360;
        g.fillStyle = '#141a33'; g.fillRect(x, 820 - h, w, h);
        for (let wy = 840 - h; wy < 800; wy += 22) for (let wx = x + 8; wx < x + w - 10; wx += 16) if (rand() < 0.45) { g.fillStyle = rand() < 0.8 ? '#ffd98a' : '#9fd7ff'; g.fillRect(wx, wy, 7, 10); }
        x += w + 6;
      }
      water(g, 820, '#1b2447', '#0c1026');
    },
  };
  scenes.lake2 = g => { s += 101; scenes.lake(g); };
  scenes.tea2 = g => { s += 57; scenes.tea(g); };
  scenes.flowers2 = g => { s += 33; scenes.flowers(g); };

  const order = ['tea', 'mist', 'mist2', 'lake', 'pines', 'flowers', 'sunset', 'beach', 'city', 'lake2', 'tea2', 'flowers2'];
  return order.map(name => { const [c, g] = canvas(); scenes[name](g); return c.toDataURL('image/jpeg', 0.86).split(',')[1]; });
}
