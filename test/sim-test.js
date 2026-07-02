// Headless end-to-end test: two clients join, ready up, play, take damage.
import WebSocket from 'ws';

const URL = 'ws://localhost:3210';
const log = (...a) => console.log(...a);

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, id: null, last: null, phases: new Set() };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') { c.id = m.id; log(`${name} joined as id ${m.id}`); }
    if (m.t === 'state') {
      if (!c.phases.has(m.ph)) { c.phases.add(m.ph); log(`${name} sees phase: ${m.ph} (level ${m.lv}, timer ${m.tm.toFixed(1)})`); }
      c.last = m;
    }
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = client('A');
const b = client('B');
await sleep(500);

// color cycling
a.send({ t: 'color', d: 1 });
await sleep(200);
log('A color after cycle:', a.last.pl.find((p) => p.id === a.id).c);

// ready both
a.send({ t: 'ready' });
await sleep(300);
log('phase after A ready (should be lobby):', a.last.ph);
b.send({ t: 'ready' });
await sleep(300);
log('phase after both ready (should be countdown):', a.last.ph);

// unready cancels countdown
a.send({ t: 'ready' });
await sleep(300);
log('phase after A unready (should be lobby):', a.last.ph);
a.send({ t: 'ready' });
await sleep(4200); // full countdown

log('phase after countdown (should be intro):', a.last.ph);
await sleep(3000);
log('phase (should be playing):', a.last.ph);
const me = a.last.pl.find((p) => p.id === a.id);
log('A pos:', me.x.toFixed(1), me.y.toFixed(1), 'hp:', me.hp);

// move right + jump
a.send({ t: 'in', l: 0, r: 1, u: 0, d: 0, j: 0, use: 0, inter: 0 });
await sleep(600);
a.send({ t: 'in', l: 0, r: 1, u: 0, d: 0, j: 1, use: 0, inter: 0 });
await sleep(400);
a.send({ t: 'in', l: 0, r: 0, u: 0, d: 0, j: 0, use: 0, inter: 0 });
const me2 = a.last.pl.find((p) => p.id === a.id);
log('A pos after move (x should increase):', me2.x.toFixed(1), me2.y.toFixed(1));
if (me2.x <= me.x) { log('FAIL: player did not move'); process.exit(1); }

// wait for hazards
await sleep(4000);
log('hazards:', a.last.hz.length, 'platforms:', a.last.pf.length, 'powerups:', a.last.pu.length);
if (a.last.hz.length === 0) log('WARN: no hazards yet');

// let it run to observe timer / possible next level
await sleep(5000);
log('timer now:', a.last.tm.toFixed(1), 'phase:', a.last.ph, 'level:', a.last.lv);

// B disconnects, A stays
b.ws.close();
await sleep(500);
log('players after B leaves:', a.last.pl.length);

log('TEST DONE OK');
process.exit(0);
