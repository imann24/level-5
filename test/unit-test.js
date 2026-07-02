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

// powerup pickup + swap + drop
room.powerups.length = 0;
room.powerups.push({ id: 2000, kind: 'shield', x: b.x + 4, y: b.y + 5, vy: 0 });
b.edge.inter = true;
tick(room, 1);
check('overlap pickup swaps: now shield', b.power === 'shield');
check('old sword dropped in place', room.powerups.length === 1 && room.powerups[0].kind === 'sword');
b.edge.inter = true;
tick(room, 1);
check('pick dropped sword back', b.power === 'sword');
b.x = 200; b.edge.inter = true;
tick(room, 1);
check('interact away from powerup drops held', b.power === null && room.powerups.length === 2);

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

// 5th connection is spectator
const extra = [fakeWs(), fakeWs(), fakeWs()];
extra.forEach((w) => room.addSocket(w));
check('max 4 players, rest spectate', room.players.size === 4 && room.spectators.size === 1);

console.log(fails === 0 ? 'ALL TESTS PASSED' : fails + ' TESTS FAILED');
process.exit(fails === 0 ? 0 : 1);
