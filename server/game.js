// LEVEL 5 - authoritative game simulation + room management

export const W = 256, H = 256;
const STAGE_L = 16, STAGE_R = 240, FLOOR_Y = 206;
const GRAV = 640, RUN = 92, JUMP_V = -255;
const PW = 12, PH = 18; // player hitbox
const MAX_PLAYERS = 4;
const COLORS = 4; // white, yellow, red, green

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a = 1) => Math.random() * a;
const aabb = (ax, ay, aw, ah, bx, by, bw, bh) =>
  ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

export class Room {
  constructor() {
    this.players = new Map(); // id -> player (join order preserved)
    this.spectators = new Set(); // sockets beyond max players
    this.nextId = 1;
    this.nextEnt = 1;
    this.phase = 'lobby'; // lobby | countdown | intro | playing | gameover
    this.phaseT = 0;
    this.countdown = 0;
    this.level = 1;
    this.cycle = 1; // increments each time the level 5 boss is beaten
    this.boss = null;
    this.projectiles = [];
    this.victoryT = 0;
    this.timer = 0;
    this.hazards = [];
    this.platforms = [];
    this.powerups = [];
    this.floorState = 0; // 0 normal, 1 warn, 2 red
    this.floorT = 0;
    this.spawnT = 0;
    this.events = [];
  }

  // ---- connection handling ----

  addSocket(ws) {
    if (this.players.size >= MAX_PLAYERS) {
      this.spectators.add(ws);
      this.safeSend(ws, { t: 'full' });
      ws.on('close', () => this.spectators.delete(ws));
      return;
    }
    const id = this.nextId++;
    const used = new Set([...this.players.values()].map((p) => p.color));
    let color = 0;
    for (let c = 0; c < COLORS; c++) if (!used.has(c)) { color = c; break; }
    const p = {
      id, ws, color,
      ready: false, inGame: false, alive: true, hp: 3,
      x: 0, y: 0, vx: 0, vy: 0, facing: 1,
      onGround: false, groundKind: null, wasGround: false,
      power: null, swingT: 0, swingCd: 0, swingHits: null, shield: false,
      invulnT: 0, hurtT: 0,
      in: { l: 0, r: 0, u: 0, d: 0, j: 0, use: 0, inter: 0 },
      edge: { u: false, j: false, use: false, inter: false },
    };
    this.players.set(id, p);
    this.safeSend(ws, { t: 'welcome', id });
    // a fresh (not ready) player cancels any countdown
    if (this.phase === 'countdown') this.phase = 'lobby';
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      this.onMessage(p, m);
    });
    ws.on('close', () => this.removePlayer(id));
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.inGame && p.alive && p.power) this.dropPowerup(p);
    this.players.delete(id);
    if (this.phase === 'countdown' && !this.allReady()) this.phase = 'lobby';
    if (this.phase === 'intro' || this.phase === 'playing') {
      const inGame = [...this.players.values()].filter((q) => q.inGame);
      if (inGame.length === 0 || inGame.every((q) => !q.alive)) this.resetToLobby();
    }
    if (this.players.size === 0 && this.phase !== 'lobby') this.resetToLobby();
  }

  onMessage(p, m) {
    if (m.t === 'in') {
      for (const k of ['l', 'r', 'u', 'd', 'j', 'use', 'inter']) {
        const v = m[k] ? 1 : 0;
        if (v && !p.in[k] && k in p.edge) p.edge[k] = true; // buffer presses between ticks
        p.in[k] = v;
      }
    } else if (m.t === 'ready') {
      if (this.phase === 'lobby' || this.phase === 'countdown') {
        p.ready = !p.ready;
        if (!p.ready && this.phase === 'countdown') this.phase = 'lobby';
      }
    } else if (m.t === 'color') {
      if (this.phase === 'lobby' || this.phase === 'countdown') {
        const d = m.d > 0 ? 1 : -1;
        p.color = (p.color + d + COLORS) % COLORS;
      }
    }
  }

  allReady() {
    return this.players.size > 0 && [...this.players.values()].every((p) => p.ready);
  }

  // ---- phase control ----

  // effective difficulty keeps scaling across cycles
  diff() { return this.level + (this.cycle - 1) * 5; }

  startGame() {
    this.level = Number(process.env.START_LEVEL) || 1; // dev overrides for testing
    this.cycle = Number(process.env.START_CYCLE) || 1;
    for (const p of this.players.values()) {
      p.inGame = true; p.alive = true; p.hp = 3;
      p.power = null; p.shield = false; p.swingT = 0;
      p.invulnT = 0; p.hurtT = 0;
      p.edge.j = p.edge.u = p.edge.use = p.edge.inter = false;
    }
    this.startLevel();
  }

  startLevel() {
    this.phase = 'intro';
    this.phaseT = 2.6;
    this.hazards = [];
    this.powerups = [];
    this.projectiles = [];
    this.boss = null;
    this.victoryT = 0;
    this.floorState = 0;
    this.floorT = 6 + rand(8);
    this.spawnT = 0.8;
    this.timer = 30 + rand(30);

    // yellow platforms: pick 2-4 from height bands
    this.platforms = [];
    const bands = [188, 164, 140, 118].sort(() => Math.random() - 0.5);
    const count = 2 + Math.floor(rand(3));
    for (let i = 0; i < count; i++) {
      const w = 20 + Math.floor(rand(18));
      this.platforms.push({
        id: this.nextEnt++,
        x: Math.floor(STAGE_L + 8 + rand(STAGE_R - STAGE_L - 16 - w)),
        y: bands[i % bands.length] + Math.floor(rand(8)) - 4,
        w, h: 4, temp: false, life: 0,
      });
    }

    // powerups on the floor
    const puCount = 1 + (rand() < 0.55 ? 1 : 0);
    for (let i = 0; i < puCount; i++) {
      this.powerups.push({
        id: this.nextEnt++,
        kind: rand() < 0.5 ? 'sword' : 'shield',
        x: Math.floor(STAGE_L + 20 + rand(STAGE_R - STAGE_L - 50)),
        y: FLOOR_Y - 9, vy: 0,
      });
    }

    // floating health pickups from level 2 onward (no auto-healing between levels)
    if (this.level >= 2) {
      const n = 1 + (rand() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        this.powerups.push({
          id: this.nextEnt++, kind: 'health', float: true,
          x: Math.floor(STAGE_L + 24 + rand(STAGE_R - STAGE_L - 48)),
          y: 110 + Math.floor(rand(70)), vy: 0,
        });
      }
    }

    // respawn anyone who died last level, then drop everyone from the sky
    const drops = [...this.players.values()].filter((p) => p.inGame);
    drops.forEach((p, i) => {
      if (!p.alive) { p.alive = true; p.hp = 3; p.power = null; p.shield = false; }
      const span = STAGE_R - STAGE_L - 60;
      p.x = STAGE_L + 30 + (drops.length > 1 ? (span * i) / (drops.length - 1) : span / 2);
      p.y = -30 - i * 14;
      p.vx = 0; p.vy = 0; p.onGround = false;
      p.invulnT = 0; p.hurtT = 0; p.swingT = 0;
    });

    if (this.level === 5) this.setupBoss();
  }

  setupBoss() {
    this.timer = 9999; // the boss level ends by defeating the boss, not by timer
    const n = Math.max(1, [...this.players.values()].filter((p) => p.inGame).length);
    const hp = Number(process.env.BOSS_HP) || 10 + (n - 1) * 3 + (this.cycle - 1) * 4;
    this.boss = {
      x: W / 2 - 14, y: -70, w: 28, h: 26,
      hp, maxHp: hp, vx: 0, vy: 0, onGround: false, facing: -1,
      dirT: 1.2, jumpT: 2.5, fireT: 2.8, hurtT: 0,
    };
    // reflecting requires gear: guarantee both a sword and a shield on the floor
    const kinds = this.powerups.map((pu) => pu.kind);
    for (const need of ['sword', 'shield']) {
      if (!kinds.includes(need)) {
        this.powerups.push({
          id: this.nextEnt++, kind: need,
          x: Math.floor(STAGE_L + 30 + rand(STAGE_R - STAGE_L - 70)),
          y: FLOOR_Y - 9, vy: 0,
        });
      }
    }
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.hazards = [];
    this.powerups = [];
    this.platforms = [];
    this.boss = null;
    this.projectiles = [];
    this.victoryT = 0;
    this.floorState = 0;
    for (const p of this.players.values()) {
      p.ready = false; p.inGame = false; p.alive = true; p.hp = 3;
      p.power = null; p.shield = false; p.swingT = 0; p.hurtT = 0; p.invulnT = 0;
    }
  }

  // ---- main tick ----

  tick(dt) {
    for (const p of this.players.values()) {
      p.swingT = Math.max(0, p.swingT - dt);
      p.swingCd = Math.max(0, p.swingCd - dt);
      p.invulnT = Math.max(0, p.invulnT - dt);
      p.hurtT = Math.max(0, p.hurtT - dt);
    }

    switch (this.phase) {
      case 'lobby':
        if (this.allReady()) { this.phase = 'countdown'; this.countdown = 3.6; }
        break;
      case 'countdown':
        if (!this.allReady()) { this.phase = 'lobby'; break; }
        this.countdown -= dt;
        if (this.countdown <= 0) this.startGame();
        break;
      case 'intro':
        this.simPlayers(dt);
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.phase = 'playing';
        break;
      case 'playing':
        this.simPlayers(dt);
        if (this.level === 5) {
          this.simBoss(dt);
          this.simProjectiles(dt);
        } else {
          this.simHazards(dt);
          this.simFloor(dt);
        }
        this.simPowerups(dt);
        this.checkCollisions();

        // boss defeated: short victory beat, then loop to level 1 of the next cycle
        if (this.boss && this.boss.hp <= 0) {
          this.events.push({ e: 'bossdead', x: this.boss.x + this.boss.w / 2, y: this.boss.y + this.boss.h / 2 });
          this.boss = null;
          this.projectiles = [];
          this.victoryT = 2.4;
        }
        if (this.victoryT > 0) {
          this.victoryT -= dt;
          if (this.victoryT <= 0) {
            this.cycle++;
            this.level = 1;
            this.events.push({ e: 'nextlevel' });
            this.startLevel();
          }
          break;
        }

        this.timer -= dt;
        if (this.level !== 5 && this.timer <= 0) {
          this.level++;
          this.events.push({ e: 'nextlevel' });
          this.startLevel();
          break;
        }
        {
          const inGame = [...this.players.values()].filter((p) => p.inGame);
          if (inGame.length > 0 && inGame.every((p) => !p.alive)) {
            this.phase = 'gameover';
            this.phaseT = 2.8;
          }
        }
        break;
      case 'gameover':
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.resetToLobby();
        break;
    }
  }

  // ---- players ----

  simPlayers(dt) {
    for (const p of this.players.values()) {
      if (!p.inGame || !p.alive) continue;
      const move = (p.in.r ? 1 : 0) - (p.in.l ? 1 : 0);
      p.vx = move * RUN;
      if (move) p.facing = move;

      if ((p.edge.j || p.edge.u) && p.onGround) {
        p.vy = JUMP_V;
        p.onGround = false;
        this.events.push({ e: 'jump', x: p.x + PW / 2, y: p.y + PH });
      }

      p.vy += GRAV * dt;
      if (p.vy > 430) p.vy = 430;
      const prevBottom = p.y + PH;
      p.x = clamp(p.x + p.vx * dt, STAGE_L + 2, STAGE_R - 2 - PW);
      p.y += p.vy * dt;

      p.wasGround = p.onGround;
      p.onGround = false;
      p.groundKind = null;
      if (p.vy >= 0) {
        const bottom = p.y + PH;
        if (prevBottom <= FLOOR_Y + 0.01 && bottom >= FLOOR_Y) {
          p.y = FLOOR_Y - PH; p.vy = 0; p.onGround = true; p.groundKind = 'floor';
        } else if (!p.in.d) { // holding down drops through platforms
          for (const pl of this.platforms) {
            if (p.x + PW > pl.x && p.x < pl.x + pl.w &&
                prevBottom <= pl.y + 0.01 && bottom >= pl.y) {
              p.y = pl.y - PH; p.vy = 0; p.onGround = true; p.groundKind = 'plat';
              break;
            }
          }
        }
      }
      if (!p.wasGround && p.onGround) {
        this.events.push({ e: 'land', x: p.x + PW / 2, y: p.y + PH });
      }
      if (p.y > H + 60) { p.y = -30; p.vy = 0; } // safety net

      // F / left click: pick up when overlapping a powerup, otherwise use held item
      if (p.edge.use) {
        const target = this.findPowerupOverlap(p);
        if (target) {
          this.pickUp(p, target);
        } else if (p.power === 'sword' && p.swingCd <= 0) {
          p.swingT = 0.3; p.swingCd = 0.5; p.swingHits = new Set();
          this.events.push({ e: 'swing', id: p.id });
        }
      }
      p.shield = p.power === 'shield' && !!p.in.use;

      if (p.swingT > 0.03 && p.swingT < 0.27 && p.power === 'sword') this.doSwing(p);

      // E / right click: drop the held powerup
      if (p.edge.inter && p.power) {
        this.dropPowerup(p);
        this.events.push({ e: 'drop', x: p.x + PW / 2, y: p.y + PH });
      }

      p.edge.j = p.edge.u = p.edge.use = p.edge.inter = false;
    }
  }

  doSwing(p) {
    // tight box matching the visible blade arc: in front of the player,
    // from just above the head down to the feet
    const reach = 13;
    const hx = p.facing > 0 ? p.x + PW - 2 : p.x + 2 - reach;
    const hy = p.y - 8, hw = reach, hh = PH + 8;
    for (const h of this.hazards) {
      if (h.kind === 'beam') continue; // light can't be cut
      if (p.swingHits.has(h.id)) continue;
      if (!aabb(hx, hy, hw, hh, h.x, h.y, h.w, h.h)) continue;
      p.swingHits.add(h.id);
      if (h.kind === 'tri') {
        const s = Math.max(Math.abs(h.vx), Math.abs(h.vy)) || 70;
        if (h.axis === 'h') {
          h.axis = 'v'; h.vx = 0; h.vy = -s;
          h.y = clamp(h.y, 52, FLOOR_Y - h.h - 2);
        } else {
          h.axis = 'h'; h.vy = 0; h.vx = p.facing * s;
          h.x = clamp(h.x, STAGE_L + 2, STAGE_R - h.w - 2);
        }
      } else { // ball: knocked back
        h.vx = p.facing * Math.max(Math.abs(h.vx), 60) * 1.15;
      }
      h.life = Math.max(h.life, 5);
      this.events.push({ e: 'clang', x: h.x + h.w / 2, y: h.y + h.h / 2 });
    }
    // the sword also reflects boss projectiles
    for (const pr of this.projectiles) {
      if (pr.friendly) continue;
      if (aabb(hx, hy, hw, hh, pr.x - 4, pr.y - 4, 8, 8)) this.reflect(pr);
    }
  }

  findPowerupOverlap(p) {
    for (const pu of this.powerups) {
      if (pu.kind === 'health') continue; // health is collected automatically
      if (aabb(p.x - 4, p.y - 4, PW + 8, PH + 8, pu.x - 4, pu.y - 4, 8, 9)) return pu;
    }
    return null;
  }

  pickUp(p, target) {
    if (p.power) {
      const old = p.power;
      p.power = target.kind;
      target.kind = old; // swap in place
    } else {
      p.power = target.kind;
      this.powerups = this.powerups.filter((q) => q !== target);
    }
    this.events.push({ e: 'pickup', x: p.x + PW / 2, y: p.y });
  }

  dropPowerup(p) {
    this.powerups.push({
      id: this.nextEnt++, kind: p.power,
      x: clamp(p.x + PW / 2, STAGE_L + 8, STAGE_R - 8),
      y: p.y + PH - 9, vy: 0,
    });
    p.power = null;
    p.shield = false;
  }

  simPowerups(dt) {
    for (const pu of this.powerups) {
      if (pu.float) continue; // health pickups hover in place
      // dropped powerups fall to the floor / a platform
      let landed = pu.y >= FLOOR_Y - 9;
      if (!landed) {
        for (const pl of this.platforms) {
          if (pu.x + 4 > pl.x && pu.x - 4 < pl.x + pl.w &&
              pu.y + 9 >= pl.y && pu.y + 9 <= pl.y + pl.h + 2 && pu.vy >= 0) {
            pu.y = pl.y - 9; pu.vy = 0; landed = true; break;
          }
        }
      }
      if (!landed) {
        pu.vy = (pu.vy || 0) + GRAV * dt * 0.6;
        pu.y = Math.min(pu.y + pu.vy * dt, FLOOR_Y - 9);
      }
    }
  }

  // ---- boss (level 5) ----

  simBoss(dt) {
    const b = this.boss;
    if (!b) return;
    b.hurtT = Math.max(0, b.hurtT - dt);
    b.dirT -= dt; b.jumpT -= dt; b.fireT -= dt;

    if (b.dirT <= 0) {
      b.vx = (rand() < 0.5 ? -1 : 1) * (38 + rand(46));
      b.dirT = 0.8 + rand(1.5);
    }
    if (b.jumpT <= 0 && b.onGround) {
      b.vy = -(190 + rand(130));
      b.onGround = false;
      b.jumpT = 1.4 + rand(2.2);
    }

    b.vy += GRAV * dt * 0.85;
    if (b.vy > 420) b.vy = 420;
    b.x = clamp(b.x + b.vx * dt, STAGE_L + 2, STAGE_R - 2 - b.w);
    b.y += b.vy * dt;
    if (b.y + b.h >= FLOOR_Y) { b.y = FLOOR_Y - b.h; b.vy = 0; b.onGround = true; }
    if (b.vx) b.facing = b.vx < 0 ? -1 : 1;

    // fire a projectile at a random living player (not while dropping in)
    if (b.fireT <= 0 && b.y > 10) {
      const targets = [...this.players.values()].filter((p) => p.inGame && p.alive);
      if (targets.length) {
        const t = targets[Math.floor(rand(targets.length))];
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const dx = t.x + PW / 2 - cx, dy = t.y + PH / 2 - cy;
        const d = Math.hypot(dx, dy) || 1;
        const sp = 92 + (this.cycle - 1) * 14;
        this.projectiles.push({
          id: this.nextEnt++, x: cx, y: cy,
          vx: (dx / d) * sp, vy: (dy / d) * sp, friendly: false,
        });
        this.events.push({ e: 'bossfire', x: cx, y: cy });
      }
      b.fireT = Math.max(0.8, 2.1 - (this.cycle - 1) * 0.2) * (0.7 + rand(0.6));
    }
  }

  simProjectiles(dt) {
    const b = this.boss;
    this.projectiles = this.projectiles.filter((pr) => {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (pr.x < STAGE_L - 30 || pr.x > STAGE_R + 30 || pr.y < -50 || pr.y > H + 40) return false;
      if (pr.friendly && b && aabb(pr.x - 3, pr.y - 3, 6, 6, b.x, b.y, b.w, b.h)) {
        b.hp--;
        b.hurtT = 0.35;
        this.events.push({ e: 'bosshit', x: pr.x, y: pr.y });
        return false;
      }
      return true;
    });
  }

  // a reflected projectile turns green and homes at the boss
  reflect(pr) {
    const b = this.boss;
    const sp = (Math.hypot(pr.vx, pr.vy) || 95) * 1.25;
    if (b) {
      const dx = b.x + b.w / 2 - pr.x, dy = b.y + b.h / 2 - pr.y;
      const d = Math.hypot(dx, dy) || 1;
      pr.vx = (dx / d) * sp;
      pr.vy = (dy / d) * sp;
    } else {
      pr.vx = -pr.vx * 1.25;
      pr.vy = -pr.vy * 1.25;
    }
    pr.friendly = true;
    this.events.push({ e: 'reflect', x: pr.x, y: pr.y });
  }

  // ---- hazards ----

  simHazards(dt) {
    this.spawnT -= dt;
    const maxH = Math.min(3 + this.diff(), 10);
    if (this.spawnT <= 0 && this.hazards.length < maxH) {
      this.spawnHazard();
      this.spawnT = Math.max(0.6, 2.4 - this.diff() * 0.18) * (0.7 + rand(0.6));
    }
    for (const h of this.hazards) {
      h.life -= dt;
      h.blockCd = Math.max(0, (h.blockCd || 0) - dt);
      if (h.kind === 'beam') { h.t += dt; continue; } // beams fade in, they don't move
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.kind === 'tri' && h.axis === 'v') {
        const minY = 50, maxY = FLOOR_Y - h.h;
        if (h.y < minY) { h.y = minY; h.vy = Math.abs(h.vy); }
        if (h.y > maxY) { h.y = maxY; h.vy = -Math.abs(h.vy); }
      } else if ((h.kind === 'tri' && h.axis === 'h') || h.kind === 'spike') {
        const minX = STAGE_L + 2, maxX = STAGE_R - h.w - 2;
        if (h.x < minX) { h.x = minX; h.vx = Math.abs(h.vx); }
        if (h.x > maxX) { h.x = maxX; h.vx = -Math.abs(h.vx); }
      }
    }
    this.hazards = this.hazards.filter((h) => {
      if (h.kind === 'ball') return h.x > STAGE_L - 40 && h.x < STAGE_R + 40 && h.life > 0;
      if (h.kind === 'beam') return h.t < h.charge + h.active;
      return h.life > 0;
    });
  }

  spawnHazard() {
    const speed = 55 + this.diff() * 7 + rand(35);
    const r = rand();
    const dir = rand() < 0.5 ? 1 : -1;
    const cyc2 = this.cycle >= 2; // spikes and light beams join the pool after beating the boss
    if (r < (cyc2 ? 0.28 : 0.42)) { // horizontal triangle
      this.hazards.push({
        id: this.nextEnt++, kind: 'tri', axis: 'h',
        x: dir > 0 ? STAGE_L + 3 : STAGE_R - 16,
        y: 106 + rand(84), w: 13, h: 13,
        vx: dir * speed, vy: 0, life: 8 + rand(4), blockCd: 0,
      });
    } else if (r < (cyc2 ? 0.52 : 0.75)) { // vertical triangle
      this.hazards.push({
        id: this.nextEnt++, kind: 'tri', axis: 'v',
        x: STAGE_L + 12 + rand(STAGE_R - STAGE_L - 40),
        y: 52, w: 13, h: 13,
        vx: 0, vy: speed, life: 8 + rand(4), blockCd: 0,
      });
    } else if (!cyc2 || r < 0.70) { // rolling ball
      this.hazards.push({
        id: this.nextEnt++, kind: 'ball',
        x: dir > 0 ? STAGE_L - 20 : STAGE_R + 4,
        y: FLOOR_Y - 16, w: 16, h: 16,
        vx: dir * (speed * 1.15), vy: 0, life: 14, blockCd: 0,
      });
    } else if (r < 0.85) { // ground spike crawler
      this.hazards.push({
        id: this.nextEnt++, kind: 'spike',
        x: dir > 0 ? STAGE_L + 3 : STAGE_R - 21,
        y: FLOOR_Y - 9, w: 18, h: 9,
        vx: dir * speed * 0.85, vy: 0, life: 11 + rand(4), blockCd: 0,
      });
    } else { // light beam: fades 0 -> 100% opacity, hitbox only at 100%
      const vert = rand() < 0.55;
      const charge = Math.max(1.1, 1.9 - this.diff() * 0.04);
      this.hazards.push(vert ? {
        id: this.nextEnt++, kind: 'beam', orient: 'v',
        x: Math.floor(STAGE_L + 8 + rand(STAGE_R - STAGE_L - 30)), y: 40,
        w: 13, h: FLOOR_Y - 40,
        vx: 0, vy: 0, t: 0, charge, active: 0.5, life: 99, blockCd: 0,
      } : {
        id: this.nextEnt++, kind: 'beam', orient: 'h',
        x: STAGE_L + 2, y: Math.floor(96 + rand(96)),
        w: STAGE_R - STAGE_L - 4, h: 11,
        vx: 0, vy: 0, t: 0, charge, active: 0.5, life: 99, blockCd: 0,
      });
    }
  }

  simFloor(dt) {
    this.floorT -= dt;
    if (this.floorT > 0) return;
    if (this.floorState === 0) {
      this.floorState = 1;
      this.floorT = 1.6;
      // helper platforms appear before the floor turns red
      const n = 1 + (rand() < 0.6 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const w = 24 + Math.floor(rand(14));
        this.platforms.push({
          id: this.nextEnt++,
          x: Math.floor(STAGE_L + 10 + rand(STAGE_R - STAGE_L - 20 - w)),
          y: 160 + Math.floor(rand(30)),
          w, h: 4, temp: true, life: 1.6 + 3.6 + 2.5,
        });
      }
      this.events.push({ e: 'floorwarn' });
    } else if (this.floorState === 1) {
      this.floorState = 2;
      this.floorT = 2.4 + rand(1.2);
      this.events.push({ e: 'floorred' });
    } else {
      this.floorState = 0;
      this.floorT = 7 + rand(9);
    }
  }

  // ---- damage ----

  checkCollisions() {
    // temp platform expiry
    for (const pl of this.platforms) if (pl.temp) pl.life -= 1 / 30;
    this.platforms = this.platforms.filter((pl) => !pl.temp || pl.life > 0);

    for (const p of this.players.values()) {
      if (!p.inGame || !p.alive) continue;

      // touching a health pickup heals one dot (only when hurt)
      if (p.hp < 3) {
        for (const pu of this.powerups) {
          if (pu.kind !== 'health') continue;
          if (!aabb(p.x - 2, p.y - 2, PW + 4, PH + 4, pu.x - 5, pu.y - 5, 10, 10)) continue;
          p.hp++;
          p.hurtT = 2.2; // show the dots so the heal is visible
          this.powerups = this.powerups.filter((q) => q !== pu);
          this.events.push({ e: 'heal', x: p.x + PW / 2, y: p.y });
          break;
        }
      }

      // boss projectiles: shield reflects them, otherwise they hurt
      for (const pr of this.projectiles) {
        if (pr.friendly || pr.dead) continue;
        if (!aabb(p.x - 1, p.y - 1, PW + 2, PH + 2, pr.x - 4, pr.y - 4, 8, 8)) continue;
        if (p.shield) {
          this.reflect(pr);
        } else if (p.invulnT <= 0) {
          pr.dead = true;
          this.damage(p, -80);
        }
      }

      // boss body contact
      if (this.boss && p.invulnT <= 0) {
        const b = this.boss;
        if (aabb(p.x, p.y, PW, PH, b.x + 3, b.y + 3, b.w - 6, b.h - 6)) this.damage(p, -140);
      }

      if (p.invulnT <= 0) {
        for (const h of this.hazards) {
          if (h.kind === 'beam') {
            // hitbox triggers only once the beam reaches full opacity
            if (h.t >= h.charge && aabb(p.x, p.y, PW, PH, h.x + 2, h.y + 1, h.w - 4, h.h - 2)) {
              this.damage(p, -80);
              break;
            }
            continue;
          }
          if (!aabb(p.x, p.y, PW, PH, h.x + 2, h.y + 2, h.w - 4, h.h - 4)) continue;
          if (p.shield && h.blockCd <= 0) {
            // bounce the hazard away
            const away = Math.sign(h.x + h.w / 2 - (p.x + PW / 2)) || p.facing;
            if (h.kind === 'ball' || h.axis === 'h') {
              h.vx = away * Math.max(Math.abs(h.vx), 60);
              h.x += away * 8;
            } else {
              h.vy = -Math.abs(h.vy || 60);
              h.y -= 8;
            }
            h.blockCd = 0.5;
            this.events.push({ e: 'block', x: p.x + PW / 2 + p.facing * 8, y: p.y + 6 });
          } else if (h.blockCd <= 0) {
            this.damage(p, -80);
            break;
          }
        }
      }

      // red floor burns
      if (this.floorState === 2 && p.onGround && p.groundKind === 'floor' && p.invulnT <= 0) {
        this.damage(p, -230);
      }
    }
    this.projectiles = this.projectiles.filter((pr) => !pr.dead);
  }

  damage(p, popVy) {
    p.hp--;
    p.invulnT = 1.6;
    p.hurtT = 2.2;
    p.vy = popVy;
    p.onGround = false;
    if (p.hp <= 0) {
      p.alive = false;
      if (p.power) this.dropPowerup(p);
      this.events.push({ e: 'death', x: p.x + PW / 2, y: p.y + PH / 2, c: p.color });
    } else {
      this.events.push({ e: 'hit', x: p.x + PW / 2, y: p.y + PH / 2, id: p.id });
    }
  }

  // ---- networking ----

  snapshot() {
    return {
      t: 'state',
      ph: this.phase,
      pt: +this.phaseT.toFixed(3),
      cd: +this.countdown.toFixed(3),
      lv: this.level,
      cy: this.cycle,
      tm: Math.max(0, this.timer),
      fl: this.floorState,
      vt: this.victoryT > 0 ? 1 : 0,
      bs: this.boss ? {
        x: +this.boss.x.toFixed(1), y: +this.boss.y.toFixed(1),
        w: this.boss.w, h: this.boss.h,
        hp: this.boss.hp, mhp: this.boss.maxHp,
        ht: this.boss.hurtT > 0 ? 1 : 0, f: this.boss.facing,
        vx: Math.round(this.boss.vx), og: this.boss.onGround ? 1 : 0,
      } : null,
      pr: this.projectiles.map((pr) => ({
        id: pr.id, x: +pr.x.toFixed(1), y: +pr.y.toFixed(1), fr: pr.friendly ? 1 : 0,
      })),
      pl: [...this.players.values()].map((p) => ({
        id: p.id, c: p.color, rdy: p.ready ? 1 : 0,
        ig: p.inGame ? 1 : 0, al: p.alive ? 1 : 0,
        x: +p.x.toFixed(1), y: +p.y.toFixed(1),
        vx: Math.round(p.vx), f: p.facing,
        hp: p.hp, ht: +p.hurtT.toFixed(2), iv: p.invulnT > 0 ? 1 : 0,
        og: p.onGround ? 1 : 0,
        pw: p.power, sw: +p.swingT.toFixed(2), sh: p.shield ? 1 : 0,
      })),
      hz: this.hazards.map((h) => ({
        id: h.id, k: h.kind, ax: h.axis || null,
        x: +h.x.toFixed(1), y: +h.y.toFixed(1),
        vx: Math.round(h.vx), vy: Math.round(h.vy), w: h.w, h: h.h,
        ...(h.kind === 'beam' ? {
          o: h.orient,
          a: +Math.min(1, h.t / h.charge).toFixed(2),
          act: h.t >= h.charge ? 1 : 0,
        } : null),
      })),
      pf: this.platforms.map((pl) => ({ id: pl.id, x: pl.x, y: pl.y, w: pl.w, h: pl.h })),
      pu: this.powerups.map((pu) => ({ id: pu.id, k: pu.kind, x: Math.round(pu.x), y: Math.round(pu.y), fl: pu.float ? 1 : 0 })),
      ev: this.events,
    };
  }

  broadcast() {
    const msg = JSON.stringify(this.snapshot());
    this.events = [];
    for (const p of this.players.values()) this.safeSendRaw(p.ws, msg);
    for (const ws of this.spectators) this.safeSendRaw(ws, msg);
  }

  safeSend(ws, obj) { this.safeSendRaw(ws, JSON.stringify(obj)); }
  safeSendRaw(ws, msg) {
    if (ws.readyState === 1) { try { ws.send(msg); } catch {} }
  }
}
