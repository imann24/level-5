// LEVEL 5 client: networking, input, and thick-pixel hand-drawn rendering
(() => {
const W = 256, H = 256;
const STAGE_L = 16, STAGE_R = 240, FLOOR_Y = 206;
const PW = 12, PH = 18;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function fitCanvas() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth, innerHeight) / W));
  canvas.style.width = W * s + 'px';
  canvas.style.height = H * s + 'px';
}
addEventListener('resize', fitCanvas);
fitCanvas();

// ---- palette ----
const PLAYER_COLORS = ['#f2f2f2', '#f2e59e', '#f0b6c3', '#c9ead9'];
const RED = '#e0301a', DARKRED = '#8c1c0c', GREEN = '#3fdc66', XRED = '#e04430';
const PLAT = '#efe0ac', PERI = '#a9b6ee', WHITE = '#f2f2f2', DUST = '#c9bb98';

// ---- state ----
let myId = null, full = false, connected = false;
let snap = null, prevPos = new Map(), curPos = new Map(), lastMsgAt = 0;
const particles = [];
let shakeT = 0;

// ---- networking ----
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
ws.onopen = () => { connected = true; };
ws.onclose = () => { connected = false; };
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'welcome') { myId = m.id; return; }
  if (m.t === 'full') { full = true; return; }
  if (m.t !== 'state') return;
  prevPos = curPos;
  curPos = new Map();
  for (const p of m.pl) curPos.set('p' + p.id, { x: p.x, y: p.y });
  for (const h of m.hz) curPos.set('h' + h.id, { x: h.x, y: h.y });
  lastMsgAt = performance.now();
  snap = m;
  window.__snap = m; window.__myId = myId;
  for (const ev of m.ev) onEvent(ev);
};

function send(o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }

// ---- input ----
const inp = { l: 0, r: 0, u: 0, d: 0, j: 0, use: 0, inter: 0 };
function setIn(k, v) {
  if (inp[k] !== v) { inp[k] = v; send({ t: 'in', ...inp }); }
}

const KEYMAP = {
  ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r',
  ArrowUp: 'u', w: 'u', ArrowDown: 'd', s: 'd',
  ' ': 'j', f: 'use', e: 'inter',
};
addEventListener('keydown', (e) => {
  const inLobby = !snap || snap.ph === 'lobby' || snap.ph === 'countdown';
  if (e.key === 'Enter') { send({ t: 'ready' }); e.preventDefault(); return; }
  if (inLobby && e.key === 'ArrowLeft') { send({ t: 'color', d: -1 }); return; }
  if (inLobby && e.key === 'ArrowRight') { send({ t: 'color', d: 1 }); return; }
  const k = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (k) { setIn(k, 1); e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (k) setIn(k, 0);
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) setIn('use', 1);
  if (e.button === 2) setIn('inter', 1);
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) setIn('use', 0);
  if (e.button === 2) setIn('inter', 0);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- events -> particles / effects ----
function burst(x, y, n, color, spd, up) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    particles.push({
      x, y,
      vx: Math.cos(a) * spd * (0.4 + Math.random()),
      vy: (up ? -Math.abs(Math.sin(a)) : Math.sin(a)) * spd * (0.4 + Math.random()),
      life: 0.25 + Math.random() * 0.3, max: 0.55, color, size: 1 + (Math.random() < 0.4 ? 1 : 0),
    });
  }
}
function onEvent(ev) {
  switch (ev.e) {
    case 'jump': burst(ev.x, ev.y, 6, DUST, 45, true); break;
    case 'land': burst(ev.x, ev.y, 8, DUST, 55, true); break;
    case 'clang': burst(ev.x, ev.y, 10, WHITE, 70); shakeT = 0.12; break;
    case 'block': burst(ev.x, ev.y, 8, PERI, 60); shakeT = 0.1; break;
    case 'hit': burst(ev.x, ev.y, 10, RED, 70); shakeT = 0.18; break;
    case 'death': burst(ev.x, ev.y, 22, PLAYER_COLORS[ev.c] || WHITE, 90); shakeT = 0.3; break;
    case 'pickup': burst(ev.x, ev.y, 6, PERI, 40, true); break;
    case 'heal': burst(ev.x, ev.y, 12, GREEN, 55, true); break;
    case 'drop': burst(ev.x, ev.y, 4, PERI, 30, true); break;
    case 'floorred': shakeT = 0.2; break;
  }
}

// ---- drawing primitives (thick marker style) ----
function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
function stroke(x1, y1, x2, y2, c, t = 2) {
  const dx = x2 - x1, dy = y2 - y1;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= steps; i++) {
    px(x1 + (dx * i) / steps - t / 2, y1 + (dy * i) / steps - t / 2, t, t, c);
  }
}
function disc(cx, cy, r, c) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r + 0.5) px(cx + x, cy + y, 1, 1, c);
}

// seeded wobble so hand-drawn lines don't shimmer
function wob(seed, i) {
  const v = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}
function wobblyLine(x1, y1, x2, y2, c, t, seed, amp = 1) {
  const segs = Math.max(2, Math.floor(Math.hypot(x2 - x1, y2 - y1) / 10));
  let px0 = x1, py0 = y1;
  const nx = -(y2 - y1), ny = x2 - x1;
  const nl = Math.hypot(nx, ny) || 1;
  for (let i = 1; i <= segs; i++) {
    const f = i / segs;
    const o = i === segs ? 0 : wob(seed, i) * amp;
    const x = x1 + (x2 - x1) * f + (nx / nl) * o;
    const y = y1 + (y2 - y1) * f + (ny / nl) * o;
    stroke(px0, py0, x, y, c, t);
    px0 = x; py0 = y;
  }
}

// ---- pixel font (5x7, hand-jittered) ----
const FONT = {
  A:'.###.|#...#|#...#|#####|#...#|#...#|#...#',B:'####.|#...#|####.|#...#|#...#|#...#|####.',
  C:'.####|#....|#....|#....|#....|#....|.####',D:'####.|#...#|#...#|#...#|#...#|#...#|####.',
  E:'#####|#....|####.|#....|#....|#....|#####',F:'#####|#....|####.|#....|#....|#....|#....',
  G:'.####|#....|#....|#..##|#...#|#...#|.###.',H:'#...#|#...#|#####|#...#|#...#|#...#|#...#',
  I:'#####|..#..|..#..|..#..|..#..|..#..|#####',J:'..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K:'#...#|#..#.|###..|#..#.|#...#|#...#|#...#',L:'#....|#....|#....|#....|#....|#....|#####',
  M:'#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',N:'#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O:'.###.|#...#|#...#|#...#|#...#|#...#|.###.',P:'####.|#...#|#...#|####.|#....|#....|#....',
  Q:'.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',R:'####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S:'.####|#....|.###.|....#|....#|#...#|.###.',T:'#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U:'#...#|#...#|#...#|#...#|#...#|#...#|.###.',V:'#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W:'#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',X:'#...#|.#.#.|..#..|..#..|.#.#.|#...#|#...#',
  Y:'#...#|.#.#.|..#..|..#..|..#..|..#..|..#..',Z:'#####|....#|...#.|..#..|.#...|#....|#####',
  '0':'.###.|#...#|#..##|#.#.#|##..#|#...#|.###.','1':'..#..|.##..|..#..|..#..|..#..|..#..|#####',
  '2':'.###.|#...#|....#|..##.|.#...|#....|#####','3':'####.|....#|..##.|....#|....#|#...#|.###.',
  '4':'#...#|#...#|#...#|#####|....#|....#|....#','5':'#####|#....|####.|....#|....#|#...#|.###.',
  '6':'.###.|#....|####.|#...#|#...#|#...#|.###.','7':'#####|....#|...#.|..#..|..#..|.#...|.#...',
  '8':'.###.|#...#|.###.|#...#|#...#|#...#|.###.','9':'.###.|#...#|#...#|.####|....#|....#|.###.',
  ':':'.....|..#..|..#..|.....|..#..|..#..|.....','-':'.....|.....|.....|#####|.....|.....|.....',
  '!':'..#..|..#..|..#..|..#..|..#..|.....|..#..','.':'.....|.....|.....|.....|.....|.....|..#..',
  ' ':'.....|.....|.....|.....|.....|.....|.....',
};
function textW(s, sc, sp = 1) { return s.length * (5 * sc + sp * sc) - sp * sc; }
function drawText(s, x, y, sc, c, seed = 7) {
  let cx = x;
  for (let i = 0; i < s.length; i++) {
    const g = FONT[s[i].toUpperCase()];
    const oy = Math.round(wob(seed, i) * sc * 0.5);
    if (g) {
      const rows = g.split('|');
      for (let r = 0; r < rows.length; r++)
        for (let col = 0; col < 5; col++)
          if (rows[r][col] === '#') px(cx + col * sc, y + oy + r * sc, sc, sc, c);
    }
    cx += 5 * sc + sc;
  }
}
function drawTextC(s, cx, y, sc, c, seed) { drawText(s, Math.round(cx - textW(s, sc) / 2), y, sc, c, seed); }

// ---- icons ----
function drawCheck(x, y, sc = 1) {
  stroke(x - 3 * sc, y, x - sc, y + 2 * sc, GREEN, 2 * sc);
  stroke(x - sc, y + 2 * sc, x + 4 * sc, y - 3 * sc, GREEN, 2 * sc);
}
function drawX(x, y, sc = 1) {
  stroke(x - 3 * sc, y - 3 * sc, x + 3 * sc, y + 3 * sc, XRED, 2 * sc);
  stroke(x + 3 * sc, y - 3 * sc, x - 3 * sc, y + 3 * sc, XRED, 2 * sc);
}
function drawSwordIcon(x, y, ang, c = PERI) {
  // blade
  const bx = Math.cos(ang), by = Math.sin(ang);
  stroke(x - bx * 2, y - by * 2, x + bx * 10, y + by * 10, c, 2);
  // crossguard
  stroke(x - by * 3, y + bx * 3, x + by * 3, y - bx * 3, c, 2);
  // hilt
  stroke(x - bx * 2, y - by * 2, x - bx * 4, y - by * 4, '#7d8ac2', 2);
}
function drawHealthIcon(x, y, t) {
  // green floating plus with a soft sparkle
  px(x - 1, y - 4, 3, 9, GREEN);
  px(x - 4, y - 1, 9, 3, GREEN);
  if (Math.floor(t * 3) % 2 === 0) px(x + 4, y - 5, 1, 1, '#aef7c2');
  else px(x - 5, y + 3, 1, 1, '#aef7c2');
}

function drawShieldIcon(x, y, big = false) {
  const rw = big ? 3 : 2, rh = big ? 5 : 4;
  for (let dy = -rh; dy <= rh; dy++)
    for (let dx = -rw; dx <= rw; dx++)
      if ((dx * dx) / (rw * rw) + (dy * dy) / (rh * rh) <= 1.15) px(x + dx, y + dy, 1, 1, PERI);
  stroke(x, y - rh + 1, x, y + rh - 1, '#7d8ac2', 1);
}

// ---- player rendering ----
function drawPlayer(p, x, y, t) {
  const c = PLAYER_COLORS[p.c];
  if (p.iv && Math.floor(t * 14) % 2 === 0) return; // invuln blink
  const cx = x + PW / 2;
  const running = p.og && Math.abs(p.vx) > 5;
  const cyc = Math.sin(t * 16 + p.id);
  const air = !p.og;

  // head
  disc(cx, y + 3.5, 3.5, c);
  // torso
  stroke(cx, y + 7, cx, y + 12, c, 3);

  // legs
  const hip = y + 12;
  if (air) {
    stroke(cx, hip, cx - 3, y + 16, c, 2);
    stroke(cx, hip, cx + 3, y + 16, c, 2);
  } else if (running) {
    stroke(cx, hip, cx - 3.5 * cyc, y + 18, c, 2);
    stroke(cx, hip, cx + 3.5 * cyc, y + 18, c, 2);
  } else {
    stroke(cx, hip, cx - 2.5, y + 18, c, 2);
    stroke(cx, hip, cx + 2.5, y + 18, c, 2);
  }

  // arms
  const sh = y + 8;
  if (p.sw > 0 && p.pw === 'sword') {
    // swing: arm + sword sweep in an arc
    const prog = 1 - p.sw / 0.3;
    const ang = (-2.1 + prog * 2.6) * p.f; // radians from straight up
    const hx = cx + Math.sin(ang) * 6, hy = sh + 1 - Math.cos(ang) * 4;
    stroke(cx, sh, hx, hy, c, 2);
    drawSwordIcon(hx, hy, ang - Math.PI / 2, PERI);
    // swoosh lines trailing the blade
    for (let i = 0; i < 3; i++) {
      const a2 = ang - (0.5 + i * 0.3) * p.f;
      stroke(cx + Math.sin(a2) * 9, sh - Math.cos(a2) * 9, cx + Math.sin(a2) * 12, sh - Math.cos(a2) * 12, WHITE, 1);
    }
    stroke(cx, sh, cx - 3 * p.f, sh + 3, c, 2); // off arm
  } else if (p.sh) {
    // shield raised in front
    stroke(cx, sh, cx + 5 * p.f, sh + 1, c, 2);
    stroke(cx, sh, cx - 3 * p.f, sh + 4, c, 2);
    drawShieldIcon(cx + 8 * p.f, y + 8, true);
  } else if (air) {
    stroke(cx, sh, cx - 4, sh - 3, c, 2);
    stroke(cx, sh, cx + 4, sh - 3, c, 2);
  } else if (running) {
    stroke(cx, sh, cx - 4, sh + 4 - cyc, c, 2);
    stroke(cx, sh, cx + 4, sh + 4 + cyc, c, 2);
  } else {
    stroke(cx, sh, cx - 4, sh + 4, c, 2);
    stroke(cx, sh, cx + 4, sh + 4, c, 2);
  }

  // held (not active) powerup indicator on back
  if (p.pw === 'sword' && p.sw <= 0) drawSwordIcon(cx - 5 * p.f, y + 10, -Math.PI / 2 - 0.5 * p.f);
  if (p.pw === 'shield' && !p.sh) drawShieldIcon(cx - 5 * p.f, y + 9);

  // hp dots when recently hurt
  if (p.ht > 0 && p.al) {
    for (let i = 0; i < 3; i++) {
      const on = i < p.hp;
      px(cx - 4 + i * 3.5, y - 7, 2, 2, on ? GREEN : '#2a2a2a');
    }
  }

  // falling speed lines during intro drop
  if (air && snap && (snap.ph === 'intro') ) {
    for (let i = 0; i < 3; i++) {
      const lx = cx - 4 + i * 4;
      stroke(lx, y - 8 - (i % 2) * 3, lx, y - 3 - (i % 2) * 3, '#555', 1);
    }
  }
}

// ---- hazards ----
function drawTriangle(h, x, y, t) {
  const cx = x + h.w / 2, cy = y + h.h / 2;
  // orientation by movement direction
  let dir; // 0 down,1 up,2 left,3 right
  if (h.ax === 'v') dir = h.vy >= 0 ? 0 : 1;
  else dir = h.vx < 0 ? 2 : 3;
  ctx.fillStyle = RED;
  ctx.beginPath();
  const s = h.w / 2;
  if (dir === 0) { ctx.moveTo(cx - s, y + 2); ctx.lineTo(cx + s, y + 2); ctx.lineTo(cx, y + h.h); }
  if (dir === 1) { ctx.moveTo(cx - s, y + h.h - 2); ctx.lineTo(cx + s, y + h.h - 2); ctx.lineTo(cx, y); }
  if (dir === 2) { ctx.moveTo(x + h.w - 2, cy - s); ctx.lineTo(x + h.w - 2, cy + s); ctx.lineTo(x, cy); }
  if (dir === 3) { ctx.moveTo(x + 2, cy - s); ctx.lineTo(x + 2, cy + s); ctx.lineTo(x + h.w, cy); }
  ctx.closePath(); ctx.fill();
  // motion streaks behind
  const ph = Math.floor(t * 10) % 2;
  ctx.fillStyle = DARKRED;
  if (dir === 0) for (let i = 0; i < 3; i++) px(cx - 4 + i * 4, y - 6 - ph - (i % 2) * 2, 2, 5, DARKRED);
  if (dir === 1) for (let i = 0; i < 3; i++) px(cx - 4 + i * 4, y + h.h + 2 + ph + (i % 2) * 2, 2, 5, DARKRED);
  if (dir === 2) for (let i = 0; i < 3; i++) px(x + h.w + 2 + ph + (i % 2) * 2, cy - 4 + i * 4, 5, 2, DARKRED);
  if (dir === 3) for (let i = 0; i < 3; i++) px(x - 7 - ph - (i % 2) * 2, cy - 4 + i * 4, 5, 2, DARKRED);
}
function drawBall(h, x, y, t) {
  disc(x + h.w / 2, y + h.h / 2, h.w / 2, RED);
  // rolling marker
  const a = t * 6 * Math.sign(h.vx || 1);
  const mx = x + h.w / 2 + Math.cos(a) * (h.w / 2 - 3);
  const my = y + h.h / 2 + Math.sin(a) * (h.w / 2 - 3);
  px(mx - 1, my - 1, 2, 2, DARKRED);
}

// ---- stage ----
function drawStage(floorState, t) {
  // rounded hand-drawn stage box
  const seed = 3;
  if (floorState === 2) {
    ctx.fillStyle = DARKRED;
    ctx.fillRect(STAGE_L, FLOOR_Y, STAGE_R - STAGE_L, H - FLOOR_Y - 6);
  }
  const flicker = floorState === 1 && Math.floor(t * 8) % 2 === 0;
  const edge = floorState === 2 ? RED : flicker ? RED : WHITE;
  wobblyLine(STAGE_L + 4, FLOOR_Y, STAGE_R - 4, FLOOR_Y, edge, 3, seed, 1.2);
  wobblyLine(STAGE_L, FLOOR_Y + 4, STAGE_L, H - 8, WHITE, 3, seed + 1, 1);
  wobblyLine(STAGE_R, FLOOR_Y + 4, STAGE_R, H - 8, WHITE, 3, seed + 2, 1);
  wobblyLine(STAGE_L + 4, H - 6, STAGE_R - 4, H - 6, WHITE, 3, seed + 3, 1.2);
  // corners
  stroke(STAGE_L, FLOOR_Y + 4, STAGE_L + 4, FLOOR_Y, edge, 3);
  stroke(STAGE_R - 4, FLOOR_Y, STAGE_R, FLOOR_Y + 4, edge, 3);
  stroke(STAGE_L, H - 8, STAGE_L + 4, H - 6, WHITE, 3);
  stroke(STAGE_R - 4, H - 6, STAGE_R, H - 8, WHITE, 3);
}

function drawPlatform(pl) {
  // pale yellow hand-drawn bar with rounded ends
  disc(pl.x + 2, pl.y + 2, 2, PLAT);
  disc(pl.x + pl.w - 2, pl.y + 2, 2, PLAT);
  px(pl.x + 2, pl.y, pl.w - 4, 4, PLAT);
}

// ---- lobby ----
function drawLobby(s, t) {
  drawTextC('LEVEL 5', W / 2, 26, 4, WHITE, 2);
  // wavy underline
  let lx = 44;
  ctx.fillStyle = WHITE;
  for (let x = 44; x <= 212; x += 4) {
    const y = 70 + Math.round(Math.sin(x * 0.45) * 3);
    stroke(lx, 70 + Math.sin((x - 4) * 0.45) * 3, x, y, WHITE, 3);
    lx = x;
  }

  // countdown "3 2 1 GO!"
  if (s.ph === 'countdown') {
    const el = 3.6 - s.cd;
    let str = '';
    if (el >= 0) str = '3';
    if (el >= 1) str += ' . 2';
    if (el >= 2) str += ' . 1';
    let go = el >= 3;
    const base = Math.round(W / 2 - (textW('3 . 2 . 1 . GO!', 2) / 2));
    drawText(str, base, 92, 2, WHITE, 4);
    if (go) drawText('. GO!', base + textW('3 . 2 . 1 ', 2), 92, 2, GREEN, 5);
  }

  // players in join order
  const players = s.pl;
  const n = players.length;
  players.forEach((p, i) => {
    const cx = W / 2 + (i - (n - 1) / 2) * 44;
    const y = 178;
    const fake = { ...p, og: 1, vx: 0, sw: 0, sh: 0, pw: null, iv: 0, ht: 0, f: 1, al: 1 };
    drawPlayer(fake, cx - PW / 2, y, t);
    if (p.rdy) drawCheck(cx, y - 12); else drawX(cx, y - 12);
    if (p.id === myId) drawTextC('YOU', cx, y + 24, 1, '#777', i);
  });

  if (n === 0) drawTextC('WAITING FOR PLAYERS', W / 2, 180, 1, '#666', 3);
  drawTextC('ARROWS. COLOR   ENTER. READY', W / 2, 236, 1, '#555', 9);
}

// ---- game screen ----
function lerpPos(key, def) {
  const a = prevPos.get(key), b = curPos.get(key) || def;
  if (!a || !b) return b || def;
  const alpha = Math.min(1, (performance.now() - lastMsgAt) / 40);
  return { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha };
}

function drawGame(s, t) {
  drawStage(s.fl, t);
  for (const pl of s.pf) drawPlatform(pl);

  // powerups on ground / floating health
  for (const pu of s.pu) {
    const bob = Math.sin(t * 4 + pu.id) * (pu.fl ? 2.5 : 1);
    if (pu.k === 'sword') drawSwordIcon(pu.x, pu.y + 4 + bob, -Math.PI / 2);
    else if (pu.k === 'shield') drawShieldIcon(pu.x, pu.y + 3 + bob, true);
    else if (pu.k === 'health') drawHealthIcon(pu.x, pu.y + bob, t + pu.id);
  }

  for (const h of s.hz) {
    const pos = lerpPos('h' + h.id, h);
    if (h.k === 'tri') drawTriangle(h, pos.x, pos.y, t);
    else drawBall(h, pos.x, pos.y, t);
  }

  for (const p of s.pl) {
    if (!p.ig || !p.al) continue;
    const pos = lerpPos('p' + p.id, p);
    drawPlayer(p, pos.x, pos.y, t);
    // run dust
    if (p.og && Math.abs(p.vx) > 5 && Math.random() < 0.35) {
      particles.push({
        x: pos.x + PW / 2 - Math.sign(p.vx) * 3 + (Math.random() * 4 - 2),
        y: pos.y + PH - 1,
        vx: -Math.sign(p.vx) * (10 + Math.random() * 20),
        vy: -10 - Math.random() * 25,
        life: 0.28, max: 0.28, color: DUST, size: 1,
      });
    }
  }

  // HUD
  if (s.ph === 'playing') {
    const tm = Math.ceil(s.tm);
    const mm = Math.floor(tm / 60), ss = tm % 60;
    drawTextC('- ' + mm + ' : ' + (ss < 10 ? '0' : '') + ss, W / 2, 14, 2, WHITE, 11);
  }
  if (s.ph === 'intro') {
    drawText('LEVEL ' + s.lv, 24, 18, 3, WHITE, s.lv);
  }
  if (s.ph === 'gameover') {
    drawTextC('GAME OVER', W / 2, 100, 3, RED, 13);
  }
}

// ---- particles ----
function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 160 * dt;
  }
}
function drawParticles() {
  for (const p of particles) px(p.x, p.y, p.size, p.size, p.color);
}

// ---- main loop ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  stepParticles(dt);
  shakeT = Math.max(0, shakeT - dt);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (shakeT > 0) ctx.setTransform(1, 0, 0, 1, Math.round(wob(1, Math.floor(t * 60)) * 2), Math.round(wob(2, Math.floor(t * 60)) * 2));

  if (full) {
    drawTextC('SESSION FULL', W / 2, 110, 2, RED, 1);
    drawTextC('4 PLAYERS MAX', W / 2, 134, 1, '#888', 2);
  } else if (!connected || !snap) {
    drawTextC(connected ? 'JOINING...' : (myId ? 'DISCONNECTED' : 'CONNECTING...'), W / 2, 118, 2, WHITE, 1);
  } else if (snap.ph === 'lobby' || snap.ph === 'countdown') {
    drawLobby(snap, t);
  } else {
    drawGame(snap, t);
  }
  drawParticles();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
