(() => {
'use strict';

const CUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3v3M12 3v3"/></svg>';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clean = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const CIG = '<svg class="cig" viewBox="0 0 48 44" aria-hidden="true"><circle class="puff p1" cx="41" cy="25" r="4"/><circle class="puff p2" cx="41" cy="25" r="5"/><circle class="puff p3" cx="41" cy="25" r="3.5"/><g transform="rotate(-18 24 34)"><rect x="3" y="30" width="12" height="7" rx="1.5" fill="#D8913E"/><rect x="14.5" y="30" width="1.5" height="7" fill="#C9A227"/><rect class="cig-paper" x="16" y="30" width="22" height="7" fill="#F6F3EA"/><rect class="ember" x="38" y="30" width="2.5" height="7" fill="#E2482D"/><rect class="cig-ash" x="40.5" y="30.5" width="3.5" height="6" rx="1.6" fill="#9A9A96"/><path class="flame" d="M43 31c-4-5 0-8-1-13 6 4 8 9 4 13z" fill="#FFB02E"/></g></svg>';
const clock = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const num = v => v === '½' ? 0.5 : (/^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
const isReal = v => v !== '?' && v !== 'coffee';
const fmt = n => { const r = Math.round(n * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
const spoken = v => v === 'coffee' ? 'a break' : v === '?' ? 'not sure' : v;
function setFace(node, v) {
  if (node.dataset.v === v) return;
  node.dataset.v = v;
  node.dataset.long = v !== 'coffee' && v.length >= 4 ? '1' : '0';
  if (v === 'coffee') node.innerHTML = CUP; else node.textContent = v;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
function randomId(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}
function slug(s) {
  return String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '');
}

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3800);
}
function copyText(text, okMessage) {
  const fallback = () => {
    const out = $('copy-out');
    out.hidden = false; out.value = text; out.focus(); out.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    if (ok) { out.hidden = true; toast(okMessage); }
    else toast('Copying is blocked here. Select the text in the box and copy it.');
  };
  try { navigator.clipboard.writeText(text).then(() => toast(okMessage), fallback); }
  catch (e) { fallback(); }
}

/* ---------- which page is this ---------- */
const rawRoom = new URLSearchParams(location.search).get('room');
const roomId = rawRoom ? slug(rawRoom) : '';

if (roomId.length < 2) {
  $('landing').hidden = false;
  $('open-form').addEventListener('submit', e => {
    e.preventDefault();
    let id = slug($('open-name').value);
    if (id.length < 2) id = randomId(8);
    location.search = '?room=' + id;
  });
  return;
}
if (rawRoom !== roomId) history.replaceState(null, '', '?room=' + roomId);
document.title = 'Planning Poker - ' + roomId;
$('room').hidden = false;

/* ---------- state ---------- */
let token = store.get('pp.token') || '';
if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) { token = randomId(32); store.set('pp.token', token); }
let name = clean(store.get('pp.name') || '', 24);
let spec = store.get('pp.spec') === '1';

let decks = null, state = null, you = null;
let net = 'connecting', everLive = false;
let es = null, retry = 0, retryTimer = 0;
const local = { vote: undefined, round: 0 };     // my pick, shown before the server confirms it

const api = part => 'api/rooms/' + roomId + '/' + part;
const cards = () => (state && Array.isArray(state.cards) ? state.cards : []);
let editingDeck = false;
let emoteTarget = null, emoteTimer = 0;
// the host is the first person at the table; while the table is host-only, they alone reveal and start rounds
const isHost = () => !!(state && you && state.hostId === you.id);
const hostPlayer = () => (state ? state.players.find(p => p.id === state.hostId) || null : null);
const canRun = () => !!state && (!state.hostOnly || isHost());
// the 3D table (public/table3d.js) is loaded only when someone switches it on
let view3d = (store.get('pp.view') || (matchMedia('(min-width: 720px)').matches ? '3d' : '2d')) === '3d';
let scene3d = null, loading3d = false, ws = null, wsTimer = 0;
// smoke breaks: the server says how long each one has left; this turns that into a local end time
let smokeMs = 180000;
const smokeEnds = new Map();
const myVote = () => (local.vote !== undefined && state && local.round === state.round ? local.vote : (you ? you.vote : null));

function send(action, quiet) {
  return fetch(api('action'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...action }),
  }).then(r => {
    if (r.ok) return true;
    if (!quiet) toast(r.status === 409 ? 'Reconnecting to the table. Try again in a moment.' : 'That did not go through. Try again.');
    return false;
  }, () => {
    if (!quiet) toast('That did not go through. Check your connection and try again.');
    return false;
  });
}

function connect() {
  clearTimeout(retryTimer);
  if (es) es.close();
  const q = new URLSearchParams({ token, name, spec: spec ? '1' : '0' });
  const sentName = name, sentSpec = spec;
  es = new EventSource(api('events') + '?' + q);
  es.addEventListener('hello', e => {
    let hello;
    try { hello = JSON.parse(e.data); } catch (err) { return; }
    decks = hello.decks;
    smokeMs = Number(hello.smokeMs) || 180000;
    const sel = $('deck');
    sel.replaceChildren();
    for (const [id, d] of Object.entries(decks)) { const o = el('option', null, d.label); o.value = id; sel.append(o); }
    const custom = el('option', null, 'Custom deck'); custom.value = 'custom'; sel.append(custom);
    const pop = $('emotes');
    pop.replaceChildren();
    for (const m of hello.emotes || []) { const b = el('button', null, m); b.type = 'button'; b.dataset.emote = m; pop.append(b); }
    const pass = el('button', 'emotes-host', 'Make host'); pass.type = 'button'; pass.dataset.host = '1'; pass.hidden = true; pop.append(pass);
    // the stream may have reconnected with an old name: bring the server up to date
    if (name !== sentName || spec !== sentSpec) send({ type: 'profile', name, spectator: spec }, true);
  });
  es.addEventListener('state', e => {
    let d;
    try { d = JSON.parse(e.data); } catch (err) { return; }
    state = d.state; you = d.you;
    net = 'live'; everLive = true; retry = 0;
    if (local.vote !== undefined && (local.round !== state.round || you.vote === local.vote)) local.vote = undefined;
    const now = Date.now();
    for (const p of state.players) {
      if (!p.smoking) { smokeEnds.delete(p.id); continue; }
      const end = now + (Number(p.smokeLeft) || 0), known = smokeEnds.get(p.id);
      if (!known || Math.abs(known - end) > 1500) smokeEnds.set(p.id, end);     // ignore network jitter
    }
    render();
    if (view3d && scene3d && !ws) connectWs();
  });
  es.addEventListener('emote', e => {
    try { fly(JSON.parse(e.data)); } catch (err) {}
  });
  es.addEventListener('chat', e => {
    try { onChat(JSON.parse(e.data)); } catch (err) {}
  });
  es.onerror = () => {
    net = everLive ? 'reconnecting' : 'connecting';
    renderStatus();
    if (es.readyState === 2) {                    // the browser gave up: retry ourselves
      retryTimer = setTimeout(connect, Math.min(15000, 1500 * Math.pow(2, retry)));
      retry += 1;
    }
  };
}

/* ---------- derived ---------- */
function seatList() {
  return state.players.map(p => {
    const isMe = p.id === you.id;
    const val = isMe ? (p.spectator ? null : myVote()) : p.vote;
    return { key: p.id, name: p.name, isMe, spec: p.spectator, online: p.online, smoking: p.smoking === true, smokeEnd: p.smoking ? smokeEnds.get(p.id) || 0 : 0, host: p.id === state.hostId, avatar: Number(p.avatar) || 0, val, voted: isMe ? val != null : p.voted };
  });
}

function tally(seats) {
  const deck = cards();
  const votes = state.revealed ? seats.filter(s => !s.spec && s.val != null) : [];
  const counts = new Map();
  for (const v of votes) counts.set(v.val, (counts.get(v.val) || 0) + 1);
  const pos = v => { const i = deck.indexOf(v); return i < 0 ? 999 : i; };
  const dist = [...counts].map(([val, n]) => ({ val, n })).sort((a, b) => pos(a.val) - pos(b.val));
  const real = votes.filter(v => isReal(v.val) && deck.includes(v.val));
  const nums = real.map(v => num(v.val)).filter(x => x != null);
  const avg = nums.length && nums.length === real.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  let top = null;
  for (const d of dist) if (isReal(d.val) && deck.includes(d.val) && (!top || d.n >= top.n)) top = d;
  const idx = real.map(v => deck.indexOf(v.val));
  const lo = idx.length ? Math.min(...idx) : -1, hi = idx.length ? Math.max(...idx) : -1;
  const who = i => real.filter(v => deck.indexOf(v.val) === i).map(v => v.isMe ? 'you' : v.name);
  const outliers = real.length >= 3 && lo !== hi ? { low: deck[lo], lowWho: who(lo), high: deck[hi], highWho: who(hi) } : null;
  return { total: votes.length, dist, avg, top, real: real.length, lo, hi, share: top && real.length ? top.n / real.length : 0, outliers, breaks: counts.get('coffee') || 0 };
}

function nextPending() {
  const list = state.stories;
  const i = list.findIndex(s => s.id === state.storyId);
  const order = i >= 0 ? [...list.slice(i + 1), ...list.slice(0, i)] : list;
  return order.find(s => s.estimate == null) || null;
}

/* ---------- rendering ---------- */
function renderStatus() {
  const pill = $('status');
  let text, cls;
  if (net === 'live' && state) { const n = state.players.length; text = n === 1 ? 'Live - just you' : 'Live - ' + n + ' here'; cls = 'is-live'; }
  else if (net === 'reconnecting') { text = 'Reconnecting'; cls = 'is-wait'; }
  else { text = 'Connecting'; cls = 'is-wait'; }
  if (pill.textContent !== text) pill.textContent = text;
  pill.className = 'pill ' + cls;
}

function render() {
  renderStatus();
  if (!state || !decks) return;
  const seats = seatList();
  const t = tally(seats);
  const w = seats.filter(s => s.spec).map(s => (s.isMe ? 'you' : s.name) + (s.host ? ' (host)' : '') + (s.smoking ? ' (smoke break)' : ''));
  $('watchers').hidden = !w.length;
  if (w.length) $('watchers').textContent = 'Watching: ' + w.join(', ');
  renderTopic();
  if (view3d && scene3d) {
    const canPlay = !spec && !state.revealed && seats.some(s => s.isMe && !s.spec);
    scene3d.update({
      players: seats.filter(s => !s.spec).map(s => ({
        id: s.key, name: s.name, avatar: s.avatar, isMe: s.isMe, online: s.online, smokeEnd: s.smokeEnd, host: s.host,
        voted: s.voted, val: s.isMe || state.revealed ? s.val : null,
      })),
      revealed: state.revealed, round: state.round, cards: cards(), myVote: myVote(), canPlay, smokeTotal: smokeMs,
    });
    $('stage-hint').hidden = true;
  } else if (!view3d) renderSeats(seats, t);
  renderConsole(seats, t);
  renderTray(t);
  renderStories();
  const run = canRun();
  if (editingDeck && !run) closeDeckEditor();
  const sel = $('deck');
  if (document.activeElement !== sel && !editingDeck && sel.value !== state.deck) sel.value = state.deck;
  sel.disabled = !run;
  sel.title = run ? '' : 'Only the host can change the deck';
  $('deck-edit').hidden = state.deck !== 'custom' || editingDeck || !run;
  $('host-only-wrap').hidden = !isHost();
  if ($('host-only').checked !== state.hostOnly) $('host-only').checked = state.hostOnly;
  $('host-claim').hidden = hostPlayer() !== null;
  tickSmoke();
  if (emoteTarget && !state.players.some(p => p.id === emoteTarget && !p.spectator)) closeEmotes();
  if ($('view3d').checked !== view3d) $('view3d').checked = view3d;
}

function renderTopic() {
  const input = $('topic'), box = $('topic-story');
  if (state.storyId) {
    const i = state.stories.findIndex(s => s.id === state.storyId);
    input.hidden = true; box.hidden = false;
    $('topic-title').textContent = (i >= 0 ? state.stories[i].title : state.title) || 'Untitled story';
    $('topic-tag').textContent = i >= 0 ? 'Story ' + (i + 1) + ' of ' + state.stories.length : '';
  } else {
    box.hidden = true; input.hidden = false;
    if (document.activeElement !== input && input.value !== state.title) input.value = state.title;
  }
}

const seatEls = new Map();
function makeSeat() {
  const root = el('div', 'seat');
  const card = el('div', 'pcard'), inner = el('div', 'pcard-in'), face = el('div', 'pcard-face');
  inner.append(el('div', 'pcard-back'), face);
  card.append(inner);
  const label = el('div', 'seat-name'), nm = el('span'), youTag = el('span', 'seat-you', 'you'), hostTag = el('span', 'seat-host', 'host');
  label.append(nm, youTag, hostTag);
  root.append(card, label);
  return { root, card, face, nm, youTag, hostTag, cig: null, smokeEnd: 0 };
}
function renderSeats(seats, t) {
  const box = $('seats');
  const players = seats.filter(s => !s.spec);
  const half = Math.ceil(players.length / 2);
  const seen = new Set();
  players.forEach((s, i) => {
    let e = seatEls.get(s.key);
    if (!e) { e = makeSeat(); seatEls.set(s.key, e); box.append(e.root); }
    seen.add(s.key);
    const topRow = i < half;
    e.root.style.order = String(topRow ? i : 501 + i);
    e.root.style.setProperty('--i', String(i));
    const up = state.revealed && s.val != null;
    if (up) setFace(e.face, s.val);
    e.root.classList.toggle('is-top', topRow);
    e.root.classList.toggle('is-voted', s.voted);
    e.root.classList.toggle('is-up', up);
    e.root.classList.toggle('is-out', state.revealed && !s.voted);
    e.root.classList.toggle('is-away', !s.online);
    e.root.classList.toggle('is-other', !s.isMe);
    e.root.dataset.id = s.key;
    if (s.isMe) { e.root.removeAttribute('tabindex'); e.root.removeAttribute('role'); e.root.removeAttribute('title'); }
    else { e.root.tabIndex = 0; e.root.setAttribute('role', 'button'); e.root.title = 'Send ' + s.name + ' a reaction'; }
    if (s.smoking && !e.cig) { e.card.insertAdjacentHTML('beforeend', CIG); e.cig = e.card.lastElementChild; }
    else if (!s.smoking && e.cig) { e.cig.remove(); e.cig = null; }
    e.smokeEnd = s.smoking ? s.smokeEnd : 0;
    if (e.nm.textContent !== s.name) e.nm.textContent = s.name;
    e.youTag.hidden = !s.isMe;
    e.hostTag.hidden = !s.host;
    e.root.setAttribute('aria-label', s.name + (s.host ? ' (host)' : '') + (up ? ' voted ' + spoken(s.val) : s.voted ? ' has voted' : ' has not voted') + (s.smoking ? ', on a smoke break' : '') + (s.isMe ? '' : '. Send a reaction'));
  });
  for (const [k, e] of seatEls) if (!seen.has(k)) { e.root.remove(); seatEls.delete(k); }
  $('table').classList.toggle('is-consensus', state.revealed && t.real >= 2 && t.share === 1);
}

let consoleSig = '';
function renderConsole(seats, t) {
  const players = seats.filter(s => !s.spec);
  const votedN = players.filter(s => s.voted).length;
  const next = state.storyId ? nextPending() : null;
  const alone = seats.length === 1;
  const head = !state.revealed ? '' : t.avg != null ? 'a' + fmt(t.avg) : t.top ? 't' + t.top.val : 'n';
  const run = canRun(), host = hostPlayer();
  const waitFor = host
    ? (state.revealed ? host.name + ' starts the next round.' : 'Only ' + host.name + ' can reveal the cards.')
    : 'The host has left the table.';
  const sig = [state.revealed, votedN, players.length, spec, next ? next.id : '', alone, head, run, host ? host.name : ''].join('|');
  if (sig === consoleSig) return;
  consoleSig = sig;
  const box = $('console');
  box.replaceChildren();
  const button = (cls, text, act) => { const b = el('button', 'btn ' + cls, text); b.type = 'button'; b.dataset.act = act; return b; };
  if (!state.revealed) {
    let msg;
    if (!players.length) msg = 'Nobody is seated to vote';
    else if (votedN === 0) msg = spec ? 'Waiting for votes' : 'Pick a card to vote';
    else if (votedN === players.length) msg = players.length === 1 ? 'Your card is down' : 'Everyone has voted';
    else msg = votedN + ' of ' + players.length + ' have voted';
    box.append(el('p', 'console-msg', msg));
    if (run) {
      const reveal = button('btn-gold', 'Reveal cards', 'reveal');
      reveal.disabled = votedN === 0;
      box.append(reveal);
    } else {
      box.append(el('p', 'console-hint', waitFor));
      if (!host) box.append(button('btn-felt', 'Become host', 'host.claim'));
    }
    if (alone) box.append(el('p', 'console-hint', 'Only you so far. Copy the invite link and send it to your team.'));
    return;
  }
  const h = el('div', 'headline');
  if (t.avg != null) h.append(el('span', 'headline-k', 'Average'), el('span', 'headline-v', fmt(t.avg)));
  else if (t.top) { const v = el('span', 'headline-v'); setFace(v, t.top.val); h.append(el('span', 'headline-k', 'Most picked'), v); }
  else h.append(el('span', 'console-msg', 'No estimates this round'));
  box.append(h);
  if (run) {
    const row = el('div', 'console-row');
    row.append(next ? button('btn-gold', 'Next story', 'next') : button('btn-gold', 'New round', 'new'), button('btn-felt', 'Vote again', 'again'));
    box.append(row);
  } else {
    box.append(el('p', 'console-hint', waitFor));
    if (!host) box.append(button('btn-felt', 'Become host', 'host.claim'));
  }
}

let traySig = '';
function joinNames(list) {
  return list.length > 2 ? list.slice(0, 2).join(', ') + ' and ' + (list.length - 2) + ' more' : list.join(' and ');
}
function renderTray(t) {
  const tray = $('tray');
  if (!state.revealed && !spec && view3d && scene3d) {
    if (traySig !== 'hand3d') {
      traySig = 'hand3d';
      tray.replaceChildren(el('p', 'tray-note', 'Move the mouse over the table to look around. Your cards are face down in your hands: click them to look, click a card to play it, and click your played card on the table to take it back. On a smoke break, click the ashtray to put the cigarette out.'));
    }
    return;
  }
  if (!state.revealed && !spec) {
    const sig = 'hand|' + state.deck;
    if (sig !== traySig) {
      traySig = sig;
      const hand = el('div', 'hand');
      for (const v of cards()) {
        const b = el('button', 'hcard');
        b.type = 'button'; b.dataset.card = v;
        b.setAttribute('aria-label', 'Vote ' + spoken(v));
        setFace(b, v);
        hand.append(b);
      }
      tray.replaceChildren(el('h2', 'eyebrow', 'Your card'), hand);
    }
    const mine = myVote();
    for (const b of tray.querySelectorAll('.hcard')) b.setAttribute('aria-pressed', String(b.dataset.card === mine));
    return;
  }
  if (!state.revealed) {
    if (traySig !== 'watch') { traySig = 'watch'; tray.replaceChildren(el('p', 'tray-note', 'You are watching this round. Turn off Just watching to get your cards back.')); }
    return;
  }
  const story = state.storyId ? state.stories.find(s => s.id === state.storyId) || null : null;
  const sig = 'res|' + JSON.stringify([state.deck, t.dist, t.avg, t.real, t.outliers, t.breaks, story && story.id, story && story.estimate]);
  if (sig === traySig) return;
  traySig = sig;

  const res = el('div', 'results');
  const dist = el('div', 'dist');
  const max = Math.max(1, ...t.dist.map(d => d.n));
  for (const d of t.dist) {
    const col = el('div', 'dist-col'), bar = el('span', 'dist-bar'), c = el('span', 'mini');
    bar.style.height = Math.round(8 + 44 * d.n / max) + 'px';
    setFace(c, d.val);
    col.append(bar, c, el('span', 'dist-n', d.n === 1 ? '1 vote' : d.n + ' votes'));
    dist.append(col);
  }

  const read = el('div', 'read');
  let title, detail;
  if (!t.real) { title = 'No estimates'; detail = t.total ? 'Only question marks and breaks were played.' : 'Nobody voted this round.'; }
  else if (t.real === 1) { title = 'One vote'; detail = 'A single estimate of ' + t.top.val + '.'; }
  else if (t.share === 1) { title = 'Consensus'; detail = 'All ' + t.real + ' picked ' + t.top.val + '.'; }
  else { title = t.share >= 0.6 ? 'Nearly there' : 'Split'; detail = t.top.n + ' of ' + t.real + ' picked ' + t.top.val + '.'; }
  read.append(el('span', 'eyebrow', 'Agreement'), el('span', 'read-v', title), el('p', null, detail));
  if (t.outliers) {
    const o = t.outliers;
    read.append(el('p', 'read-ask', 'Lowest ' + o.low + ' (' + joinNames(o.lowWho) + '), highest ' + o.high + ' (' + joinNames(o.highWho) + '). Hear both ends out before voting again.'));
  }
  if (t.breaks) read.append(el('p', null, t.breaks === 1 ? 'One person asked for a break.' : t.breaks + ' people asked for a break.'));
  res.append(dist, read);

  if (story) {
    const real = cards().filter(isReal);
    const from = t.real ? Math.max(0, real.indexOf(cards()[t.lo])) : 0;
    const to = t.real ? real.indexOf(cards()[t.hi]) : real.length - 1;
    const range = real.slice(from, to + 1);
    const save = el('div', 'save');
    save.append(el('span', 'save-k', story.estimate != null ? 'Estimate saved' : 'Save the estimate'));
    for (const v of range) {
      const b = el('button', 'chip' + (story.estimate === v ? ' is-saved' : t.top && t.top.val === v && story.estimate == null ? ' is-suggest' : ''), v);
      b.type = 'button'; b.dataset.act = 'save'; b.dataset.v = v;
      b.setAttribute('aria-label', 'Save ' + v + ' as the estimate');
      save.append(b);
    }
    if (story.estimate != null && !range.includes(story.estimate)) save.append(el('span', 'save-note', 'Currently ' + story.estimate + '.'));
    res.append(save);
  }
  tray.replaceChildren(el('h2', 'eyebrow', 'Results'), res);
}

let storiesSig = '';
function renderStories() {
  const stories = state.stories;
  const run = canRun();
  const sig = JSON.stringify([stories, state.storyId, run]);
  if (sig === storiesSig) return;
  storiesSig = sig;
  const rows = stories.map((s, i) => {
    const li = el('li', 'story' + (s.id === state.storyId ? ' is-current' : ''));
    const right = el('span', 'story-right');
    if (s.estimate != null) { const b = el('span', 'est'); setFace(b, s.estimate); right.append(b); }
    if (s.id === state.storyId) right.append(el('span', 'now', 'Voting'));
    else if (run) { const b = el('button', 'link', s.estimate != null ? 'Re-vote' : 'Vote'); b.type = 'button'; b.dataset.act = 'vote'; b.dataset.id = s.id; right.append(b); }
    const x = el('button', 'x', '✕'); x.type = 'button'; x.dataset.act = 'rm'; x.dataset.id = s.id; x.setAttribute('aria-label', 'Remove ' + s.title);
    right.append(x);
    li.append(el('span', 'story-n', String(i + 1)), el('span', 'story-title', s.title), right);
    return li;
  });
  $('story-list').replaceChildren(...rows);
  $('story-msg').hidden = stories.length > 0;
  $('story-msg').textContent = 'No stories yet. Paste your backlog below, one per line, or skip the list and vote on anything.';
  const done = stories.filter(s => s.estimate != null);
  $('story-meta').textContent = stories.length ? done.length + ' of ' + stories.length + ' estimated' : '';
  const nums = done.map(s => num(s.estimate)).filter(x => x != null);
  $('story-total').hidden = !nums.length;
  if (nums.length) $('story-sum').textContent = fmt(nums.reduce((a, b) => a + b, 0));
  $('copy').hidden = !stories.length;
}

/* ---------- smoke break: three minutes, burning down where everyone can see ---------- */
function tickSmoke() {
  if (!state || !you) return;
  const now = Date.now();
  const myEnd = smokeEnds.get(you.id) || 0, mine = myEnd > now;
  $('smoke').setAttribute('aria-pressed', String(mine));
  const text = mine ? 'Smoking ' + clock(myEnd - now) : 'Smoke break';
  if ($('smoke-label').textContent !== text) $('smoke-label').textContent = text;
  if (view3d) return;                       // the 3D table animates its own cigarettes
  for (const e of seatEls.values()) {
    const left = e.smokeEnd ? Math.max(0, e.smokeEnd - now) : 0;
    if (!e.cig || !left) continue;
    e.cig.classList.toggle('is-lighting', smokeMs - left < 1900);     // a flame at the tip for the first moments
    const w = 4 + 18 * Math.min(1, left / smokeMs);          // length of paper still to burn
    const dx = 16 + w + 6 - 24;
    e.cig.querySelector('.cig-paper').setAttribute('width', w.toFixed(1));
    e.cig.querySelector('.ember').setAttribute('x', (16 + w).toFixed(1));
    e.cig.querySelector('.cig-ash').setAttribute('x', (18.5 + w).toFixed(1));
    for (const puff of e.cig.querySelectorAll('.puff')) {     // smoke rises from wherever the tip is now
      puff.setAttribute('cx', (24 + dx * 0.951 - 0.15).toFixed(1));
      puff.setAttribute('cy', (34 - dx * 0.309 - 0.5).toFixed(1));
    }
  }
}

/* ---------- chat: a line in the log and a speech bubble by whoever said it ---------- */
const bubbles = new Map();
function onChat(d) {
  if (!state || typeof d.text !== 'string') return;
  const name = clean(String(d.name || 'Someone'), 24), text = d.text.slice(0, 140);
  const log = $('chat-log');
  const li = el('li'), who = el('strong', null, (you && d.from === you.id ? 'You' : name) + ' ');
  li.append(who, document.createTextNode(text));
  log.append(li);
  while (log.children.length > 60) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
  $('chat-empty').hidden = true;
  if (document.hidden) return;
  if (view3d) { if (scene3d) scene3d.chat(d.from, name, text); return; }
  const seat = seatEls.get(d.from);
  if (!seat) return;
  const old = bubbles.get(d.from);
  if (old) { clearTimeout(old.timer); old.node.remove(); }
  const node = el('div', 'bubble', text), table = $('table');
  table.append(node);
  const t = table.getBoundingClientRect(), c = seat.root.getBoundingClientRect(), b = node.getBoundingClientRect();
  let top = c.top - t.top - b.height - 12;
  if (top < -40) { top = c.bottom - t.top + 12; node.classList.add('is-below'); }
  node.style.top = Math.round(top) + 'px';
  const left = Math.max(6, Math.min(c.left - t.left + c.width / 2 - b.width / 2, t.width - b.width - 6));
  node.style.left = Math.round(left) + 'px';
  node.style.setProperty('--tail', Math.round(c.left - t.left + c.width / 2 - left) + 'px');
  const timer = setTimeout(() => { node.remove(); bubbles.delete(d.from); }, Math.min(9000, 3500 + text.length * 60));
  bubbles.set(d.from, { node, timer });
}

/* ---------- reactions ---------- */
function closeEmotes() {
  clearTimeout(emoteTimer);
  emoteTarget = null;
  $('emotes').hidden = true;
}
function openEmotes(id, viaKeyboard, point) {
  const seat = seatEls.get(id), who = state && state.players.find(p => p.id === id);
  if (!who || (!seat && !point)) return;
  const pop = $('emotes'), table = pop.parentElement;
  emoteTarget = id;
  pop.hidden = false;
  pop.setAttribute('aria-label', 'Send ' + who.name + ' a reaction');
  const pass = pop.querySelector('.emotes-host');
  if (pass) pass.hidden = !isHost();
  // float just above the whole seat so the name stays readable; drop below it only when there is no room
  const t = table.getBoundingClientRect(), p = pop.getBoundingClientRect();
  // in 3D the anchor is the point on screen above the character's head; in 2D it is the seat
  const c = point ? { left: t.left + point.x, top: t.top + point.y, bottom: t.top + point.y + 70, width: 0 } : seat.root.getBoundingClientRect();
  let left = c.left - t.left + c.width / 2 - p.width / 2;
  left = Math.max(8, Math.min(left, t.width - p.width - 8));
  let top = c.top - t.top - p.height - 6;
  if (top < (point ? 6 : -24)) top = c.bottom - t.top + 6;
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  if (viaKeyboard && pop.firstElementChild) pop.firstElementChild.focus();
  clearTimeout(emoteTimer);
  emoteTimer = setTimeout(closeEmotes, 6000);
}
function fly(d) {
  if (document.hidden || !state || typeof d.emote !== 'string') return;
  if (view3d) { if (scene3d) scene3d.emote(d.from, d.to, d.emote.slice(0, 8)); return; }
  const table = $('table'), to = seatEls.get(d.to);
  if (!to || table.querySelectorAll('.fly').length > 40) return;
  const base = table.getBoundingClientRect();
  const centre = node => { const r = node.getBoundingClientRect(); return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 }; };
  const end = centre(to.card);
  const from = seatEls.get(d.from);
  const start = from ? centre(from.card) : { x: base.width / 2, y: 18 };
  const at = (pt, scale) => 'translate(' + Math.round(pt.x - 15) + 'px,' + Math.round(pt.y - 15) + 'px) scale(' + scale + ')';
  const node = el('span', 'fly', d.emote.slice(0, 8));
  node.style.transform = at(start, 0.7);
  table.append(node);
  const land = () => {
    to.root.classList.remove('is-hit');
    void to.root.offsetWidth;
    to.root.classList.add('is-hit');
    const fade = node.animate(
      [{ transform: at(end, 1), opacity: 1 }, { transform: at({ x: end.x, y: end.y - 36 }, 2), opacity: 0 }],
      { duration: 750, easing: 'ease-out', fill: 'forwards' });
    fade.onfinish = () => node.remove();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { node.style.transform = at(end, 1); land(); }
  else {
    const mid = { x: (start.x + end.x) / 2 + (Math.random() * 40 - 20), y: Math.min(start.y, end.y) - 48 };
    const flight = node.animate(
      [{ transform: at(start, 0.7) }, { transform: at(mid, 1.3), offset: 0.55 }, { transform: at(end, 1) }],
      { duration: 620, easing: 'ease-in-out', fill: 'forwards' });
    flight.onfinish = land;
  }
  setTimeout(() => node.remove(), 4000);
}

/* ---------- 3D table ---------- */
function castVote(value) {
  if (!state || state.revealed || spec) return;
  local.vote = value; local.round = state.round;
  render();
  send({ type: 'vote', value, round: state.round }).then(ok => { if (!ok) { local.vote = undefined; render(); } });
}
function sendLook(yaw, pitch, hand) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'look', y: Math.round(yaw * 100) / 100, p: Math.round(pitch * 100) / 100, h: hand }));
}
function connectWs() {            // head movement travels over its own WebSocket; the table works without it
  clearTimeout(wsTimer);
  if (!view3d || !scene3d || ws) return;
  let url;
  try { url = new URL(api('ws') + '?token=' + encodeURIComponent(token), location.href); } catch (e) { return; }
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let sock;
  try { sock = new WebSocket(url); } catch (e) { return; }
  ws = sock;
  sock.onmessage = e => {
    try { const m = JSON.parse(e.data); if (m.t === 'looks' && scene3d) scene3d.looks(m.l); } catch (err) {}
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    if (view3d && scene3d) wsTimer = setTimeout(connectWs, 2500);
  };
  sock.onerror = () => {};
}
function applyView() {
  $('stage').hidden = !view3d;
  $('stage-hud').hidden = !view3d;
  $('table').hidden = view3d;
  const consoleHome = view3d ? $('stage-hud') : $('seats');
  if ($('console').parentElement !== consoleHome) consoleHome.append($('console'));
  const pickerHome = view3d ? $('stage') : $('table');
  if ($('emotes').parentElement !== pickerHome) pickerHome.append($('emotes'));
  $('view3d').checked = view3d;
  traySig = '';
  consoleSig = '';
  renderKeys();
}

/* ---------- keyboard shortcuts ---------- */
const KEYS_3D = [['Space', 'cards up or down'], ['\u2190 \u2192', 'choose a card'], ['Enter', 'play it'], ['0-9', 'jump to a number'], ['Esc', 'cards down']];
const KEYS_ALL = [['R', 'reveal'], ['N', 'next round'], ['A', 'vote again'], ['S', 'smoke break'], ['C', 'chat']];
function renderKeys() {
  const box = $('keys');
  box.replaceChildren(el('span', 'keys-title', 'Keys'));
  for (const [key, what] of (view3d ? KEYS_3D : []).concat(KEYS_ALL)) {
    const item = el('span', 'keys-item');
    for (const k of key.split(' ')) item.append(el('kbd', null, k));
    item.append(' ' + what);
    box.append(item);
  }
}
function toggleSmoke() {
  if (!state || !you) return;
  send({ type: 'smoke', on: !((smokeEnds.get(you.id) || 0) > Date.now()) });
}
function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !state || !you) return;
  const t = e.target instanceof Element ? e.target : document.body;
  if (t.closest('input, textarea, select, [contenteditable]')) return;      // typing, or a control that uses the key itself
  const onButton = !!t.closest('button, a[href], summary');
  const table = view3d && scene3d ? scene3d : null;
  const k = e.key;
  if (k === ' ' || k === 'Spacebar') { if (!onButton && table && table.key('hand')) e.preventDefault(); return; }
  if (k === 'Enter') { if (!onButton && table && table.key('play')) e.preventDefault(); return; }
  if (k === 'ArrowLeft' || k === 'ArrowRight') { if (table && table.key(k === 'ArrowLeft' ? 'left' : 'right')) e.preventDefault(); return; }
  if (k === 'Escape') { if (table) table.key('down'); return; }
  if (/^[0-9?]$/.test(k)) { if (table && table.key('type', k)) e.preventDefault(); return; }
  if (e.repeat || e.shiftKey) return;
  const letter = k.toLowerCase();
  if (letter === 's') { toggleSmoke(); return; }
  if (letter === 'c') { e.preventDefault(); $('chat-input').focus(); return; }
  if (letter !== 'r' && letter !== 'n' && letter !== 'a') return;
  if (!canRun()) { const host = hostPlayer(); toast(host ? 'Only ' + host.name + ' can do that at this table.' : 'This table has no host right now.'); return; }
  if (letter === 'r') {
    if (!state.revealed && state.players.some(p => !p.spectator && (p.voted || (p.id === you.id && myVote() != null)))) send({ type: 'reveal', round: state.round });
  } else if (state.revealed) {
    send({ type: letter === 'a' ? 'again' : state.storyId && nextPending() ? 'next' : 'new', round: state.round });
  }
}
async function start3d() {
  if (scene3d || loading3d) return;
  loading3d = true;
  $('stage-hint').hidden = false;
  $('stage-hint').textContent = 'Setting up the 3D table';
  try {
    const mod = await import('./table3d.js');
    scene3d = await mod.createTable3D({
      mount: $('stage'), onVote: castVote, onLook: sendLook, onMiss: closeEmotes,
      onPlayer: (id, point) => { if (emoteTarget === id) closeEmotes(); else openEmotes(id, false, point); },
      onStopSmoking: () => { send({ type: 'smoke', on: false }); },
      onSlow: () => toast('The 3D table is running slowly on this device. Switch off "3D table" for the 2D view.'),
    });
  } catch (e) {
    view3d = false;
    store.set('pp.view', '2d');
    toast('The 3D table is not available in this browser, so you are on the 2D table.');
  }
  loading3d = false;
  if (!view3d) stop3d();              // switched off (or failed) while loading
  applyView();
  render();
  connectWs();
}
function stop3d() {
  clearTimeout(wsTimer);
  if (ws) { const sock = ws; ws = null; sock.close(); }
  if (scene3d) { scene3d.dispose(); scene3d = null; }
}

/* ---------- custom deck ---------- */
function openDeckEditor() {
  if (!state) return;
  editingDeck = true;
  const source = state.custom && state.custom.length ? state.custom : cards();
  $('deck-values').value = source.map(v => v === 'coffee' ? '☕' : v).join(', ');
  $('deck-editor').hidden = false;
  $('deck').value = 'custom';
  $('deck-edit').hidden = true;
  $('deck-values').focus();
}
function closeDeckEditor() {
  editingDeck = false;
  $('deck-editor').hidden = true;
  if (state) { $('deck').value = state.deck; $('deck-edit').hidden = state.deck !== 'custom'; }
}

function resultsText() {
  const lines = state.stories.map((s, i) => (i + 1) + '. ' + s.title + ' - ' + (s.estimate != null ? s.estimate : 'not estimated'));
  const nums = state.stories.map(s => s.estimate != null ? num(s.estimate) : null).filter(x => x != null);
  if (nums.length) lines.push('Total: ' + fmt(nums.reduce((a, b) => a + b, 0)));
  return ['Planning poker results', ...lines].join('\n');
}

/* ---------- controls ---------- */
function bind() {
  const nick = $('nick');
  nick.value = name;
  let nickTimer = 0;
  nick.addEventListener('input', () => {
    clearTimeout(nickTimer);
    nickTimer = setTimeout(() => {
      const v = clean(nick.value, 24);
      if (!v || v === name) return;
      name = v; store.set('pp.name', name);
      send({ type: 'profile', name, spectator: spec });
    }, 400);
  });
  nick.addEventListener('blur', () => { if (!clean(nick.value, 24)) nick.value = name; });

  $('spec').checked = spec;
  $('spec').addEventListener('change', e => {
    spec = e.target.checked; store.set('pp.spec', spec ? '1' : '0');
    if (spec) local.vote = undefined;
    send({ type: 'profile', name, spectator: spec });
    render();
  });

  // Space and the arrows are shortcuts at the table, so a control that was clicked with the mouse must not
  // keep the keyboard focus (focus reached with Tab is left alone).
  let viaPointer = false;
  document.addEventListener('pointerdown', () => { viaPointer = true; }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Tab') viaPointer = false; }, true);
  document.addEventListener('click', e => {
    const a = document.activeElement;
    if (e.detail > 0 && a && a.matches('button, input[type="checkbox"]')) a.blur();
  });
  document.addEventListener('keydown', onKey);

  $('deck').addEventListener('change', e => {
    if (viaPointer) e.target.blur();
    if (!state) return;
    if (e.target.value === 'custom') { openDeckEditor(); return; }
    if (editingDeck) closeDeckEditor();
    if (e.target.value !== state.deck) send({ type: 'deck', deck: e.target.value });
  });
  $('deck-edit').addEventListener('click', openDeckEditor);
  $('deck-cancel').addEventListener('click', closeDeckEditor);
  $('deck-editor').addEventListener('submit', async e => {
    e.preventDefault();
    const values = [...new Set($('deck-values').value.split(/[\s,;]+/).map(v => v.trim()).filter(Boolean))];
    if (values.length < 2) { toast('Add at least two different values.'); return; }
    const ok = await send({ type: 'deck', deck: 'custom', cards: values });
    if (ok) closeDeckEditor();
  });

  $('view3d').addEventListener('change', e => {
    view3d = e.target.checked;
    store.set('pp.view', view3d ? '3d' : '2d');
    closeEmotes();
    if (!view3d) stop3d();
    applyView();
    render();
    if (view3d) start3d();
  });

  $('host-only').addEventListener('change', e => { send({ type: 'host.only', on: e.target.checked }); });
  $('host-claim').addEventListener('click', () => { send({ type: 'host.claim' }); });

  $('smoke').addEventListener('click', toggleSmoke);
  setInterval(tickSmoke, 500);

  $('chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('chat-input'), text = clean(input.value, 140);
    if (!text || !state) return;
    input.value = '';
    send({ type: 'chat', text });
  });

  const seatFrom = target => { const s = target.closest('.seat.is-other'); return s ? s.dataset.id : null; };
  $('seats').addEventListener('click', e => {
    const id = seatFrom(e.target);
    if (!id) return;
    if (emoteTarget === id) closeEmotes(); else openEmotes(id, false);
  });
  $('seats').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const id = seatFrom(e.target);
    if (!id || e.target.closest('button')) return;
    e.preventDefault();
    openEmotes(id, true);
  });
  $('emotes').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !emoteTarget) return;
    if (b.dataset.host) { send({ type: 'host.pass', to: emoteTarget }); closeEmotes(); return; }
    send({ type: 'emote', to: emoteTarget, emote: b.dataset.emote }, true);
    clearTimeout(emoteTimer);
    emoteTimer = setTimeout(closeEmotes, 6000);
  });
  document.addEventListener('click', e => {
    // clicks on the 3D canvas are handled by the scene, which reports a miss itself
    if (emoteTarget && !e.target.closest('#emotes') && !e.target.closest('.seat.is-other') && !e.target.closest('.stage-canvas')) closeEmotes();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && emoteTarget) closeEmotes(); });

  $('invite').addEventListener('click', () => copyText(location.origin + location.pathname + '?room=' + roomId, 'Invite link copied.'));

  const topic = $('topic');
  let topicTimer = 0;
  const sendTopic = () => { if (!state || state.storyId) return; const t = clean(topic.value, 160); if (t !== state.title) send({ type: 'topic', title: t }, true); };
  topic.addEventListener('input', () => { clearTimeout(topicTimer); topicTimer = setTimeout(sendTopic, 500); });
  topic.addEventListener('blur', () => { clearTimeout(topicTimer); sendTopic(); });

  $('console').addEventListener('click', e => {       // the console moves between the 2D table and the 3D stage
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !state) return;
    send({ type: b.dataset.act, round: state.round });
  });

  $('tray').addEventListener('click', e => {
    if (!state) return;
    const c = e.target.closest('.hcard');
    if (c) { castVote(myVote() === c.dataset.card ? null : c.dataset.card); return; }
    const b = e.target.closest('[data-act="save"]');
    if (b && state.storyId) {
      const s = state.stories.find(x => x.id === state.storyId);
      if (s) send({ type: 'story.estimate', id: s.id, estimate: s.estimate === b.dataset.v ? null : b.dataset.v });
    }
  });

  $('story-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !state) return;
    if (b.dataset.act === 'vote') send({ type: 'story.select', id: b.dataset.id, round: state.round });
    else if (b.dataset.act === 'rm') {
      if (!b.classList.contains('is-armed')) {
        b.classList.add('is-armed'); b.textContent = 'Remove?';
        setTimeout(() => { if (b.isConnected) { b.classList.remove('is-armed'); b.textContent = '✕'; } }, 3000);
        return;
      }
      send({ type: 'story.remove', id: b.dataset.id });
    }
  });

  $('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('add-input'), btn = $('add-btn');
    const titles = input.value.split(/\r?\n/)
      .map(l => clean(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''), 160))
      .filter(Boolean).slice(0, 60);
    if (!titles.length) return;
    btn.disabled = true;
    const ok = await send({ type: 'story.add', titles });
    btn.disabled = false;
    if (ok) input.value = '';
  });

  $('copy').addEventListener('click', () => { if (state) copyText(resultsText(), 'Results copied.'); });

  setInterval(() => { if (state) send({ type: 'ping' }, true); }, 25000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && es && es.readyState === 2) connect();
  });
}

function seat() {
  $('join').hidden = true;
  $('controls').hidden = false;
  $('layout').hidden = false;
  $('foot').hidden = false;
  $('credit').hidden = false;
  bind();
  applyView();
  connect();
  if (view3d) start3d();
}

if (name) seat();
else {
  $('join').hidden = false;
  $('join-room').textContent = roomId;
  $('join-spec').checked = spec;
  $('join-name').focus();
  $('join-form').addEventListener('submit', e => {
    e.preventDefault();
    const v = clean($('join-name').value, 24);
    if (!v) return;
    name = v; spec = $('join-spec').checked;
    store.set('pp.name', name); store.set('pp.spec', spec ? '1' : '0');
    seat();
  });
}
})();
