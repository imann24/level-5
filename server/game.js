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

  startGame() {
    this.level = 1;
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

    // drop players from the sky
    const alive = [...this.players.values()].filter((p) => p.inGame && p.alive);
    alive.forEach((p, i) => {
      const span = STAGE_R - STAGE_L - 60;
      p.x = STAGE_L + 30 + (alive.length > 1 ? (span * i) / (alive.length - 1) : span / 2);
      p.y = -30 - i * 14;
      p.vx = 0; p.vy = 0; p.onGround = false;
    });
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.hazards = [];
    this.powerups = [];
    this.platforms = [];
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
        this.simHazards(dt);
        this.simFloor(dt);
        this.simPowerups(dt);
        this.checkCollisions();
        this.timer -= dt;
        if (this.timer <= 0) {
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
        } else {
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

      // sword swing (press) / shield raise (held)
      if (p.edge.use && p.power === 'sword' && p.swingCd <= 0) {
        p.swingT = 0.3; p.swingCd = 0.5; p.swingHits = new Set();
        this.events.push({ e: 'swing', id: p.id });
      }
      p.shield = p.power === 'shield' && !!p.in.use;

      if (p.swingT > 0.03 && p.swingT < 0.27 && p.power === 'sword') this.doSwing(p);

      if (p.edge.inter) this.tryInteract(p);

      p.edge.j = p.edge.u = p.edge.use = p.edge.inter = false;
    }
  }

  doSwing(p) {
    const hx = p.facing > 0 ? p.x + PW - 3 : p.x - 21;
    const hy = p.y - 15, hw = 24, hh = PH + 20;
    for (const h of this.hazards) {
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
  }

  tryInteract(p) {
    let target = null;
    for (const pu of this.powerups) {
      if (aabb(p.x - 4, p.y - 4, PW + 8, PH + 8, pu.x - 4, pu.y - 4, 8, 9)) { target = pu; break; }
    }
    if (target) {
      if (p.power) {
        const old = p.power;
        p.power = target.kind;
        target.kind = old; // swap in place
      } else {
        p.power = target.kind;
        this.powerups = this.powerups.filter((q) => q !== target);
      }
      this.events.push({ e: 'pickup', x: p.x + PW / 2, y: p.y });
    } else if (p.power) {
      this.dropPowerup(p);
      this.events.push({ e: 'drop', x: p.x + PW / 2, y: p.y + PH });
    }
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

  // ---- hazards ----

  simHazards(dt) {
    this.spawnT -= dt;
    const maxH = Math.min(3 + this.level, 9);
    if (this.spawnT <= 0 && this.hazards.length < maxH) {
      this.spawnHazard();
      this.spawnT = Math.max(0.7, 2.4 - this.level * 0.18) * (0.7 + rand(0.6));
    }
    for (const h of this.hazards) {
      h.life -= dt;
      h.blockCd = Math.max(0, (h.blockCd || 0) - dt);
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.kind === 'tri') {
        if (h.axis === 'h') {
          const minX = STAGE_L + 2, maxX = STAGE_R - h.w - 2;
          if (h.x < minX) { h.x = minX; h.vx = Math.abs(h.vx); }
          if (h.x > maxX) { h.x = maxX; h.vx = -Math.abs(h.vx); }
        } else {
          const minY = 50, maxY = FLOOR_Y - h.h;
          if (h.y < minY) { h.y = minY; h.vy = Math.abs(h.vy); }
          if (h.y > maxY) { h.y = maxY; h.vy = -Math.abs(h.vy); }
        }
      }
    }
    this.hazards = this.hazards.filter((h) => {
      if (h.kind === 'ball') return h.x > STAGE_L - 40 && h.x < STAGE_R + 40 && h.life > 0;
      return h.life > 0;
    });
  }

  spawnHazard() {
    const speed = 55 + this.level * 7 + rand(35);
    const r = rand();
    const dir = rand() < 0.5 ? 1 : -1;
    if (r < 0.42) { // horizontal triangle
      this.hazards.push({
        id: this.nextEnt++, kind: 'tri', axis: 'h',
        x: dir > 0 ? STAGE_L + 3 : STAGE_R - 16,
        y: 106 + rand(84), w: 13, h: 13,
        vx: dir * speed, vy: 0, life: 8 + rand(4), blockCd: 0,
      });
    } else if (r < 0.75) { // vertical triangle
      this.hazards.push({
        id: this.nextEnt++, kind: 'tri', axis: 'v',
        x: STAGE_L + 12 + rand(STAGE_R - STAGE_L - 40),
        y: 52, w: 13, h: 13,
        vx: 0, vy: speed, life: 8 + rand(4), blockCd: 0,
      });
    } else { // rolling ball
      this.hazards.push({
        id: this.nextEnt++, kind: 'ball',
        x: dir > 0 ? STAGE_L - 20 : STAGE_R + 4,
        y: FLOOR_Y - 16, w: 16, h: 16,
        vx: dir * (speed * 1.15), vy: 0, life: 14, blockCd: 0,
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

      if (p.invulnT <= 0) {
        for (const h of this.hazards) {
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
      tm: Math.max(0, this.timer),
      fl: this.floorState,
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
      })),
      pf: this.platforms.map((pl) => ({ id: pl.id, x: pl.x, y: pl.y, w: pl.w, h: pl.h })),
      pu: this.powerups.map((pu) => ({ id: pu.id, k: pu.kind, x: Math.round(pu.x), y: Math.round(pu.y) })),
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
