'use strict';
/* Brainrot Heist multiplayer server.
   Clients send their own position. Everything that touches money or ownership
   (buy, sell, steal, deposit, collect, income) is decided here. */
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { WebSocketServer } = require('ws');
const BH = require('./shared.js');

const { SP, RAR, PITY, PLAN, ENT_X, ROWS, ZLEN, BELT, BASE_D, BASE_W, SPF, FLOORS, FH, BTN, LASER_COST, LASER_MS } = BH;
const PORT = process.env.PORT || 3000;
const MAX = PLAN.length;
const LASER_TIME = Number(process.env.LASER_MS) || LASER_MS;
const SLOTS = SPF * FLOORS;   /* 4 floors of 15 */
/* admin panel: the password is checked here on the server, never in the browser. Set ADMIN_PASSWORD on Render to change it. */
const ADMIN_HASH = crypto.createHash('sha256').update(String(process.env.ADMIN_PASSWORD || 'P@hul2110')).digest();
const adminFailLog = [];
const saves = new Map();     /* device id -> { cash, owned }: the server's own copy of each player's progress */
const WALK_SPD = Number(process.env.WALK_SPD) || 4.2;      /* bought brainrots stroll home at this speed */
const RAG_MS = 2200;       /* ragdoll time after a bat hit */
const SWING_CD = 700;
const SWING_RANGE = 6.5;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;

/* ---------------- static files ---------------- */
const HTML = ['public/index.html', 'text/html; charset=utf-8'];
const FILES = {
  '/': HTML,
  '/index.html': HTML,
  '/shared.js': ['shared.js', 'application/javascript; charset=utf-8']
};
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  const f = FILES[url];
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  fs.readFile(path.join(__dirname, f[0]), (err, buf) => {
    if (err) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Server error'); return; }
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

/* ---------------- world state ---------------- */
const bases = PLAN.map((pl, i) => ({
  idx: i, owner: null, slots: new Array(SLOTS).fill(null), laserUntil: 0
}));
let uidN = 0, itemN = 0, pidN = 0, walkN = 0, spawnT = 0.5;
const walkers = [];
let items = [];
const pity = { 3: 0, 4: 0, 5: 0, 6: 0 };
const conns = new Set();

function pickOfRarity(r) {
  const pool = [];
  SP.forEach((s, j) => { if (s.r === r) pool.push(j); });
  return pool[Math.floor(Math.random() * pool.length)];
}
function pickSpecies() {
  let tot = 0;
  for (const r of RAR) tot += r.w;
  let x = Math.random() * tot, ri = 0;
  for (let i = 0; i < RAR.length; i++) { x -= RAR[i].w; if (x <= 0) { ri = i; break; } }
  return pickOfRarity(ri);
}
function slotPos(b, i) {
  const pl = PLAN[b.idx], f = Math.floor(i / SPF), li = i % SPF, r = Math.floor(li / 5), c = li % 5;
  return { x: pl.side * (ENT_X + ROWS[r]), z: pl.cz + (c - 2) * 5.5, y: f * FH };
}
const onFloor = (p, y) => Math.abs(p.y - y) < 4;     /* you have to be on the same story as the slot */
function rectOf(b) {
  const pl = PLAN[b.idx], x0 = pl.side * ENT_X, x1 = pl.side * (ENT_X + BASE_D);
  return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: pl.cz - BASE_W / 2, maxZ: pl.cz + BASE_W / 2 };
}
const firstEmpty = b => b.slots.findIndex(s => !s);
const slotList = b => b.slots.map(s => (s ? { sp: s.sp, uid: s.uid } : null));
const baseIncome = b => b.slots.reduce((n, s) => n + (s ? SP[s.sp].i : 0), 0);
const itemZ = (it, now) => -ZLEN + BELT * ((now || Date.now()) - it.born) / 1000;

const joinedList = () => { const a = []; for (const w of conns) if (w.p.joined) a.push(w.p); return a; };
const joinedCount = () => joinedList().length;
function send(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
function bcast(o, except) {
  const s = JSON.stringify(o);
  for (const w of conns) if (w !== except && w.readyState === 1) w.send(s);
}
function deny(p, text) { send(p.ws, { t: 'msg', text, c: '#ffb02e', deny: 1 }); }
const pub = p => ({
  pid: p.pid, name: p.name, base: p.base, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw),
  carry: p.carry ? { sp: p.carry.sp, uid: p.carry.uid } : null, tool: p.tool, fly: p.fly ? 1 : 0
});
const walkPub = w => ({ id: w.id, sp: w.sp, uid: w.uid, owner: w.owner.pid, x: r2(w.x), z: r2(w.z) });
const reserved = p => walkers.reduce((n, w) => n + (w.owner === p ? 1 : 0), 0);
const rectHas = (r, x, z, pad) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
const laserOn = (b, now) => b.laserUntil > (now || Date.now());
/* a base with its laser barrier on is closed to everyone except its owner */
function blockedByLaser(p, x, z, now) {
  for (const b of bases) if (b.owner && b.owner !== p && laserOn(b, now) && rectHas(rectOf(b), x, z, 0.2)) return true;
  return false;
}
function landPlayer(q) {
  if (!q.fly) return;
  q.fly = false;
  bcast({ t: 'fly', pid: q.pid, on: 0 });
}
function zap(q, b) {
  const now = Date.now();
  if (now < q.hitT + 600) return;
  const r = rectOf(b);
  const d = [[q.x - r.minX, -1, 0], [r.maxX - q.x, 1, 0], [q.z - r.minZ, 0, -1], [r.maxZ - q.z, 0, 1]].sort((a, c) => a[0] - c[0])[0];
  q.hitT = now + 1500;
  landPlayer(q);
  bcast({ t: 'hit', pid: q.pid, by: 0, nx: d[1], nz: d[2] });
  send(q.ws, { t: 'msg', text: 'The laser barrier zapped you!', c: '#ff6b8b' });
  if (q.carry) returnCarry(q, null);
}
const freeSlots = (b, p) => b.slots.reduce((n, s) => n + (s ? 0 : 1), 0) - reserved(p);

function setSlot(b, i, sp, uid, why, extra) {
  b.slots[i] = { sp, uid, cash: 0 };
  bcast(Object.assign({ t: 'slot', base: b.idx, slot: i, sp, uid, why }, extra || {}));
}
function clearSlot(b, i, why, extra) {
  b.slots[i] = null;
  bcast(Object.assign({ t: 'slot', base: b.idx, slot: i, sp: -1, why }, extra || {}));
}
/* plots with no real player on them stay empty */
function resetLot(b) { b.slots.fill(null); }
bases.forEach(resetLot);

function sendYou(p) {
  const b = bases[p.base];
  send(p.ws, { t: 'you', cash: Math.floor(p.cash), pads: b.slots.map(s => (s ? r2(s.cash) : 0)) });
}
function sendLb() {
  const list = joinedList().map(p => [p.pid, p.name, Math.floor(p.cash), p.base])
    .sort((a, b) => b[2] - a[2]);
  bcast({ t: 'lb', p: list });
}

function spawnItem(force) {
  if (force == null && items.length > 22) return;
  const sp = force != null ? pickOfRarity(force) : pickSpecies();
  const r = SP[sp].r;
  const it = { id: ++itemN, sp, x: r2(rand(-1.4, 1.4)), born: Date.now() };
  items.push(it);
  if (r >= 3) pity[r] = 0;
  bcast({ t: 'item', id: it.id, sp, x: it.x, age: 0, g: force != null });
}

/* a carried brainrot goes back to the base it came from (if that player is still around) */
function returnCarry(p, notHere) {
  const c = p.carry;
  p.carry = null;
  bcast({ t: 'carryEnd', pid: p.pid });
  const fb = bases[c.from];
  if (!fb || fb === notHere || !fb.owner) return false;
  const i = firstEmpty(fb);
  if (i < 0) return false;
  setSlot(fb, i, c.sp, c.uid, 'return');
  send(fb.owner.ws, { t: 'msg', text: 'Your ' + SP[c.sp].n + ' came back home.', c: '#7dff6a' });
  return true;
}

/* ---------------- joining and leaving ---------------- */
function cleanName(n) {
  return String(n || '').replace(/[^\w .!?'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
}

function onHello(ws, p, m) {
  if (p.joined) return;
  if (joinedCount() >= MAX) { send(ws, { t: 'full' }); return; }
  /* one connection per device, so a second tab can't copy your brainrots */
  const did = /^[\w-]{8,48}$/.test(String(m.did || '')) ? String(m.did) : 'anon' + p.pid;
  if (joinedList().some(q => q.did === did)) { send(ws, { t: 'dupe' }); return; }
  /* one player per name, ignoring case and punctuation */
  const name = cleanName(m.name) || ('Player' + p.pid);
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '') || s.toLowerCase();
  if (joinedList().some(q => norm(q.name) === norm(name))) { send(ws, { t: 'nameTaken', name }); return; }
  const b = bases.find(x => !x.owner);
  p.joined = true;
  p.did = did;
  p.name = name;
  p.base = b.idx;
  b.owner = p;
  b.slots.fill(null);

  let cash = 200, owned = [0];
  const sv = saves.get(did) || m.save;     /* the server's copy wins over whatever the browser claims */
  if (sv && Array.isArray(sv.owned) && typeof sv.cash === 'number' && isFinite(sv.cash)) {
    const o = sv.owned.filter(i => Number.isInteger(i) && i >= 0 && i < SP.length).slice(0, SLOTS);
    const c = clamp(Math.floor(sv.cash), 0, 1e12);
    if (o.length + c > 0) { owned = o; cash = c; }
  }
  p.cash = cash;
  owned.forEach((sp, i) => { b.slots[i] = { sp, uid: ++uidN, cash: 0 }; });

  const pl = PLAN[b.idx];
  p.x = pl.side * (ENT_X + 3); p.z = pl.cz; p.y = 0; p.yaw = -pl.side * Math.PI / 2;

  send(ws, { t: 'joined', pid: p.pid, name: p.name, base: b.idx, cash: p.cash, slots: slotList(b), n: joinedCount() });
  bcast({ t: 'join', player: pub(p), slots: slotList(b), n: joinedCount() }, ws);
  bcast({ t: 'msg', text: p.name + ' joined', c: '#4fe8ff' }, ws);
  sendYou(p);
  sendLb();
  console.log('join', p.name, 'base', b.idx, 'players', joinedCount());
}

function leave(ws, p) {
  if (!conns.delete(ws) || !p.joined) return;
  p.joined = false;
  const b = bases[p.base];
  if (p.carry) returnCarry(p, b);
  /* keep the server's copy of their progress: slots, anything still walking home, and uncollected pad cash */
  const owned = b.slots.filter(Boolean).map(s => s.sp);
  let cash = p.cash + b.slots.reduce((n, s) => n + (s ? Math.floor(s.cash) : 0), 0);
  for (let i = walkers.length - 1; i >= 0; i--) {
    if (walkers[i].owner === p) { owned.push(walkers[i].sp); bcast({ t: 'walkEnd', id: walkers[i].id }); walkers.splice(i, 1); }
  }
  saves.delete(p.did);
  saves.set(p.did, { cash: Math.floor(cash), owned: owned.slice(0, SLOTS) });
  if (saves.size > 3000) saves.delete(saves.keys().next().value);
  b.owner = null;
  b.laserUntil = 0;
  resetLot(b);
  bcast({ t: 'leave', pid: p.pid, base: b.idx, slots: slotList(b), n: joinedCount() });
  bcast({ t: 'msg', text: p.name + ' left', c: '#a4acd0' });
  sendLb();
  console.log('leave', p.name, 'players', joinedCount());
}

function hitPlayer(q, by, nx, nz) {
  q.hitT = Date.now() + RAG_MS;
  landPlayer(q);
  bcast({ t: 'hit', pid: q.pid, by: by.pid, nx: r2(nx), nz: r2(nz) });
  send(q.ws, { t: 'msg', text: by.name + ' knocked you out!', c: '#ff6b8b' });
  if (q.carry) {
    const sp = q.carry.sp;
    const back = returnCarry(q, null);
    send(q.ws, { t: 'msg', text: 'You dropped ' + SP[sp].n + (back ? ' and it ran back home.' : '.'), c: '#ffb02e' });
    send(by.ws, { t: 'msg', text: 'You knocked ' + q.name + ' out and saved ' + SP[sp].n + '!', c: '#7dff6a' });
  }
}

/* ---------------- admin ---------------- */
function onAdminLogin(ws, p, m) {
  const now = Date.now();
  while (adminFailLog.length && now - adminFailLog[0] > 60000) adminFailLog.shift();
  if (p.admin) { send(ws, { t: 'adminOk' }); return; }
  if (now < p.adminLock || adminFailLog.length >= 30) { send(ws, { t: 'adminFail', locked: 1 }); return; }
  const h = crypto.createHash('sha256').update(String(m.pw || '').slice(0, 200)).digest();
  if (crypto.timingSafeEqual(h, ADMIN_HASH)) {
    p.admin = true; p.adminFails = 0;
    console.log('admin login', p.name || ('conn' + p.pid));
    send(ws, { t: 'adminOk' });
  } else {
    adminFailLog.push(now);
    if (++p.adminFails >= 5) { p.adminFails = 0; p.adminLock = now + 60000; }
    send(ws, { t: 'adminFail', locked: now < p.adminLock ? 1 : 0 });
  }
}
function spawnSpecific(sp, k) {
  const it = { id: ++itemN, sp, x: r2(rand(-1.4, 1.4)), born: Date.now() - k * 700 };
  items.push(it);
  bcast({ t: 'item', id: it.id, sp, x: it.x, age: k * 0.7, g: false, admin: 1 });
}
function wipeAllBases() {
  let n = 0;
  for (const b of bases) b.slots.forEach((s, i) => { if (s) { clearSlot(b, i, 'wipe'); n++; } });
  for (const w of walkers.splice(0)) bcast({ t: 'walkEnd', id: w.id });
  for (const q of joinedList()) if (q.carry) { q.carry = null; bcast({ t: 'carryEnd', pid: q.pid }); }
  for (const rec of saves.values()) rec.owned = [];
  for (const q of joinedList()) sendYou(q);
  console.log('admin wiped', n, 'brainrots');
}
function handleAdmin(p, m) {
  switch (m.t) {
    case 'adminMsg': {
      const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (text) bcast({ t: 'adminMsg', text });
      break;
    }
    case 'adminSpawn': {
      const sp = m.sp, n = clamp(Math.floor(Number(m.n)) || 1, 1, 10);
      if (!Number.isInteger(sp) || sp < 0 || sp >= SP.length) break;
      for (let k = 0; k < n; k++) spawnSpecific(sp, k);
      bcast({ t: 'adminSpawned', sp, n });
      break;
    }
    case 'adminWipe':
      wipeAllBases();
      bcast({ t: 'adminMsg', text: "ADMIN WIPED EVERYONE'S BASES", kind: 'wipe' });
      break;
  }
}

/* ---------------- messages ---------------- */
function slotIndex(v) { return Number.isInteger(v) && v >= 0 && v < SLOTS ? v : -1; }

function handle(ws, p, m) {
  if (m.t === 'hello') { onHello(ws, p, m); return; }
  if (m.t === 'adminLogin') { onAdminLogin(ws, p, m); return; }
  if (typeof m.t === 'string' && m.t.startsWith('admin')) { if (p.admin) handleAdmin(p, m); return; }   /* works from the menu too, no need to join */
  if (!p.joined) return;
  const b = bases[p.base];
  const now = Date.now();
  const down = now < p.hitT;
  if (down && m.t !== 'pos' && m.t !== 'eq') return;   /* knocked out: no actions */
  if (p.fly && m.t !== 'pos' && m.t !== 'eq' && m.t !== 'fly' && m.t !== 'laser') return;   /* on the carpet: land first */
  switch (m.t) {
    case 'eq': {
      const tl = m.tool === 1 || m.tool === 2 ? m.tool : 0;
      if (tl && p.fly) break;
      p.tool = tl;
      bcast({ t: 'eq', pid: p.pid, tool: tl }, ws);
      break;
    }

    case 'fly': {
      const on = !!m.on;
      if (on === p.fly) break;
      if (on && p.carry) break;                         /* no flying while carrying a stolen brainrot */
      p.fly = on;
      if (on && p.tool) { p.tool = 0; bcast({ t: 'eq', pid: p.pid, tool: 0 }, ws); }
      bcast({ t: 'fly', pid: p.pid, on: on ? 1 : 0 }, ws);
      break;
    }

    case 'shoot': {
      if (p.tool !== 2 || now < p.shotT) break;
      const dx = Number(m.dx), dy = Number(m.dy), dz = Number(m.dz);
      if (![dx, dy, dz].every(Number.isFinite)) break;
      const l = Math.hypot(dx, dy, dz);
      if (l < 0.01) break;
      p.shotT = now + 140;
      /* the gun is just for show: shots are relayed so everyone sees them, and they hit nothing */
      bcast({ t: 'shot', pid: p.pid, dx: r2(dx / l), dy: r2(dy / l), dz: r2(dz / l) }, ws);
      break;
    }

    case 'laser': {
      if (!rectHas(rectOf(b), p.x, p.z, 0.5)) { deny(p, 'You have to be inside your own base to lock it.'); break; }
      if (now < b.laserUntil) { deny(p, 'Your laser barrier is already on.'); break; }
      if (p.cash < LASER_COST) { deny(p, 'The laser barrier costs $' + LASER_COST + '.'); break; }
      p.cash -= LASER_COST;
      b.laserUntil = now + LASER_TIME;
      bcast({ t: 'laser', base: b.idx, ms: LASER_TIME });
      sendYou(p);
      for (const q of joinedList()) if (q !== p && rectHas(rectOf(b), q.x, q.z, 0)) zap(q, b);
      break;
    }

    case 'collectAll': {
      const pl = PLAN[b.idx], bx = pl.side * (ENT_X + BTN.xo), bz = pl.cz + BTN.zo;
      let near = false;
      if (Math.hypot(p.x - bx, p.z - bz) <= 6) for (let f = 0; f < FLOORS; f++) if (Math.abs(p.y - f * FH) < 4) near = true;
      if (!near) break;
      let tot = 0;
      for (const s of b.slots) if (s) { const w = Math.floor(s.cash); if (w >= 1) { tot += w; s.cash -= w; } }
      p.cash += tot;
      send(p.ws, { t: 'collected', v: tot });
      sendYou(p);
      break;
    }

    case 'swing': {
      if (p.tool !== 1 || now < p.swingT) break;
      p.swingT = now + SWING_CD;
      bcast({ t: 'swing', pid: p.pid }, ws);
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      for (const q of joinedList()) {
        if (q === p || now < q.hitT + 600) continue;      /* short grace so nobody is chain-ragdolled */
        const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz) || 0.001;
        if (d > SWING_RANGE || Math.abs(q.y - p.y) > 5) continue;
        if ((dx * fx + dz * fz) / d < -0.15) continue;     /* must be in front */
        hitPlayer(q, p, dx / d, dz / d);
      }
      break;
    }

    case 'buyw': {
      const w = walkers.find(x => x.id === m.id);
      if (!w || w.owner === p || now < w.lock) break;
      const d = SP[w.sp];
      if (Math.hypot(p.x - w.x, p.z - w.z) > 6.5) break;
      if (p.cash < d.p) { deny(p, 'Not enough cash.'); break; }
      if (freeSlots(b, p) <= 0) { deny(p, 'Your base is full. Hold E on one of your own to sell it.'); break; }
      const old = w.owner;
      p.cash -= d.p;
      old.cash += d.p;                                    /* the old owner gets their money back */
      w.owner = p; w.stage = 0; w.lock = now + 1200;
      bcast({ t: 'walkOwner', id: w.id, owner: p.pid });
      send(old.ws, { t: 'msg', text: p.name + ' bought your ' + d.n + ' off you!', c: '#ff6b8b', alarm: 1 });
      sendYou(p); sendYou(old);
      break;
    }

    case 'stealStart': {
      const tb = bases[m.base], si = slotIndex(m.slot);
      if (!tb || tb === b || si < 0 || !tb.owner || p.carry) break;
      const s = tb.slots[si];
      if (!s || now < p.alertT || laserOn(tb, now)) break;
      const sp = slotPos(tb, si);
      if (Math.hypot(p.x - sp.x, p.z - sp.z) > 10 || !onFloor(p, sp.y)) break;
      p.alertT = now + 1200;
      send(tb.owner.ws, { t: 'alert', pid: p.pid, name: p.name, base: tb.idx, slot: si, sp: s.sp });
      break;
    }

    case 'pos':
      if ([m.x, m.y, m.z, m.yaw].every(Number.isFinite)) {
        const nx = clamp(m.x, -62, 62), nz = clamp(m.z, -108, 108);
        p.yaw = m.yaw;
        if (blockedByLaser(p, nx, nz, now)) break;     /* a laser barrier is in the way */
        p.x = nx; p.z = nz; p.y = clamp(m.y, 0, 60);
      }
      break;

    case 'buy': {
      const it = items.find(i => i.id === m.id);
      if (!it) { deny(p, 'Too late, someone got that one.'); break; }
      const d = SP[it.sp];
      if (Math.hypot(p.x - it.x, p.z - itemZ(it)) > 9) break;
      if (p.cash < d.p) { deny(p, 'Not enough cash.'); break; }
      if (freeSlots(b, p) <= 0) { deny(p, 'Your base is full. Hold E on one of your own to sell it.'); break; }
      p.cash -= d.p;
      items.splice(items.indexOf(it), 1);
      bcast({ t: 'itemGone', id: it.id, by: p.pid });
      const w = { id: ++walkN, sp: it.sp, uid: ++uidN, owner: p, x: it.x, z: itemZ(it), stage: 0, lock: now + 800 };
      walkers.push(w);
      bcast({ t: 'walk', w: walkPub(w), why: 'buy' });
      sendYou(p);
      break;
    }

    case 'sell': {
      const si = slotIndex(m.slot);
      if (si < 0 || !b.slots[si]) break;
      const sp = slotPos(b, si);
      if (Math.hypot(p.x - sp.x, p.z - sp.z) > 7 || !onFloor(p, sp.y)) break;
      const v = Math.floor(SP[b.slots[si].sp].p * 0.5);
      p.cash += v;
      clearSlot(b, si, 'sell', { v, who: p.pid });
      sendYou(p);
      break;
    }

    case 'steal': {
      if (p.carry) break;
      const tb = bases[m.base];
      const si = slotIndex(m.slot);
      if (!tb || tb === b || si < 0) break;
      const s = tb.slots[si];
      if (!s) break;
      if (laserOn(tb, now)) { deny(p, 'That base has its laser barrier on.'); break; }
      const sp = slotPos(tb, si);
      if (Math.hypot(p.x - sp.x, p.z - sp.z) > 8 || !onFloor(p, sp.y)) break;
      clearSlot(tb, si, 'steal', { who: p.pid });
      p.carry = { sp: s.sp, uid: s.uid, from: tb.idx };
      bcast({ t: 'carry', pid: p.pid, sp: s.sp, uid: s.uid });
      if (tb.owner) {
        send(tb.owner.ws, { t: 'msg', text: p.name + ' stole your ' + SP[s.sp].n + '!', c: '#ff6b8b', alarm: 1 });
        sendYou(tb.owner);
      }
      break;
    }

    case 'deposit': {
      if (!p.carry) break;
      const r = rectOf(b);
      if (p.x < r.minX - 3 || p.x > r.maxX + 3 || p.z < r.minZ - 3 || p.z > r.maxZ + 3) break;
      const si = freeSlots(b, p) > 0 ? firstEmpty(b) : -1;
      if (si < 0) {
        if (Date.now() > p.fullT) { p.fullT = Date.now() + 3000; deny(p, 'Base full. Hold E on one of yours to sell it, then step in again.'); }
        break;
      }
      const c = p.carry;
      p.carry = null;
      bcast({ t: 'carryEnd', pid: p.pid });
      setSlot(b, si, c.sp, c.uid, 'dep', { who: p.pid });
      break;
    }

    case 'collect': {
      const si = slotIndex(m.slot);
      if (si < 0 || !b.slots[si]) break;
      const sp = slotPos(b, si);
      if (Math.hypot(p.x - sp.x, p.z - sp.z) > 6 || !onFloor(p, sp.y)) break;
      const s = b.slots[si], whole = Math.floor(s.cash);
      if (whole >= 1) { p.cash += whole; s.cash -= whole; sendYou(p); }
      break;
    }
  }
}

/* ---------------- sockets ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
wss.on('connection', ws => {
  const p = { pid: ++pidN, ws, joined: false, name: '', base: -1, cash: 0, x: 0, y: 0, z: 0, yaw: 0, carry: null, fullT: 0, rate: 0, tool: 0, fly: false, did: '', admin: false, adminFails: 0, adminLock: 0, hitT: 0, swingT: 0, shotT: 0, alertT: 0 };
  ws.p = p;
  ws.isAlive = true;
  conns.add(ws);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    if (++p.rate > 120) return;
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    try { handle(ws, p, m); } catch (e) { console.error(e); }
  });
  ws.on('close', () => leave(ws, p));
  ws.on('error', () => {});
  const now = Date.now();
  send(ws, {
    t: 'init', pid: p.pid, max: MAX, n: joinedCount(), pity,
    items: items.map(it => ({ id: it.id, sp: it.sp, x: it.x, age: (now - it.born) / 1000 })),
    bases: bases.map(b => ({ owner: b.owner ? { pid: b.owner.pid, name: b.owner.name } : null, slots: slotList(b), laser: b.laserUntil > now ? b.laserUntil - now : 0 })),
    players: joinedList().map(pub),
    walkers: walkers.map(walkPub)
  });
});

/* ---------------- loops ---------------- */
let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (conns.size) {
    spawnT -= dt;
    if (spawnT <= 0) { spawnT = rand(4, 5.5); spawnItem(null); }
    if (joinedCount()) {
      for (const r of [3, 4, 5, 6]) { pity[r] += dt; if (pity[r] >= PITY[r]) spawnItem(r); }
    }
  }
  for (let i = items.length - 1; i >= 0; i--) {
    if (itemZ(items[i], now) > ZLEN + 1) { bcast({ t: 'itemGone', id: items[i].id, by: 0 }); items.splice(i, 1); }
  }
  for (const b of bases) {
    if (b.owner) for (const s of b.slots) if (s) s.cash += SP[s.sp].i * dt;
    if (b.laserUntil && now > b.laserUntil) {
      b.laserUntil = 0; bcast({ t: 'laser', base: b.idx, ms: 0 });
      if (b.owner) send(b.owner.ws, { t: 'msg', text: 'Your laser barrier switched off. Go into your base and press L to lock it again.', c: '#ffb02e' });
    }
  }
  /* bought brainrots walk home on their own, so anyone nearby can try to buy them off the owner */
  for (let i = walkers.length - 1; i >= 0; i--) {
    const w = walkers[i], pl = PLAN[w.owner.base], b = bases[w.owner.base];
    const tx = pl.side * (w.stage ? ENT_X + 2.5 : ENT_X - 3), tz = pl.cz;
    const dx = tx - w.x, dz = tz - w.z, d = Math.hypot(dx, dz);
    if (d <= 0.6) {
      if (!w.stage) { w.stage = 1; continue; }
      const si = firstEmpty(b);
      if (si >= 0) {
        walkers.splice(i, 1);
        setSlot(b, si, w.sp, w.uid, 'dep', { who: w.owner.pid });
        bcast({ t: 'walkEnd', id: w.id });
      }
      continue;
    }
    const st = Math.min(d, WALK_SPD * dt);
    w.x += dx / d * st; w.z += dz / d * st;
  }
  for (const p of joinedList()) {
    const b = bases[p.base];
    if (p.cash < 25 && !p.carry && b.slots.every(s => !s)) {
      p.cash = 50;
      send(p.ws, { t: 'msg', text: 'Here is a little starter cash.', c: '#7dff6a' });
      sendYou(p);
    }
  }
}, 50);

setInterval(() => {
  const list = joinedList();
  if (list.length >= 2) bcast({ t: 'snap', p: list.map(p => [p.pid, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw)]) });
  if (walkers.length) bcast({ t: 'wsnap', w: walkers.map(w => [w.id, r2(w.x), r2(w.z)]) });
}, 66);

setInterval(() => { for (const p of joinedList()) sendYou(p); }, 200);
setInterval(() => { bcast({ t: 'pity', p: pity }); sendLb(); }, 2000);
setInterval(() => { for (const w of conns) w.p.rate = 0; }, 1000);
setInterval(() => {
  for (const w of conns) {
    if (!w.isAlive) { w.terminate(); continue; }
    w.isAlive = false;
    try { w.ping(); } catch (e) {}
  }
}, 25000);

server.listen(PORT, () => console.log('Brainrot Heist listening on ' + PORT));
