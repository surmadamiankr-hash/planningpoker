# Planning Poker (self-hosted)

Open a table, send the link to your team, vote face down, reveal together.
No accounts, no database, no requests to outside services.

Made by Damian Surma. Inspired by Boguś.

## Run it

Needs Node 18 or newer.

```
npm install
node server.js
```

Then open http://localhost:3000, give the table a name (or leave it empty) and
share the address of the page. Everyone who opens that link gets a seat.

With Docker:

```
docker compose up -d --build
```

## How it works

- `server.js` is the whole backend: plain Node `http` plus one package, `ws`.
- The table state travels over server-sent events (one long-lived GET per
  browser tab) and actions are small JSON POSTs. The 3D view also opens a
  WebSocket that carries head movement, ten updates a second at most. If the
  WebSocket cannot connect, everything still works; heads just stay still.
- 3D table: each person sits in their own seat and sees the table from there.
  Moving the mouse turns your head, and the others see it. Your cards are
  face down in your hands: click them to look, click one to play it. The
  server gives every player a random character from a cast of twelve.
  The "3D table" switch in the header goes back to the flat 2D table.
  While your cards are raised the view holds still. `/cast.html` shows all
  twelve characters side by side.
  three.js is bundled in `public/vendor/`, so nothing is loaded from a CDN.
- A table is created the first time someone opens its link:
  `https://your-host/?room=delivery-team`. Anyone with the link can join,
  vote and edit the story list.
- The first person to sit down is the table's host. By default only the host
  reveals cards, starts rounds, picks the story to vote on and changes the
  deck. The host can switch off "Only I reveal" to let everyone do it, or
  hand the role over by clicking a teammate's card and choosing "Make host".
  If the host leaves, anyone can press "Become host".
- Decks: five built-in ones (the `DECKS` constant at the top of `server.js`); new tables
  start on BT DECK (`DEFAULT_DECK`),
  plus "Custom deck" in the page, where the host types the values for that
  table. Whole numbers, decimals with a dot and `½` count towards the average.
- Reactions: click a teammate's card to send them an emoji that everyone sees
  fly across the table.
- Smoke break: three minutes (`SMOKE_MS`). The cigarette burns down and a
  countdown shows at your seat; it ends by itself, or click again to stop.
- Chat: messages appear in the chat panel and as a speech bubble next to
  whoever said them. Nothing is stored.
- A vote is held on the server and is not sent to other browsers until
  someone reveals.
- Each browser keeps a random key in localStorage, so a reload (or a second
  tab) keeps the same seat. A seat is released 15 seconds after its last tab
  closes.
- Tables live in memory. Story lists, estimates, the chosen deck and the host are also
  written to `DATA_DIR/rooms.json`, so they survive a restart; votes of a
  round in progress do not. Empty tables are dropped after an hour, tables
  with stories after 30 days without use.

## Settings (environment variables)

| Variable    | Default  | Meaning |
|-------------|----------|---------|
| `PORT`      | `3000`   | Port to listen on. |
| `HOST`      | `0.0.0.0`| Address to bind. Use `127.0.0.1` behind a proxy on the same machine. |
| `DATA_DIR`  | `./data` | Folder for `rooms.json`. Set to an empty string to keep everything in memory. |
| `BASE_PATH` | (none)   | Set to e.g. `/poker` when the app is served under a sub-path and the proxy does not strip it. |
| `GRACE_MS`  | `15000`  | How long a seat is kept after its last tab closes. |

## Behind a reverse proxy

The live stream must not be buffered and must be allowed to stay open.

nginx:

```
map $http_upgrade $connection_upgrade { default upgrade; '' ''; }

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;          # WebSocket for 3D head movement
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

Under a sub-path, either strip the prefix in the proxy
(`location /poker/ { proxy_pass http://127.0.0.1:3000/; ... }`) or keep it
and set `BASE_PATH=/poker`. Always link to the path with a trailing slash:
`https://your-host/poker/?room=delivery-team`.

Caddy and Traefik work without extra settings. Serve it over HTTPS (HTTP/2)
if you can: on plain HTTP/1.1 a browser allows only six connections per site,
and each open tab of the app uses one.

## Security notes

- There is no login. The table link is the only key, so use a name that is
  not guessable if that matters, or put the app behind your VPN or the
  proxy's basic auth.
- There is no rate limiting beyond size caps (60 people and 300 stories per
  table, 2000 tables). Add limits in the proxy if the app faces the internet.
- `GET /healthz` answers `ok` for health checks.

## Files

```
server.js            backend
public/index.html    page
public/app.js        browser code (2D table, controls)
public/table3d.js    the 3D table and its characters
public/cast.html     preview of all characters (uses cast.js)
public/style.css     styles
public/vendor/       three.js (MIT license, text included)
public/fonts/        League Gothic and Instrument Sans (SIL Open Font License, texts included)
Dockerfile, docker-compose.yml
```
