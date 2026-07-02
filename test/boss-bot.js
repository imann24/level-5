// Simple bot player: readies up, grabs the shield, holds it up, keeps its
// distance from the boss, and dodges vertical beams. Used to exercise the
// boss fight end-to-end.
import WebSocket from 'ws';

const URL = process.env.URL || 'ws://localhost:3210';
const ws = new WebSocket(URL);
let id = null, state = null;

ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'welcome') { id = m.id; console.log('bot joined as', id); }
  else if (m.t === 'state') state = m;
});
ws.on('close', () => process.exit(0));

let lastPhase = '';
setInterval(() => {
  if (!state || ws.readyState !== 1) return;
  const me = state.pl.find((p) => p.id === id);
  if (!me) return;
  if (state.ph !== lastPhase) { console.log('phase:', state.ph, 'level', state.lv, 'cycle', state.cy); lastPhase = state.ph; }

  if (state.ph === 'lobby' && !me.rdy) { ws.send(JSON.stringify({ t: 'ready' })); return; }
  if ((state.ph !== 'playing' && state.ph !== 'intro') || !me.al) return;

  const send = { t: 'in', l: 0, r: 0, u: 0, d: 0, j: 0, use: 0, inter: 0 };

  if (me.pw === 'shield') {
    send.use = 1; // shield up: incoming projectiles reflect
    // keep clear of the boss body
    if (state.bs) {
      const dx = state.bs.x + state.bs.w / 2 - (me.x + 6);
      if (Math.abs(dx) < 60) { if (dx > 0) send.l = 1; else send.r = 1; }
      else if (me.x < 40) send.r = 1;
      else if (me.x > 204) send.l = 1;
    }
  } else {
    // unarmed: beeline for the shield, jump-dodge projectiles on the way
    const sh = (state.pu || []).find((q) => q.k === 'shield');
    if (sh) {
      const dx = sh.x - (me.x + 6);
      if (Math.abs(dx) > 5) { if (dx > 0) send.r = 1; else send.l = 1; }
      else send.use = 1; // pick it up
    }
    for (const pr of state.pr || []) {
      if (pr.fr) continue;
      if (Math.abs(pr.x - (me.x + 6)) < 34 && Math.abs(pr.y - (me.y + 9)) < 30) { send.j = 1; break; }
    }
    // sidestep the boss body itself
    if (state.bs) {
      const bx = state.bs.x + state.bs.w / 2, dx = bx - (me.x + 6);
      const dy = (state.bs.y + state.bs.h / 2) - (me.y + 9);
      if (Math.abs(dx) < 34 && Math.abs(dy) < 34) { send.l = dx > 0 ? 1 : 0; send.r = dx > 0 ? 0 : 1; }
    }
  }

  // cycle-2 ground hazards
  for (const h of state.hz || []) {
    if (h.k === 'beam' && h.o === 'v' && me.x + 12 > h.x - 6 && me.x < h.x + h.w + 6) {
      if (h.x > 128) { send.l = 1; send.r = 0; } else { send.r = 1; send.l = 0; }
    }
    if ((h.k === 'ball' || h.k === 'spike') && Math.abs(h.x - me.x) < 32 && !send.j) send.j = 1;
  }
  ws.send(JSON.stringify(send));
}, 40);
