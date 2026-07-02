# LEVEL 5

Fast-paced multiplayer online dodging game with a thick-pixel, hand-drawn retro look.

## Run

```bash
npm install
npm start
```

Then open http://localhost:3000 in up to 4 browser windows. Each visitor becomes a player in the lobby.
Set a different port with `PORT=3210 npm start` if 3000 is taken.

## How to play

**Lobby (title screen)**
- Left / Right arrows: change your sprite color (white, yellow, red, green)
- Enter: ready up / unready (a red X means not ready, a green check means ready)
- When everyone is ready a countdown starts; pressing Enter during it cancels

**In game**
- Arrow keys or WASD: move
- Space: jump
- Down (or S): drop through a yellow platform you're standing on
- F or left mouse click: pick up a powerup you're standing on; otherwise swing sword / raise shield
- E or right mouse click: drop the powerup you hold

Dodge the red hazards until the timer runs out to reach the next generated level.
Triangles patrol vertically or horizontally, balls roll across the stage, and the
floor sometimes turns completely red (yellow platforms appear so you can escape it).

You have 3 hit points (green dots shown briefly over your head when hit). Lose them
all and your character disappears until the next level, when everyone who died is
respawned. If every player disappears, the game ends and everyone returns to the lobby.

From level 2 onward, green floating health pickups appear; touch one while hurt to
restore a hit point (there is no automatic healing between levels).

**Boss fight (level 5)**

Level 5 is a boss fight: a big red brute with a health bar who runs, jumps, and
fires projectiles at you. Reflect his projectiles back with a sword swing or a
raised shield — reflected shots turn green and home in on him. Deplete his
health bar to win the fight.

Beating the boss loops the game back to level 1 on a harder cycle with new
obstacles: red spikes that scuttle along the ground, and light beams (vertical
columns or horizontal bars) that fade in from 0 to 100% opacity — their hitbox
only triggers at full opacity, so dodge out of their line before they solidify.

**Powerups**
- Sword: swinging it at a hazard flips its orientation (horizontal movers become vertical and vice versa; balls are knocked back)
- Shield: raise it to block hazards without taking damage
- You can only hold one powerup; picking up a second one drops the first
