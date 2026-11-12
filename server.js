#!/usr/bin/env node
'use strict';

/*
 * Planning Poker - self-hosted server.
 * No dependencies: Node's http module, server-sent events for live updates,
 * JSON POSTs for actions. One process holds every table in memory; story
 * lists are also written to DATA_DIR/rooms.json so they survive a restart.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '').replace(/^(?!\/)(?=.)/, '/');
const DATA_DIR = process.env.DATA_DIR === undefined ? path.join(__dirname, 'data') : process.env.DATA_DIR; // '' turns saving off
const GRACE_MS = Number(process.env.GRACE_MS) || 15000;      // how long a seat is kept after its last tab closes
const STALE_MS = 90000;                                      // no ping for this long: the browser is gone
const PUBLIC_DIR = path.join(__dirname, 'public');

const DECKS = {
  fib:   { label: 'Fibonacci',          cards: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', 'coffee'] },
  mod:   { label: 'Modified Fibonacci', cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', 'coffee'] },
  shirt: { label: 'T-shirt sizes',      cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', 'coffee'] },
  pow2:  { label: 'Powers of 2',        cards: ['0', '1', '2', '4', '8', '16', '32', '64', '?', 'coffee'] },
};
const MAX = { rooms: 2000, players: 60, stories: 300, name: 24, title: 160, body: 32 * 1024, addAtOnce: 60 };
const ROOM_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const clean = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const isEstimate = v => typeof v === 'string' && v !== '?' && v !== 'coffee' && Object.values(DECKS).some(d => d.cards.includes(v));
const playerId = token => crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
const newId = () => crypto.randomBytes(6).toString('hex');

/* ---------- tables ---------- */
const rooms = new Map();

function makeRoom(id) {
  return { id, deck: 'fib', revealed: false, round: 1, title: '', storyId: null, stories: [], players: new Map(), touched: Date.now(), queued: false };
}
function getRoom(id, create) {
  let room = rooms.get(id);
  if (!room && create && rooms.size < MAX.rooms) { room = makeRoom(id); rooms.set(id, room); }
  return room || null;
}

function publicState(room) {
  return {
    id: room.id, deck: room.deck, revealed: room.revealed, round: room.round,
    title: room.title, storyId: room.storyId, stories: room.stories,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, spectator: p.spectator, online: p.conns.size > 0,
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
function queueBroadcast(room) {
  if (room.queued) return;
  room.queued = true;
  setImmediate(() => { room.queued = false; broadcast(room); });
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

/** Applies one action. Returns true when the table changed. */
function apply(room, p, a) {
  const sameRound = a.round === room.round;       // guards against two people pressing the same button at once
  switch (a.type) {
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
      else if (DECKS[room.deck].cards.includes(a.value)) p.vote = a.value;
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
      if (!DECKS[a.deck] || a.deck === room.deck) return false;
      room.deck = a.deck;
      newRound(room);
      return true;
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
      if (!s || !(a.estimate === null || isEstimate(a.estimate))) return false;
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
const SAVED_ACTIONS = new Set(['deck', 'topic', 'new', 'next', 'story.add', 'story.select', 'story.estimate', 'story.remove']);
const DATA_FILE = DATA_DIR ? path.join(DATA_DIR, 'rooms.json') : null;
let saveTimer = null, saveWarned = false;

function snapshot() {
  const out = [];
  for (const r of rooms.values()) {
    if (!r.stories.length && r.deck === 'fib') continue;       // nothing worth keeping
    out.push({ id: r.id, deck: r.deck, title: r.title, storyId: r.storyId, stories: r.stories, touched: r.touched });
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
    if (DECKS[r.deck]) room.deck = r.deck;
    room.stories = (Array.isArray(r.stories) ? r.stories : []).slice(0, MAX.stories)
      .map(s => ({ id: clean(s && s.id, 24), title: clean(s && s.title, MAX.title), estimate: s && isEstimate(s.estimate) ? s.estimate : null }))
      .filter(s => s.id && s.title);
    room.storyId = room.stories.some(s => s.id === r.storyId) ? r.storyId : null;
    room.title = clean(r.title, MAX.title);
    room.touched = Number(r.touched) || Date.now();
    rooms.set(room.id, room);
  }
}

/* ---------- http ---------- */
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
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
      'Cache-Control': ext === '.woff2' ? 'public, max-age=2592000' : 'no-cache',
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
    p = { id, name: clean(query.get('name'), MAX.name) || 'Guest', spectator: query.get('spec') === '1', vote: null, conns: new Set(), seen: Date.now(), goneTimer: null };
    room.players.set(id, p);
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
  res.write('retry: 2000\n\nevent: hello\ndata: ' + JSON.stringify({ decks: DECKS, you: id }) + '\n\n');
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

/* ---------- housekeeping ---------- */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      if (p.conns.size && now - p.seen > STALE_MS) {
        for (const res of [...p.conns]) res.destroy();      // fires 'close', which starts the seat's grace period
      } else {
        for (const res of p.conns) res.write(': keep-alive\n\n');
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
