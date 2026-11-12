#!/usr/bin/env node
'use strict';

/*
 * Planning Poker - self-hosted server.
 * Node's http module, server-sent events for the table state, JSON POSTs for
 * actions, and one WebSocket per 3D viewer for head movement (the only
 * dependency, `ws`). One process holds every table in memory; story lists are
 * also written to DATA_DIR/rooms.json so they survive a restart.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '').replace(/^(?!\/)(?=.)/, '/');
const DATA_DIR = process.env.DATA_DIR === undefined ? path.join(__dirname, 'data') : process.env.DATA_DIR; // '' turns saving off
const GRACE_MS = Number(process.env.GRACE_MS) || 15000;      // how long a seat is kept after its last tab closes
const STALE_MS = 90000;                                      // no ping for this long: the browser is gone
const PUBLIC_DIR = path.join(__dirname, 'public');

const DECKS = {
  bt:    { label: 'BT DECK',            cards: ['1', '2', '3', '4', '6', '8', '10', '12', '14', '16', '18', '20', '24', '30', '36', '40'] },
  fib:   { label: 'Fibonacci',          cards: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', 'coffee'] },
  mod:   { label: 'Modified Fibonacci', cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', 'coffee'] },
  shirt: { label: 'T-shirt sizes',      cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', 'coffee'] },
  pow2:  { label: 'Powers of 2',        cards: ['0', '1', '2', '4', '8', '16', '32', '64', '?', 'coffee'] },
};
const CAST_SIZE = 12;                                        // characters in the 3D cast (public/table3d.js)
const EMOTES = ['❤️', '👍', '👏', '😂', '🎉', '🤔', '😮', '🔥'];
const MAX = { rooms: 2000, players: 60, stories: 300, name: 24, title: 160, body: 32 * 1024, addAtOnce: 60, customCards: 20, cardLength: 4 };
const ROOM_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const clean = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const isEstimate = (room, v) => typeof v === 'string' && v !== '?' && v !== 'coffee' &&
  (room.custom.includes(v) || Object.values(DECKS).some(d => d.cards.includes(v)));
const cardsOf = room => (room.deck === 'custom' ? room.custom : DECKS[room.deck].cards);

/** Turns what someone typed into a custom deck: short unique labels, or null when there are fewer than two. */
function cleanCards(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const raw of list) {
    let v = clean(raw, 12);
    if (v === '☕' || /^(coffee|break)$/i.test(v)) v = 'coffee';
    else v = v.slice(0, MAX.cardLength);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX.customCards) break;
  }
  return out.length >= 2 ? out : null;
}
const playerId = token => crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
const newId = () => crypto.randomBytes(6).toString('hex');

/* ---------- tables ---------- */
const rooms = new Map();

function makeRoom(id) {
  return {
    id, deck: 'fib', custom: [], revealed: false, round: 1, title: '', storyId: null, stories: [],
    hostId: null, hostOnly: true,                  // the host is the first person to sit down; by default only they run the round
    players: new Map(), touched: Date.now(), queued: false,
  };
}
function getRoom(id, create) {
  let room = rooms.get(id);
  if (!room && create && rooms.size < MAX.rooms) { room = makeRoom(id); rooms.set(id, room); }
  return room || null;
}

function publicState(room) {
  return {
    id: room.id, deck: room.deck, cards: cardsOf(room), custom: room.custom,
    revealed: room.revealed, round: room.round,
    title: room.title, storyId: room.storyId, stories: room.stories,
    hostId: room.hostId, hostOnly: room.hostOnly,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, spectator: p.spectator, online: p.conns.size > 0, smoking: p.smoking, avatar: p.avatar,
      voted: p.vote !== null,
      vote: room.revealed ? p.vote : null,          // a vote never leaves the server before the reveal
    })),
  };
}
function broadcast(room) {
  const pub = JSON.stringify(publicState(room));
  for (const p of room.players.values()) {
    if (!p.conns.size) continue;
    const msg = 'event: state\ndata: {"state":' + pub + ',"you":' + JSON.stringify({ id: p.id, vote: p.vote }) + '}\n\n';
    for (const res of p.conns) res.write(msg);
  }
}
/** Sends a passing moment (a reaction) to everyone at the table. Nothing is stored. */
function emit(room, event, data) {
  const msg = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const p of room.players.values()) for (const res of p.conns) res.write(msg);
}
function queueBroadcast(room) {
  if (room.queued) return;
  room.queued = true;
  setImmediate(() => { room.queued = false; broadcast(room); });
}

/** A random character nobody at the table is using yet (any one once all are taken). */
function pickAvatar(room) {
  const used = new Set([...room.players.values()].map(p => p.avatar));
  const free = [];
  for (let i = 0; i < CAST_SIZE; i += 1) if (!used.has(i)) free.push(i);
  return free.length ? free[crypto.randomInt(free.length)] : crypto.randomInt(CAST_SIZE);
}

function newRound(room) {
  room.round += 1;
  room.revealed = false;
  for (const p of room.players.values()) p.vote = null;
}
function nextPending(room) {
  const i = room.stories.findIndex(s => s.id === room.storyId);
  const order = i >= 0 ? [...room.stories.slice(i + 1), ...room.stories.slice(0, i)] : room.stories;
  return order.find(s => s.estimate === null) || null;
}

// Running the round: these are the host's alone while the table is set to host-only.
const HOST_ACTIONS = new Set(['reveal', 'again', 'new', 'next', 'deck', 'story.select']);

/** Applies one action. Returns true when the table changed. */
function apply(room, p, a) {
  const sameRound = a.round === room.round;       // guards against two people pressing the same button at once
  const isHost = p.id === room.hostId;
  if (room.hostOnly && !isHost && HOST_ACTIONS.has(a.type)) return false;
  switch (a.type) {
    case 'host.claim':                             // only when the host's seat is empty
      if (room.hostId && room.players.has(room.hostId)) return false;
      room.hostId = p.id;
      return true;
    case 'host.pass':
      if (!isHost || a.to === p.id || !room.players.has(a.to)) return false;
      room.hostId = a.to;
      return true;
    case 'host.only':
      if (!isHost || typeof a.on !== 'boolean' || a.on === room.hostOnly) return false;
      room.hostOnly = a.on;
      return true;
    case 'ping':
      return false;
    case 'profile': {
      const name = clean(a.name, MAX.name);
      if (name) p.name = name;
      if (typeof a.spectator === 'boolean') { p.spectator = a.spectator; if (p.spectator) p.vote = null; }
      return true;
    }
    case 'vote':
      if (!sameRound || room.revealed || p.spectator) return false;
      if (a.value === null) p.vote = null;
      else if (cardsOf(room).includes(a.value)) p.vote = a.value;
      else return false;
      return true;
    case 'reveal':
      if (!sameRound || room.revealed) return false;
      if (![...room.players.values()].some(x => x.vote !== null)) return false;
      room.revealed = true;
      return true;
    case 'again':
      if (!sameRound) return false;
      newRound(room);
      return true;
    case 'new':
      if (!sameRound) return false;
      newRound(room); room.storyId = null; room.title = '';
      return true;
    case 'next': {
      if (!sameRound) return false;
      const n = nextPending(room);
      newRound(room);
      room.storyId = n ? n.id : null;
      room.title = n ? n.title : '';
      return true;
    }
    case 'deck':
      if (a.deck === 'custom') {
        const cards = cleanCards(a.cards);
        if (!cards) return false;
        if (room.deck === 'custom' && cards.join('\n') === room.custom.join('\n')) return false;
        room.custom = cards;
        room.deck = 'custom';
        newRound(room);
        return true;
      }
      if (!DECKS[a.deck] || a.deck === room.deck) return false;
      room.deck = a.deck;
      newRound(room);
      return true;
    case 'smoke':
      if (p.smoking === (a.on === true)) return false;
      p.smoking = a.on === true;
      return true;
    case 'emote': {
      const now = Date.now();
      if (!EMOTES.includes(a.emote) || a.to === p.id || !room.players.has(a.to) || now - p.emoted < 200) return false;
      p.emoted = now;
      emit(room, 'emote', { from: p.id, to: a.to, emote: a.emote });
      return false;
    }
    case 'topic':
      if (room.storyId) return false;
      room.title = clean(a.title, MAX.title);
      return true;
    case 'story.add': {
      if (!Array.isArray(a.titles)) return false;
      let added = 0;
      for (const t of a.titles.slice(0, MAX.addAtOnce)) {
        const title = clean(t, MAX.title);
        if (!title || room.stories.length >= MAX.stories) continue;
        room.stories.push({ id: newId(), title, estimate: null });
        added += 1;
      }
      return added > 0;
    }
    case 'story.select': {
      const s = room.stories.find(x => x.id === a.id);
      if (!s || !sameRound) return false;
      newRound(room); room.storyId = s.id; room.title = s.title;
      return true;
    }
    case 'story.estimate': {
      const s = room.stories.find(x => x.id === a.id);
      if (!s || !(a.estimate === null || isEstimate(room, a.estimate))) return false;
      s.estimate = a.estimate;
      return true;
    }
    case 'story.remove': {
      const i = room.stories.findIndex(x => x.id === a.id);
      if (i < 0) return false;
      room.stories.splice(i, 1);
      if (room.storyId === a.id) room.storyId = null;
      return true;
    }
    default:
      return false;
  }
}

/* ---------- saving story lists ---------- */
const SAVED_ACTIONS = new Set(['deck', 'topic', 'new', 'next', 'story.add', 'story.select', 'story.estimate', 'story.remove', 'host.claim', 'host.pass', 'host.only']);
const DATA_FILE = DATA_DIR ? path.join(DATA_DIR, 'rooms.json') : null;
let saveTimer = null, saveWarned = false;

function snapshot() {
  const out = [];
  for (const r of rooms.values()) {
    if (!r.stories.length && r.deck === 'fib' && !r.custom.length && r.hostOnly) continue;       // nothing worth keeping
    out.push({ id: r.id, deck: r.deck, custom: r.custom, title: r.title, storyId: r.storyId, stories: r.stories, hostId: r.hostId, hostOnly: r.hostOnly, touched: r.touched });
  }
  return JSON.stringify(out);
}
function saveNow() {
  if (!DATA_FILE) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE + '.tmp', snapshot());
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  } catch (e) {
    if (!saveWarned) { saveWarned = true; console.warn('Could not save tables to ' + DATA_FILE + ' (' + e.message + '). Story lists will be lost on restart.'); }
  }
}
function saveSoon() {
  if (!DATA_FILE || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 1500);
}
function load() {
  if (!DATA_FILE) return;
  let list;
  try { list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return; }
  if (!Array.isArray(list)) return;
  for (const r of list.slice(0, MAX.rooms)) {
    if (!r || !ROOM_RE.test(r.id)) continue;
    const room = makeRoom(r.id);
    room.custom = cleanCards(r.custom) || [];
    if (DECKS[r.deck] || (r.deck === 'custom' && room.custom.length)) room.deck = r.deck;
    room.stories = (Array.isArray(r.stories) ? r.stories : []).slice(0, MAX.stories)
      .map(s => ({ id: clean(s && s.id, 24), title: clean(s && s.title, MAX.title), estimate: s && isEstimate(room, s.estimate) ? s.estimate : null }))
      .filter(s => s.id && s.title);
    room.storyId = room.stories.some(s => s.id === r.storyId) ? r.storyId : null;
    room.title = clean(r.title, MAX.title);
    room.hostId = typeof r.hostId === 'string' && /^[0-9a-f]{16}$/.test(r.hostId) ? r.hostId : null;
    room.hostOnly = r.hostOnly !== false;
    room.touched = Number(r.touched) || Date.now();
    rooms.set(room.id, room);
  }
}

/* ---------- http ---------- */
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function reply(res, status, body, headers) {
  res.writeHead(status, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function serveStatic(req, res, p) {
  if (p === '/') p = '/index.html';
  if (!/^(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/.test(p)) return reply(res, 404, 'Not found');
  const file = path.join(PUBLIC_DIR, p);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return reply(res, 404, 'Not found');
  fs.readFile(file, (err, buf) => {
    if (err) return reply(res, 404, 'Not found');
    const ext = path.extname(file);
    res.writeHead(200, {
      ...SECURITY,
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.woff2' || p.startsWith('/vendor/') ? 'public, max-age=2592000' : 'no-cache',
      'Content-Length': buf.length,
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

function leave(room, p) {
  clearTimeout(p.goneTimer);
  p.goneTimer = setTimeout(() => {
    if (p.conns.size || room.players.get(p.id) !== p) return;
    room.players.delete(p.id);
    for (const ws of p.sockets) ws.close();
    queueBroadcast(room);
  }, GRACE_MS);
  queueBroadcast(room);
}

function handleEvents(req, res, roomId, query) {
  const token = query.get('token') || '';
  if (!TOKEN_RE.test(token)) return reply(res, 400, 'Bad token');
  const room = getRoom(roomId, true);
  if (!room) return reply(res, 503, 'Too many tables');
  const id = playerId(token);
  let p = room.players.get(id);
  if (!p) {
    if (room.players.size >= MAX.players) return reply(res, 429, 'Table is full');
    p = {
      id, name: clean(query.get('name'), MAX.name) || 'Guest', spectator: query.get('spec') === '1',
      vote: null, smoking: false, emoted: 0, avatar: pickAvatar(room),
      look: [0, 0, 0], lookDirty: false, sockets: new Set(),   // head yaw, head pitch, cards raised (3D view)
      conns: new Set(), seen: Date.now(), goneTimer: null,
    };
    room.players.set(id, p);
    if (!room.hostId) room.hostId = id;            // first to sit down hosts the table
  }
  if (p.conns.size >= 8) return reply(res, 429, 'Too many tabs');
  clearTimeout(p.goneTimer);
  p.seen = Date.now();
  room.touched = Date.now();

  res.writeHead(200, {
    ...SECURITY,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',                     // tells nginx not to buffer the stream
  });
  if (res.socket) res.socket.setNoDelay(true);
  res.write('retry: 2000\n\nevent: hello\ndata: ' + JSON.stringify({ decks: DECKS, emotes: EMOTES, you: id }) + '\n\n');
  p.conns.add(res);
  res.on('close', () => {                          // the browser tab closed or the network dropped
    p.conns.delete(res);
    if (!p.conns.size) leave(room, p);
  });
  queueBroadcast(room);
}

function handleAction(req, res, roomId) {
  let size = 0;
  const chunks = [];
  let done = false;
  req.on('data', c => {
    if (done) return;
    size += c.length;
    if (size > MAX.body) { done = true; reply(res, 413, 'Too large'); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('error', () => {});
  req.on('end', () => {
    if (done) return;
    let a;
    try { a = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return reply(res, 400, 'Bad JSON'); }
    if (!a || typeof a !== 'object' || !TOKEN_RE.test(a.token || '')) return reply(res, 400, 'Bad request');
    const room = getRoom(roomId, false);
    const p = room && room.players.get(playerId(a.token));
    if (!p) return reply(res, 409, 'Not at this table');   // the live connection re-seats the player
    p.seen = Date.now();
    room.touched = Date.now();
    let changed = false;
    try { changed = apply(room, p, a); } catch (e) { return reply(res, 400, 'Bad request'); }
    if (changed) { queueBroadcast(room); if (SAVED_ACTIONS.has(a.type)) saveSoon(); }
    res.writeHead(204, SECURITY);
    res.end();
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return reply(res, 400, 'Bad request'); }
  let p = url.pathname;
  if (BASE_PATH) {
    if (p === BASE_PATH) return reply(res, 308, '', { Location: BASE_PATH + '/' + url.search });
    if (p.startsWith(BASE_PATH + '/')) p = p.slice(BASE_PATH.length);
  }
  if (p === '/healthz') return reply(res, 200, 'ok');
  const m = /^\/api\/rooms\/([^/]+)\/(events|action)$/.exec(p);
  if (m) {
    if (!ROOM_RE.test(m[1])) return reply(res, 404, 'No such table');
    if (m[2] === 'events' && req.method === 'GET') return handleEvents(req, res, m[1], url.searchParams);
    if (m[2] === 'action' && req.method === 'POST') return handleAction(req, res, m[1]);
    return reply(res, 405, 'Method not allowed');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
  reply(res, 405, 'Method not allowed');
});

/* ---------- head movement (3D view) ---------- */
// Each 3D viewer keeps one WebSocket open and reports where they are looking.
// Looks are relayed to the table ten times a second, only when they changed.
const wss = new WebSocketServer({ noServer: true, maxPayload: 512 });
const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

server.on('upgrade', (req, socket, head) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { socket.destroy(); return; }
  let p = url.pathname;
  if (BASE_PATH && p.startsWith(BASE_PATH + '/')) p = p.slice(BASE_PATH.length);
  const m = /^\/api\/rooms\/([^/]+)\/ws$/.exec(p);
  const token = url.searchParams.get('token') || '';
  const room = m && ROOM_RE.test(m[1]) ? getRoom(m[1], false) : null;
  const player = room && TOKEN_RE.test(token) ? room.players.get(playerId(token)) : null;
  if (!player || player.sockets.size >= 8) {     // not seated (yet): the page retries after its table stream is up
    socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    player.sockets.add(ws);
    let budget = 30, windowStart = Date.now();
    const known = {};
    for (const other of room.players.values()) if (other !== player) known[other.id] = other.look;
    ws.send(JSON.stringify({ t: 'looks', l: known }));
    ws.on('message', data => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; budget = 30; }
      if ((budget -= 1) < 0) return;
      let msg;
      try { msg = JSON.parse(data.toString('utf8')); } catch (e) { return; }
      if (!msg || msg.t !== 'look') return;
      player.look = [clamp(Number(msg.y), -1.6, 1.6), clamp(Number(msg.p), -0.9, 0.9), msg.h ? 1 : 0];
      player.lookDirty = true;
      room.looksDirty = true;
      player.seen = now;
    });
    ws.on('close', () => { player.sockets.delete(ws); });
    ws.on('error', () => {});
  });
});

const looksTick = setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.looksDirty) continue;
    room.looksDirty = false;
    const changed = {};
    for (const p of room.players.values()) if (p.lookDirty) { p.lookDirty = false; changed[p.id] = p.look; }
    const msg = JSON.stringify({ t: 'looks', l: changed });
    for (const p of room.players.values()) for (const ws of p.sockets) if (ws.readyState === 1) ws.send(msg);
  }
}, 100);
looksTick.unref();

/* ---------- housekeeping ---------- */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      if (p.conns.size && now - p.seen > STALE_MS) {
        for (const res of [...p.conns]) res.destroy();      // fires 'close', which starts the seat's grace period
      } else {
        for (const res of p.conns) res.write(': keep-alive\n\n');
        for (const ws of p.sockets) if (ws.readyState === 1) ws.ping();
      }
    }
    if (!room.players.size) {
      const idle = now - room.touched;
      const limit = room.stories.length ? 30 * 24 * 3600 * 1000 : 3600 * 1000;
      if (idle > limit) { rooms.delete(room.id); saveSoon(); }
    }
  }
}, 20000);
sweep.unref();

function shutdown() {
  clearTimeout(saveTimer);
  saveNow();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

load();
server.listen(PORT, HOST, () => {
  console.log('Planning poker is running on http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + BASE_PATH + '/');
  console.log(DATA_FILE ? 'Story lists are saved to ' + DATA_FILE : 'Saving is off: story lists live in memory only.');
});
