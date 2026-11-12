# Planning Poker (self-hosted)

Open a table, send the link to your team, vote face down, reveal together.
No accounts, no database, no npm dependencies, no requests to outside services.

## Run it

Needs Node 18 or newer.

```
node server.js
```

Then open http://localhost:3000, give the table a name (or leave it empty) and
share the address of the page. Everyone who opens that link gets a seat.

With Docker:

```
docker compose up -d --build
```

## How it works

- `server.js` is the whole backend: plain Node `http`, no packages to install.
- Live updates use server-sent events (one long-lived GET per browser tab);
  actions are small JSON POSTs. Both are ordinary HTTP, so no WebSocket
  upgrade rules are needed on a proxy.
- A table is created the first time someone opens its link:
  `https://your-host/?room=delivery-team`. Anyone with the link can join,
  vote, reveal, start rounds and edit the story list.
- A vote is held on the server and is not sent to other browsers until
  someone reveals.
- Each browser keeps a random key in localStorage, so a reload (or a second
  tab) keeps the same seat. A seat is released 15 seconds after its last tab
  closes.
- Tables live in memory. Story lists, estimates and the chosen deck are also
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
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
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
public/app.js        browser code
public/style.css     styles
public/fonts/        League Gothic and Instrument Sans (SIL Open Font License, texts included)
Dockerfile, docker-compose.yml
```
