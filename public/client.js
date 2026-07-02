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
let lastStepAt = 0;

// ---- audio: procedural chiptune SFX (no asset files) ----
let actx = null, master = null, muted = false;
function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!actx) {
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 0.32;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
}
addEventListener('keydown', ensureAudio);
addEventListener('mousedown', ensureAudio);

function tone(o) {
  if (!actx || muted) return;
  const { type = 'square', f0 = 440, f1 = 0, dur = 0.1, vol = 0.5, delay = 0 } = o;
  const t0 = actx.currentTime + delay;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, f0), t0);
  if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(Math.max(0.001, vol), t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
}
function noise(o) {
  if (!actx || muted) return;
  const { dur = 0.15, vol = 0.4, f = 1000, q = 1, delay = 0, sweepTo = 0 } = o;
  const t0 = actx.currentTime + delay;
  const len = Math.max(1, Math.floor(actx.sampleRate * dur));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource();
  src.buffer = buf;
  const flt = actx.createBiquadFilter();
  flt.type = 'bandpass';
  flt.frequency.setValueAtTime(Math.max(1, f), t0);
  flt.Q.value = q;
  if (sweepTo) flt.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(Math.max(0.001, vol), t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(flt); flt.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.03);
}

const SFX = {
  color: () => tone({ f0: 520, f1: 680, dur: 0.06, vol: 0.22 }),
  ready: () => { tone({ f0: 440, f1: 880, dur: 0.09, vol: 0.3 }); tone({ f0: 660, f1: 1320, dur: 0.1, vol: 0.2, delay: 0.06 }); },
  unready: () => tone({ f0: 520, f1: 240, dur: 0.13, vol: 0.28 }),
  tick: () => tone({ f0: 880, dur: 0.055, vol: 0.3 }),
  go: () => { tone({ f0: 523, dur: 0.08, vol: 0.3 }); tone({ f0: 784, dur: 0.1, vol: 0.3, delay: 0.08 }); tone({ f0: 1046, dur: 0.22, vol: 0.32, delay: 0.16 }); },
  jump: () => tone({ f0: 280, f1: 620, dur: 0.12, vol: 0.22 }),
  land: () => noise({ dur: 0.07, vol: 0.28, f: 320, q: 0.8 }),
  step: () => noise({ dur: 0.03, vol: 0.1, f: 750, q: 1.2 }),
  swing: () => noise({ dur: 0.13, vol: 0.3, f: 2200, sweepTo: 500, q: 2.2 }),
  clang: () => { tone({ type: 'triangle', f0: 1250, f1: 320, dur: 0.13, vol: 0.4 }); noise({ dur: 0.07, vol: 0.22, f: 3200, q: 1.5 }); },
  block: () => { tone({ f0: 210, f1: 120, dur: 0.12, vol: 0.34 }); noise({ dur: 0.06, vol: 0.2, f: 850, q: 1 }); },
  hit: () => { tone({ type: 'sawtooth', f0: 420, f1: 90, dur: 0.2, vol: 0.4 }); noise({ dur: 0.14, vol: 0.26, f: 500, q: 0.8 }); },
  death: () => { tone({ type: 'sawtooth', f0: 620, f1: 55, dur: 0.5, vol: 0.42 }); noise({ dur: 0.42, vol: 0.28, f: 420, sweepTo: 90, q: 0.7 }); },
  pickup: () => { tone({ f0: 660, f1: 990, dur: 0.07, vol: 0.28 }); tone({ f0: 990, f1: 1400, dur: 0.09, vol: 0.24, delay: 0.06 }); },
  drop: () => tone({ f0: 420, f1: 190, dur: 0.11, vol: 0.24 }),
  heal: () => { tone({ type: 'triangle', f0: 523, dur: 0.09, vol: 0.3 }); tone({ type: 'triangle', f0: 659, dur: 0.09, vol: 0.3, delay: 0.08 }); tone({ type: 'triangle', f0: 784, dur: 0.16, vol: 0.32, delay: 0.16 }); },
  floorwarn: () => { tone({ f0: 220, dur: 0.14, vol: 0.3 }); tone({ f0: 220, dur: 0.14, vol: 0.3, delay: 0.24 }); },
  floorred: () => { tone({ type: 'sawtooth', f0: 160, f1: 70, dur: 0.5, vol: 0.32 }); noise({ dur: 0.5, vol: 0.3, f: 220, sweepTo: 70, q: 0.7 }); },
  nextlevel: () => { tone({ f0: 523, dur: 0.09, vol: 0.3 }); tone({ f0: 659, dur: 0.09, vol: 0.3, delay: 0.09 }); tone({ f0: 784, dur: 0.09, vol: 0.3, delay: 0.18 }); tone({ f0: 1046, dur: 0.2, vol: 0.32, delay: 0.27 }); },
  gameover: () => { tone({ f0: 392, f1: 370, dur: 0.28, vol: 0.34 }); tone({ f0: 330, dur: 0.28, vol: 0.34, delay: 0.28 }); tone({ f0: 262, f1: 120, dur: 0.6, vol: 0.38, delay: 0.56 }); },
  bossfire: () => tone({ type: 'sawtooth', f0: 720, f1: 190, dur: 0.16, vol: 0.28 }),
  reflect: () => tone({ f0: 880, f1: 1760, dur: 0.11, vol: 0.34 }),
  bosshit: () => { tone({ type: 'sawtooth', f0: 320, f1: 140, dur: 0.16, vol: 0.4 }); noise({ dur: 0.09, vol: 0.24, f: 950, q: 1 }); },
  bossdead: () => {
    noise({ dur: 0.8, vol: 0.45, f: 520, sweepTo: 55, q: 0.7 });
    tone({ type: 'sawtooth', f0: 420, f1: 40, dur: 0.85, vol: 0.38 });
    tone({ f0: 523, dur: 0.11, vol: 0.3, delay: 0.55 });
    tone({ f0: 659, dur: 0.11, vol: 0.3, delay: 0.67 });
    tone({ f0: 784, dur: 0.24, vol: 0.34, delay: 0.79 });
  },
  beamcharge: () => tone({ type: 'sine', f0: 560, f1: 1250, dur: 0.35, vol: 0.12 }),
  beamon: () => { tone({ type: 'sawtooth', f0: 1500, f1: 900, dur: 0.28, vol: 0.28 }); noise({ dur: 0.28, vol: 0.18, f: 2600, q: 3 }); },
};
function sfx(name) { try { if (SFX[name]) SFX[name](); } catch {} }

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
  for (const pr of m.pr || []) curPos.set('r' + pr.id, { x: pr.x, y: pr.y });
  if (m.bs) curPos.set('boss', { x: m.bs.x, y: m.bs.y });
  lastMsgAt = performance.now();
  const prev = snap;
  snap = m;
  window.__snap = m; window.__myId = myId;
  for (const ev of m.ev) onEvent(ev);
  audioCues(prev, m);
};

// sounds derived from state transitions rather than explicit events
const seenBeams = new Map(); // beam id -> last known act state
function audioCues(prev, m) {
  if (m.ph === 'countdown') {
    const stage = Math.min(3, Math.floor(3.6 - m.cd));
    const prevStage = prev && prev.ph === 'countdown' ? Math.min(3, Math.floor(3.6 - prev.cd)) : -1;
    if (stage !== prevStage) sfx(stage >= 3 ? 'go' : 'tick');
  }
  if (prev && prev.ph !== 'gameover' && m.ph === 'gameover') sfx('gameover');

  const alive = new Set();
  for (const h of m.hz) {
    if (h.k !== 'beam') continue;
    alive.add(h.id);
    const was = seenBeams.get(h.id);
    if (was === undefined) sfx('beamcharge');
    if (h.act && was === 0) sfx('beamon');
    seenBeams.set(h.id, h.act);
  }
  for (const id of seenBeams.keys()) if (!alive.has(id)) seenBeams.delete(id);
}

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
  if (e.key === 'm' || e.key === 'M') {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.32;
    return;
  }
  if (e.key === 'Enter') {
    if (inLobby && snap) {
      const me = snap.pl.find((p) => p.id === myId);
      sfx(me && me.rdy ? 'unready' : 'ready');
    }
    send({ t: 'ready' });
    e.preventDefault();
    return;
  }
  if (inLobby && e.key === 'ArrowLeft') { sfx('color'); send({ t: 'color', d: -1 }); return; }
  if (inLobby && e.key === 'ArrowRight') { sfx('color'); send({ t: 'color', d: 1 }); return; }
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
    case 'jump': burst(ev.x, ev.y, 6, DUST, 45, true); sfx('jump'); break;
    case 'land': burst(ev.x, ev.y, 8, DUST, 55, true); sfx('land'); break;
    case 'swing': sfx('swing'); break;
    case 'clang': burst(ev.x, ev.y, 10, WHITE, 70); shakeT = 0.12; sfx('clang'); break;
    case 'block': burst(ev.x, ev.y, 8, PERI, 60); shakeT = 0.1; sfx('block'); break;
    case 'hit': burst(ev.x, ev.y, 10, RED, 70); shakeT = 0.18; sfx('hit'); break;
    case 'death': burst(ev.x, ev.y, 22, PLAYER_COLORS[ev.c] || WHITE, 90); shakeT = 0.3; sfx('death'); break;
    case 'pickup': burst(ev.x, ev.y, 6, PERI, 40, true); sfx('pickup'); break;
    case 'heal': burst(ev.x, ev.y, 12, GREEN, 55, true); sfx('heal'); break;
    case 'drop': burst(ev.x, ev.y, 4, PERI, 30, true); sfx('drop'); break;
    case 'floorwarn': sfx('floorwarn'); break;
    case 'floorred': shakeT = 0.2; sfx('floorred'); break;
    case 'nextlevel': sfx('nextlevel'); break;
    case 'bossfire': burst(ev.x, ev.y, 5, RED, 45); sfx('bossfire'); break;
    case 'reflect': burst(ev.x, ev.y, 9, GREEN, 65); shakeT = 0.1; sfx('reflect'); break;
    case 'bosshit': burst(ev.x, ev.y, 12, GREEN, 75); shakeT = 0.15; sfx('bosshit'); break;
    case 'bossdead': burst(ev.x, ev.y, 40, RED, 110); burst(ev.x, ev.y, 20, WHITE, 80); shakeT = 0.5; sfx('bossdead'); break;
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
  disc(cx, y + 3, 2.5, c);
  // torso
  stroke(cx, y + 6, cx, y + 12, c, 3);

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

// ---- boss + cycle-2 hazards ----
function drawBoss(b, x, y, t) {
  const flash = b.ht && Math.floor(t * 16) % 2 === 0;
  const body = flash ? WHITE : RED;
  const cx = x + b.w / 2, cy = y + b.h / 2;
  // hulking blob body
  disc(cx, cy + 2, 11, body);
  disc(cx - 6, cy - 5, 7, body);
  disc(cx + 6, cy - 5, 7, body);
  // horns
  stroke(cx - 9, cy - 10, cx - 12, cy - 16, body, 3);
  stroke(cx + 9, cy - 10, cx + 12, cy - 16, body, 3);
  // stubby feet
  px(cx - 9, y + b.h - 3, 5, 3, body);
  px(cx + 4, y + b.h - 3, 5, 3, body);
  if (!flash) {
    // angry eyes track facing
    const ex = b.f * 2;
    px(cx - 6 + ex, cy - 6, 3, 4, '#000');
    px(cx + 3 + ex, cy - 6, 3, 4, '#000');
    stroke(cx - 8 + ex, cy - 9, cx - 3 + ex, cy - 7, '#000', 2);
    stroke(cx + 6 + ex, cy - 7, cx + 11 + ex, cy - 9, '#000', 2);
    // jagged mouth
    for (let i = 0; i < 4; i++) px(cx - 6 + i * 3, cy + 3 + (i % 2), 3, 2, DARKRED);
  }
}

function drawBossBar(bs, t) {
  const bw = 110, bx = W / 2 - bw / 2, by = 10;
  drawTextC('BOSS', W / 2, by - 8, 1, RED, 21);
  wobblyLine(bx - 2, by, bx + bw + 2, by, WHITE, 2, 31, 0.6);
  wobblyLine(bx - 2, by + 9, bx + bw + 2, by + 9, WHITE, 2, 32, 0.6);
  stroke(bx - 2, by, bx - 2, by + 9, WHITE, 2);
  stroke(bx + bw + 2, by, bx + bw + 2, by + 9, WHITE, 2);
  const fill = Math.max(0, Math.round((bs.hp / bs.mhp) * (bw - 2)));
  if (fill > 0) px(bx + 1, by + 2, fill, 6, bs.ht && Math.floor(t * 16) % 2 === 0 ? WHITE : RED);
}

function drawProjectile(pr, x, y, t) {
  const c = pr.fr ? GREEN : RED;
  disc(x, y, 3, c);
  // crackle
  const a = t * 9 + pr.id;
  px(x + Math.cos(a) * 5 - 1, y + Math.sin(a) * 5 - 1, 2, 2, pr.fr ? '#aef7c2' : DARKRED);
}

function drawSpike(h, x, y, t) {
  ctx.fillStyle = RED;
  const n = 3, sw = h.w / n;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * sw, y + h.h);
    ctx.lineTo(x + i * sw + sw, y + h.h);
    ctx.lineTo(x + i * sw + sw / 2, y);
    ctx.closePath(); ctx.fill();
  }
  // scuttle marks behind
  const back = h.vx > 0 ? x - 5 - (Math.floor(t * 10) % 2) * 2 : x + h.w + 3 + (Math.floor(t * 10) % 2) * 2;
  px(back, y + h.h - 3, 3, 2, DARKRED);
  px(back + (h.vx > 0 ? -4 : 4), y + h.h - 2, 3, 2, DARKRED);
}

function drawBeam(h, t) {
  const charging = !h.act;
  const alpha = charging ? 0.08 + h.a * 0.55 : 1;
  ctx.globalAlpha = alpha;
  const hot = h.act && Math.floor(t * 20) % 2 === 0;
  const c = h.act ? (hot ? WHITE : RED) : '#f2e59e';
  px(h.x, h.y, h.w, h.h, c);
  if (h.act) {
    ctx.globalAlpha = 0.9;
    if (h.o === 'v') { px(h.x + 2, h.y, 2, h.h, WHITE); px(h.x + h.w - 4, h.y, 2, h.h, WHITE); }
    else { px(h.x, h.y + 2, h.w, 2, WHITE); px(h.x, h.y + h.h - 4, h.w, 2, WHITE); }
  }
  ctx.globalAlpha = 1;
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
    if (h.k === 'beam') { drawBeam(h, t); continue; }
    const pos = lerpPos('h' + h.id, h);
    if (h.k === 'tri') drawTriangle(h, pos.x, pos.y, t);
    else if (h.k === 'spike') drawSpike(h, pos.x, pos.y, t);
    else drawBall(h, pos.x, pos.y, t);
  }

  if (s.bs) {
    const bp = lerpPos('boss', s.bs);
    drawBoss(s.bs, bp.x, bp.y, t);
  }
  for (const pr of s.pr || []) {
    const pos = lerpPos('r' + pr.id, pr);
    drawProjectile(pr, pos.x, pos.y, t);
  }

  let anyoneRunning = false;
  for (const p of s.pl) {
    if (!p.ig || !p.al) continue;
    const pos = lerpPos('p' + p.id, p);
    drawPlayer(p, pos.x, pos.y, t);
    if (p.og && Math.abs(p.vx) > 5) anyoneRunning = true;
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

  // soft footsteps while anyone runs
  if (anyoneRunning && t - lastStepAt > 0.22) { sfx('step'); lastStepAt = t; }

  // HUD
  if (s.ph === 'playing') {
    if (s.bs) {
      drawBossBar(s.bs, t);
    } else if (s.vt) {
      drawTextC('BOSS DEFEATED!', W / 2, 60, 2, GREEN, 17);
    } else {
      const tm = Math.ceil(s.tm);
      const mm = Math.floor(tm / 60), ss = tm % 60;
      drawTextC('- ' + mm + ' : ' + (ss < 10 ? '0' : '') + ss, W / 2, 14, 2, WHITE, 11);
    }
  }
  if (s.ph === 'intro') {
    drawText('LEVEL ' + s.lv, 24, 18, 3, WHITE, s.lv + (s.cy - 1) * 5);
    if (s.lv === 5) drawTextC('BOSS FIGHT', W / 2, 46, 1, RED, 23);
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
