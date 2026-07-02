// Direct Room simulation tests (no network)
import { Room } from '../server/game.js';

const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(m); }, on() {} });
let fails = 0;
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) fails++; };
const tick = (room, n = 1) => { for (let i = 0; i < n; i++) room.tick(1 / 30); };

const room = new Room();
const wsA = fakeWs(), wsB = fakeWs();
room.addSocket(wsA);
room.addSocket(wsB);
const [a, b] = [...room.players.values()];

check('distinct default colors', a.color !== b.color);

// ready flow
room.onMessage(a, { t: 'ready' });
tick(room);
check('one ready stays lobby', room.phase === 'lobby');
room.onMessage(b, { t: 'ready' });
tick(room);
check('all ready -> countdown', room.phase === 'countdown');
room.onMessage(a, { t: 'ready' });
tick(room);
check('unready cancels countdown', room.phase === 'lobby');
room.onMessage(a, { t: 'ready' });
tick(room, Math.ceil(3.7 * 30) + 2);
check('countdown -> intro', room.phase === 'intro');
check('timer between 30 and 60', room.timer >= 30 && room.timer <= 60);
check('platforms generated', room.platforms.length >= 2);
tick(room, Math.ceil(2.7 * 30));
check('intro -> playing', room.phase === 'playing');

// level transition when timer expires
room.timer = 0.02;
const plats1 = room.platforms.map((p) => p.x + ',' + p.y).join('|');
tick(room, 3);
check('timer out -> level 2', room.level === 2);
check('back to intro for new level', room.phase === 'intro');
const plats2 = room.platforms.map((p) => p.x + ',' + p.y).join('|');
check('new level layout differs', plats1 !== plats2);
tick(room, Math.ceil(2.7 * 30));

// hazard damage
a.x = 100; a.y = 100; a.vy = 0; a.invulnT = 0;
room.hazards.push({ id: 999, kind: 'tri', axis: 'h', x: 100, y: 100, w: 13, h: 13, vx: 60, vy: 0, life: 5, blockCd: 0 });
tick(room, 1);
check('hazard hit costs hp', a.hp === 2);
check('hurt timer shows dots', a.hurtT > 0);
const hpBefore = a.hp;
a.x = 100; a.y = 100;
tick(room, 2);
check('invuln prevents double hit', a.hp === hpBefore);

// shield block
room.hazards.length = 0;
b.power = 'shield'; b.in.use = 1; b.x = 100; b.y = 100; b.invulnT = 0; b.vy = 0;
const hz = { id: 1000, kind: 'tri', axis: 'h', x: 108, y: 100, w: 13, h: 13, vx: -60, vy: 0, life: 5, blockCd: 0 };
room.hazards.push(hz);
tick(room, 1);
check('shield blocks (no hp loss)', b.hp === 3);
check('blocked hazard bounces away', hz.vx > 0);

// sword flips orientation
room.hazards.length = 0;
b.power = 'sword'; b.in.use = 0; b.x = 100; b.y = FLOOR_Y_() - 18; b.facing = 1;
const hz2 = { id: 1001, kind: 'tri', axis: 'h', x: 116, y: b.y, w: 13, h: 13, vx: -60, vy: 0, life: 5, blockCd: 0 };
room.hazards.push(hz2);
b.edge.use = true;
tick(room, 3);
check('sword flips h-mover to vertical', hz2.axis === 'v' && hz2.vy !== 0 && hz2.vx === 0);
function FLOOR_Y_() { return 206; }

// powerup pickup (use key) + swap + drop (inter key)
room.powerups.length = 0;
room.powerups.push({ id: 2000, kind: 'shield', x: b.x + 4, y: b.y + 5, vy: 0 });
b.edge.use = true;
tick(room, 1);
check('use key over powerup swaps: now shield', b.power === 'shield');
check('old sword dropped in place', room.powerups.length === 1 && room.powerups[0].kind === 'sword');
b.swingT = 0; b.edge.use = true;
tick(room, 1);
check('pick dropped sword back', b.power === 'sword');
b.swingT = 0; b.swingCd = 0;
b.x = 200; b.edge.inter = true;
tick(room, 1);
check('drop key drops held powerup', b.power === null && room.powerups.length === 2);
b.x = 60; b.edge.use = true; // step away from the dropped item first
tick(room, 1);
check('use key away from powerups does nothing', b.power === null && room.powerups.length === 2);

// keep the rest deterministic: no random spawns, floor cycles, or level flips
room.spawnT = 999; room.timer = 999; room.floorT = 999; room.floorState = 0;
room.powerups.length = 0;

// tight sword hitbox: far hazard is not hit
room.hazards.length = 0;
b.alive = true; b.hp = 3; b.invulnT = 999;
b.power = 'sword'; b.x = 100; b.y = 206 - 18; b.facing = 1; b.swingCd = 0;
const far = { id: 1002, kind: 'tri', axis: 'h', x: 130, y: b.y, w: 13, h: 13, vx: -0.001, vy: 0, life: 5, blockCd: 0 };
room.hazards.push(far);
b.edge.use = true;
tick(room, 3);
check('sword misses hazard beyond reach', far.axis === 'h');
b.power = null;

// drop through platform with down key
{
  room.hazards.length = 0;
  const pl = room.platforms[0];
  b.x = pl.x + 2; b.y = pl.y - 18; b.vy = 0; b.in.d = 0;
  tick(room, 1);
  check('standing on platform', b.onGround && b.groundKind === 'plat');
  b.in.d = 1;
  tick(room, 3);
  check('down key drops through platform', !b.onGround || b.groundKind !== 'plat' || b.y > pl.y - 18 + 1);
  b.in.d = 0;
}

// health pickup: heals only when hurt, collected on touch
room.powerups.length = 0;
b.hp = 3; b.x = 100; b.y = 100; b.vy = 0;
room.powerups.push({ id: 2100, kind: 'health', float: true, x: b.x + 4, y: b.y + 5, vy: 0 });
tick(room, 1);
check('full hp ignores health pickup', b.hp === 3 && room.powerups.length === 1);
b.hp = 1; b.x = 100; b.y = 100; b.vy = 0;
tick(room, 1);
check('hurt player collects health', b.hp === 2 && room.powerups.length === 0);
check('health pickup not grabbable with use key', room.powerups.every((q) => q.kind !== 'health'));

// health pickups only generated from level 2 on
{
  const r2 = new Room();
  r2.level = 1; r2.startLevel();
  const l1 = r2.powerups.some((q) => q.kind === 'health');
  r2.level = 2; r2.startLevel();
  const l2 = r2.powerups.some((q) => q.kind === 'health');
  check('no health on level 1, health on level 2', !l1 && l2);
}

// deaths -> gameover -> lobby
a.hp = 1; a.invulnT = 0; a.x = 100; a.y = 100; a.vy = 0;
room.hazards.push({ id: 3000, kind: 'tri', axis: 'h', x: 100, y: 100, w: 13, h: 13, vx: 0, vy: 0, life: 9, blockCd: 0 });
tick(room, 1);
check('player with 0 hp dies', !a.alive);
b.hp = 1; b.invulnT = 0; b.x = 100; b.y = 100; b.vy = 0; b.power = null;
tick(room, 2);
check('all dead -> gameover', room.phase === 'gameover');
tick(room, Math.ceil(3 * 30));
check('gameover -> lobby, all unready', room.phase === 'lobby' && ![...room.players.values()].some((p) => p.ready));

// red floor cycle
room.onMessage(a, { t: 'ready' }); room.onMessage(b, { t: 'ready' });
tick(room, Math.ceil(3.7 * 30) + 2);
tick(room, Math.ceil(2.7 * 30));
room.floorT = 0.01; room.floorState = 0;
const platsBefore = room.platforms.length;
tick(room, 2);
check('floor warn spawns helper platforms', room.floorState === 1 && room.platforms.length > platsBefore);
room.floorT = 0.01;
tick(room, 2);
check('floor turns red', room.floorState === 2);
a.x = 100; a.y = 206 - 18; a.vy = 0; a.invulnT = 0; a.alive = true; a.hp = 3;
tick(room, 2);
check('red floor damages grounded player', a.hp < 3);

// dead players respawn on level pass; survivors keep their hp (no auto-heal)
a.alive = false; a.hp = 0;
b.alive = true; b.hp = 2;
room.timer = 0.02;
tick(room, 3);
check('dead player respawns next level', a.alive && a.hp === 3);
check('survivor hp carries over (no auto-heal)', b.alive && b.hp === 2);

// ---- level 5 boss fight ----
{
  const r3 = new Room();
  r3.addSocket(fakeWs()); r3.addSocket(fakeWs());
  const [pa, pb] = [...r3.players.values()];
  for (const p of r3.players.values()) { p.inGame = true; p.alive = true; p.hp = 3; }
  r3.level = 5;
  r3.startLevel();
  r3.phase = 'playing';
  check('boss exists on level 5 with full hp', r3.boss && r3.boss.hp === r3.boss.maxHp && r3.boss.maxHp > 0);
  const kinds = r3.powerups.map((q) => q.kind);
  check('boss level guarantees sword and shield', kinds.includes('sword') && kinds.includes('shield'));

  // boss falls in, moves, jumps, fires
  pa.x = 40; pa.y = 206 - 18; pb.x = 210; pb.y = 206 - 18;
  r3.boss.fireT = 0.01;
  tick(r3, 40); // give the boss time to drop onto the stage, then fire
  check('boss fires projectiles', r3.projectiles.length > 0);
  check('boss projectile is hostile', r3.projectiles.every((pr) => !pr.friendly));

  // shield reflects: projectile turns friendly (green) and heads for the boss
  r3.projectiles.length = 0;
  r3.boss.fireT = 999; // deterministic from here on
  pa.hp = 3; pb.hp = 3; pa.invulnT = 0; pb.invulnT = 0; pa.alive = pb.alive = true;
  pb.x = 210; pb.y = 206 - 18; pb.vy = 0;
  pb.power = 'shield'; pb.in.use = 1;
  tick(r3, 1); // let shield raise
  const pr1 = { id: 9001, x: pb.x + 6, y: pb.y + 9, vx: -60, vy: 0, friendly: false };
  r3.projectiles.push(pr1);
  r3.boss.x = 40; r3.boss.y = 206 - 26;
  tick(r3, 1);
  check('shield reflects projectile to friendly', pr1.friendly === true);
  check('reflected projectile flies toward boss', pr1.vx < 0);
  check('no damage taken when reflecting', pb.hp === 3);

  // sword reflects too
  pa.power = 'sword'; pa.facing = 1; pa.swingCd = 0;
  const pr2 = { id: 9002, x: pa.x + 18, y: pa.y + 6, vx: -1, vy: 0, friendly: false };
  r3.projectiles.push(pr2);
  pa.edge.use = true;
  tick(r3, 3);
  check('sword swing reflects projectile', pr2.friendly === true);

  // friendly projectile damages the boss
  r3.projectiles.length = 0;
  const bhp = r3.boss.hp;
  r3.projectiles.push({ id: 9003, x: r3.boss.x - 8, y: r3.boss.y + 10, vx: 200, vy: 0, friendly: true });
  tick(r3, 3);
  check('reflected projectile hits boss', r3.boss.hp === bhp - 1);

  // unreflected projectile hurts a player
  pb.in.use = 0; pb.power = null; pb.invulnT = 0;
  tick(r3, 1);
  r3.projectiles.length = 0;
  r3.projectiles.push({ id: 9004, x: pb.x + 6, y: pb.y + 9, vx: 1, vy: 0, friendly: false });
  tick(r3, 1);
  check('hostile projectile damages player', pb.hp === 2);

  // no timer-based level advance during the boss
  r3.timer = 0.01; // should be 9999, but force it to prove the guard
  tick(r3, 3);
  check('boss level does not advance by timer', r3.level === 5);

  // killing the boss loops to level 1, cycle 2
  r3.boss.hp = 1;
  r3.projectiles.push({ id: 9005, x: r3.boss.x - 8, y: r3.boss.y + 10, vx: 200, vy: 0, friendly: true });
  tick(r3, 3);
  check('boss dies and victory pause starts', r3.boss === null && r3.victoryT > 0);
  tick(r3, Math.ceil(2.5 * 30));
  check('after victory: cycle 2, level 1', r3.cycle === 2 && r3.level === 1 && r3.phase === 'intro');

  // cycle 2 spawn pool includes spikes and beams
  r3.hazards.length = 0;
  for (let i = 0; i < 80; i++) r3.spawnHazard();
  const ks = new Set(r3.hazards.map((h) => h.kind));
  check('cycle 2 spawns spikes', ks.has('spike'));
  check('cycle 2 spawns light beams', ks.has('beam'));

  // cycle 1 never spawns them
  const r4 = new Room();
  r4.hazards.length = 0;
  for (let i = 0; i < 80; i++) r4.spawnHazard();
  const ks1 = new Set(r4.hazards.map((h) => h.kind));
  check('cycle 1 has no spikes or beams', !ks1.has('spike') && !ks1.has('beam'));

  // beam hitbox triggers only at 100% opacity
  r3.phase = 'playing';
  r3.hazards.length = 0; r3.powerups.length = 0; r3.spawnT = 999; r3.floorT = 999; r3.timer = 999;
  pa.alive = true; pa.hp = 3; pa.invulnT = 0; pa.power = null; pa.x = 100; pa.y = 206 - 18; pa.vy = 0;
  const beam = {
    id: 9100, kind: 'beam', orient: 'v', x: pa.x - 2, y: 40, w: 13, h: 206 - 40,
    vx: 0, vy: 0, t: 0, charge: 1.6, active: 0.5, life: 99, blockCd: 0,
  };
  r3.hazards.push(beam);
  tick(r3, 2);
  check('charging beam does not hurt', pa.hp === 3);
  beam.t = 1.65;
  tick(r3, 1);
  check('fully opaque beam hurts', pa.hp === 2);
}

// 5th connection is spectator
const extra = [fakeWs(), fakeWs(), fakeWs()];
extra.forEach((w) => room.addSocket(w));
check('max 4 players, rest spectate', room.players.size === 4 && room.spectators.size === 1);

console.log(fails === 0 ? 'ALL TESTS PASSED' : fails + ' TESTS FAILED');
process.exit(fails === 0 ? 0 : 1);
