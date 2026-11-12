(() => {
'use strict';

const CUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3v3M12 3v3"/></svg>';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clean = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const num = v => v === '½' ? 0.5 : (/^\d+$/.test(v) ? Number(v) : null);
const isReal = v => v !== '?' && v !== 'coffee';
const fmt = n => { const r = Math.round(n * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
const spoken = v => v === 'coffee' ? 'a break' : v === '?' ? 'not sure' : v;
function setFace(node, v) {
  if (node.dataset.v === v) return;
  node.dataset.v = v;
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
const cards = () => (decks && state && decks[state.deck] ? decks[state.deck].cards : []);
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
    try { decks = JSON.parse(e.data).decks; } catch (err) { return; }
    const sel = $('deck');
    sel.replaceChildren();
    for (const [id, d] of Object.entries(decks)) { const o = el('option', null, d.label); o.value = id; sel.append(o); }
    // the stream may have reconnected with an old name: bring the server up to date
    if (name !== sentName || spec !== sentSpec) send({ type: 'profile', name, spectator: spec }, true);
  });
  es.addEventListener('state', e => {
    let d;
    try { d = JSON.parse(e.data); } catch (err) { return; }
    state = d.state; you = d.you;
    net = 'live'; everLive = true; retry = 0;
    if (local.vote !== undefined && (local.round !== state.round || you.vote === local.vote)) local.vote = undefined;
    render();
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
    return { key: p.id, name: p.name, isMe, spec: p.spectator, online: p.online, val, voted: isMe ? val != null : p.voted };
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
  const w = seats.filter(s => s.spec).map(s => s.isMe ? 'you' : s.name);
  $('watchers').hidden = !w.length;
  if (w.length) $('watchers').textContent = 'Watching: ' + w.join(', ');
  renderTopic();
  renderSeats(seats, t);
  renderConsole(seats, t);
  renderTray(t);
  renderStories();
  const sel = $('deck');
  if (document.activeElement !== sel && sel.value !== state.deck) sel.value = state.deck;
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
  const label = el('div', 'seat-name'), nm = el('span'), youTag = el('span', 'seat-you', 'you');
  label.append(nm, youTag);
  root.append(card, label);
  return { root, face, nm, youTag };
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
    if (e.nm.textContent !== s.name) e.nm.textContent = s.name;
    e.youTag.hidden = !s.isMe;
    e.root.setAttribute('aria-label', s.name + (up ? ' voted ' + spoken(s.val) : s.voted ? ' has voted' : ' has not voted'));
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
  const sig = [state.revealed, votedN, players.length, spec, next ? next.id : '', alone, head].join('|');
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
    const reveal = button('btn-gold', 'Reveal cards', 'reveal');
    reveal.disabled = votedN === 0;
    box.append(el('p', 'console-msg', msg), reveal);
    if (alone) box.append(el('p', 'console-hint', 'Only you so far. Copy the invite link and send it to your team.'));
    return;
  }
  const h = el('div', 'headline');
  if (t.avg != null) h.append(el('span', 'headline-k', 'Average'), el('span', 'headline-v', fmt(t.avg)));
  else if (t.top) { const v = el('span', 'headline-v'); setFace(v, t.top.val); h.append(el('span', 'headline-k', 'Most picked'), v); }
  else h.append(el('span', 'console-msg', 'No estimates this round'));
  const row = el('div', 'console-row');
  row.append(next ? button('btn-gold', 'Next story', 'next') : button('btn-gold', 'New round', 'new'), button('btn-felt', 'Vote again', 'again'));
  box.append(h, row);
}

let traySig = '';
function joinNames(list) {
  return list.length > 2 ? list.slice(0, 2).join(', ') + ' and ' + (list.length - 2) + ' more' : list.join(' and ');
}
function renderTray(t) {
  const tray = $('tray');
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
  const sig = JSON.stringify([stories, state.storyId]);
  if (sig === storiesSig) return;
  storiesSig = sig;
  const rows = stories.map((s, i) => {
    const li = el('li', 'story' + (s.id === state.storyId ? ' is-current' : ''));
    const right = el('span', 'story-right');
    if (s.estimate != null) { const b = el('span', 'est'); setFace(b, s.estimate); right.append(b); }
    if (s.id === state.storyId) right.append(el('span', 'now', 'Voting'));
    else { const b = el('button', 'link', s.estimate != null ? 'Re-vote' : 'Vote'); b.type = 'button'; b.dataset.act = 'vote'; b.dataset.id = s.id; right.append(b); }
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

  $('deck').addEventListener('change', e => { if (state && e.target.value !== state.deck) send({ type: 'deck', deck: e.target.value }); });

  $('invite').addEventListener('click', () => copyText(location.origin + location.pathname + '?room=' + roomId, 'Invite link copied.'));

  const topic = $('topic');
  let topicTimer = 0;
  const sendTopic = () => { if (!state || state.storyId) return; const t = clean(topic.value, 160); if (t !== state.title) send({ type: 'topic', title: t }, true); };
  topic.addEventListener('input', () => { clearTimeout(topicTimer); topicTimer = setTimeout(sendTopic, 500); });
  topic.addEventListener('blur', () => { clearTimeout(topicTimer); sendTopic(); });

  $('table').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !state) return;
    send({ type: b.dataset.act, round: state.round });
  });

  $('tray').addEventListener('click', e => {
    if (!state) return;
    const c = e.target.closest('.hcard');
    if (c) {
      if (state.revealed || spec) return;
      const value = myVote() === c.dataset.card ? null : c.dataset.card;
      local.vote = value; local.round = state.round;
      render();
      send({ type: 'vote', value, round: state.round }).then(ok => { if (!ok) { local.vote = undefined; render(); } });
      return;
    }
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
  bind();
  connect();
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
