# Self-hosted draw.io with collaborative editing

Self-hosted [draw.io](https://www.drawio.com/) (diagrams.net) with real-time collaborative editing on a server you run. Several people work on one diagram at the same time: shapes sync, each person keeps their own page, a click shows a coloured outline and a first name.

The drawing file stays in your application or in Nextcloud. This repository is only the editor host: the official `jgraph/drawio` image, a configuration shim, and a small WebSocket room. It does not use `embed.diagrams.net`, Cloudflare, or Pusher for live editing.

The Nextcloud Draw.io app documents that a self-hosted draw.io cannot collaborate in real time. That is true of the image alone. This host adds the room, and it uses the same Nextcloud embed plugin (`p=nxtcld`) Nextcloud already speaks, so the files stay in Nextcloud.

Deutsch, mit derselben Anleitung: [ANLEITUNG.md](ANLEITUNG.md).

## Try it on your laptop in five minutes

No DNS name, no certificate, and ports 80 and 443 stay untouched. You need Docker Compose v2 and Node 20 or newer.

```bash
git clone <your-fork-url> draw.io-collaborative
cd draw.io-collaborative
cp .env.example .env
```

Put four values in `.env`. The secret can be anything long while you are only trying it out.

```bash
DRAWIO_PUBLIC_HOST=localhost:8080
DRAWIO_ORIGIN=http://localhost:8080
DRAWIO_SCHEME=http
DRAWIO_FRAME_ANCESTORS=http://localhost:3000 http://127.0.0.1:3000
DRAWIO_RT_SECRET=$(openssl rand -hex 32)
```

Start the editor and the room:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Start the page that embeds it, in a second terminal:

```bash
cd examples/embed
set -a && source ../../.env && set +a
DRAWIO_EMBED_URL=http://localhost:8080 node server.mjs
```

Open <http://localhost:3000> in two windows. Different first name in each, room `demo`, **Open editor**.

Draw a rectangle in one window. It appears in the other. Click it and the other window shows a coloured outline with the first name. The status line lists both people.

![The editor running on localhost with a shape and a remote cursor label](docs/images/local-example.png)

The saved file is `examples/embed/data/d-demo.drawio`. Stop everything with `docker compose -f docker-compose.local.yml down`.

`docker compose up` without `-f docker-compose.local.yml` is the server path below. It wants ports 80 and 443 and a real hostname.

## What you need for a server

- A Linux server or a Mac with Docker and Docker Compose v2
- A DNS name pointing **directly** at that machine, for example `drawio.example.com`
- Ports **80** and **443** free for this stack
- An email address for the certificate notice
- A second site that will embed the editor (Nextcloud, or the example above)

If those ports are already taken by Dokploy or another proxy, do not start `docker-compose.yml`. Use [Dokploy](#dokploy) instead. Running both will fight over 80 and 443.

You do not need a draw.io checkout, a Node install on the server, or a database for the editor. Node on your laptop is only for the tests and the example.

## Configure

```bash
git clone <your-fork-url> draw.io-collaborative
cd draw.io-collaborative
cp .env.example .env
openssl rand -hex 32
```

Put the hex string into `DRAWIO_RT_SECRET`. Then edit `.env` so the four hosts agree. With Nextcloud at `https://cloud.example.com` and the editor at `drawio.example.com`:

```bash
DRAWIO_PUBLIC_HOST=drawio.example.com
DRAWIO_ORIGIN=https://drawio.example.com
DRAWIO_FRAME_ANCESTORS=https://cloud.example.com http://localhost:3000
DRAWIO_RT_SECRET=<the hex string>
ACME_EMAIL=you@example.com
```

`DRAWIO_PUBLIC_HOST` is a hostname. No `https://`.

`DRAWIO_ORIGIN` is the editor again, with `https://`. The browser opens the WebSocket from **inside the iframe**, so the Origin header is the editor, not Nextcloud. If you set this to the Nextcloud URL, the editor loads and the room rejects every connection.

`DRAWIO_FRAME_ANCESTORS` is who may embed the iframe. Copy the origin from the browser address bar, including `https://` and any port. `http://localhost:3000` and `http://127.0.0.1:3000` are not the same origin. List both if you will open both.

`DRAWIO_SCHEME` stays `https` on a server. It is only `http` for the laptop path.

## Start

```bash
docker compose up -d --build
```

The first start downloads `jgraph/drawio:24.7.17` and asks Let's Encrypt for a certificate. If DNS was only just pointed here, the certificate can fail once and succeed on the next try:

```bash
docker compose logs caddy
docker compose restart caddy
```

Wait until `./scripts/check.sh` prints `OK`.

```bash
./scripts/check.sh
```

That script checks four things, in order:

1. `PreConfig.js` contains `wss://<your host>/rt`, the placeholder host is gone, and the file does not mention Pusher or `app.diagrams.net`.
2. `https://<host>/cache?alive=1` returns `1`. The editor waits on this during startup. A timeout here looks like a frozen editor.
3. `app.min.js` is sent gzip-compressed. Uncompressed it is about 9 MB.
4. The HTML response includes `frame-ancestors` for every origin in `.env`.

After any `.env` change:

```bash
docker compose up -d --force-recreate
./scripts/check.sh
```

Changing `PreConfig.js` or `realtime/server.mjs` needs `--build` as well.

## Point the example at the server

The same example page works against a deployed host. Use the secret from the server's `.env`:

```bash
cd examples/embed
DRAWIO_EMBED_URL=https://drawio.example.com \
DRAWIO_RT_SECRET='<the same secret>' \
node server.mjs
```

`DRAWIO_FRAME_ANCESTORS` on the server has to list `http://localhost:3000` and `http://127.0.0.1:3000` for this.

The saved file is `examples/embed/data/d-demo.drawio`. The live copy sits in memory on the editor host and is dropped 30 minutes after the last window closes.

The example has no accounts and binds to `127.0.0.1`. Do not expose port 3000.

## When it does not work

| What you see | Cause | Fix |
| --- | --- | --- |
| `Framing … violates … frame-ancestors` | The parent origin is not allowed | Put the exact origin in `DRAWIO_FRAME_ANCESTORS`, then recreate the stack |
| `PreConfig.js still contains the placeholder host` | `DRAWIO_PUBLIC_HOST` is still `drawio.example.com` | Set your own hostname in `.env` |
| `ports are not available: … 443` | Another proxy already has the port | Use `docker-compose.local.yml` on a laptop, or [Dokploy](#dokploy) on a server |
| Editor loads, shapes never move | The socket never joined the room | Network tab for `/rt`, then `docker compose logs realtime` |
| `reject /rt origin=-` | Empty Origin, closed on purpose | Leave the check in place; the browser must send the editor origin |
| `reject /rt origin=https://cloud…` | `DRAWIO_ORIGIN` is the parent site | Set it to the editor origin |
| `DRAWIO_RT_SECRET is empty` in the log | Secret missing or still `replace-me` | Same secret in both places, then recreate |
| Editor hangs on a grey screen | `/cache?alive=1` does not answer | `/cache` must reach the room server on the editor hostname |
| `content-encoding` is not gzip | Old Tomcat process | Recreate the `drawio` container. `curl -I` skips compression, so check with GET |

A `KeystoreFile` warning from `/docker-entrypoint.sh` comes from the official image and does not stop the start.

The official image prints the whole generated `PreConfig.js` to the log on every start, including `urlParams['sync'] = 'manual'`. That is the file `entrypoint.sh` replaces a moment later. Check what the browser actually gets:

```bash
curl -sS https://drawio.example.com/js/PreConfig.js | grep -E 'RT_WEBSOCKET_URL|applyPatches'
```

## Nextcloud

1. Install and enable the **Draw.io** app in Nextcloud (the app is also published as `drawio`).
2. In **Admin settings → Draw.io**, set the draw.io URL to `https://drawio.example.com` with no path and no query string. Enable autosave. Save.
3. On this host, `DRAWIO_FRAME_ANCESTORS` includes `https://<your-nextcloud-origin>`. Recreate the stack. `./scripts/check.sh` must print that origin inside `frame-ancestors`.
4. Copy the companion app and enable it inside the Nextcloud container (the path is `custom_apps` or `apps`, whichever your install uses):

```bash
docker cp examples/nextcloud/drawio_collab nextcloud:/var/www/html/custom_apps/drawio_collab
docker exec -u www-data nextcloud php occ app:enable drawio_collab
docker exec -u www-data nextcloud php occ config:app:set drawio_collab rt_secret --value='<the same secret>'
```

Replace `nextcloud` with the Nextcloud container name (`docker ps`).

5. Hard-reload Nextcloud. Open one `.drawio` file as two users (two browsers, two accounts).

You should see the editor load from your hostname, not from `embed.diagrams.net`. A shape drawn by one user appears for the other. In the browser network log the iframe URL contains `p=nxtcld`, `room=d-<file id>`, and `rt=`.

If the token app is missing or the secret is empty, the editor still opens and Nextcloud still saves the file. Live cursors stay off. That is deliberate: a broken token must not take the editor down. The request to look for is `GET /apps/drawio_collab/token?fileId=…`. Status 503 means the secret was not set. Status 401 means the viewer is not logged in (public share links are not given a room).

Nextcloud's Draw.io app returns a conflict when the file etag changed between two saves. Two people with autosave on can see "The file you are working on was updated in the meantime." The canvas is still shared through this host. Reload to pick up the new etag. Do not switch the draw.io URL back to `https://embed.diagrams.net` to clear that dialog.

Details: [examples/nextcloud/README.md](examples/nextcloud/README.md).

## Your own application

Mint a token with the same algorithm (`examples/token/` has Node, PHP, and Python, and a shared test vector). Build the iframe URL the way `examples/embed/server.mjs` does. Answer `configure`, `init`, and `remoteInvoke` the way `examples/embed/public/parent.js` does.

The parent is where `getFileInfo` and `saveFile` run. Any framework can be that parent: the editor only speaks `postMessage`. This repository deliberately ships no storage backend, so nothing here assumes a database, a disk layout, or a user model.

The message list, the token bytes, and the room limits are in [docs/contract.md](docs/contract.md).

## Dokploy

Use this when Dokploy already owns ports 80 and 443.

1. Push this repository to the Git host Dokploy can clone.
2. Create a Compose service. Compose path: `docker-compose.dokploy.yml`. Type: **Docker Compose**, not Stack.
3. Paste the keys from `.env.example` into the Environment tab. Same rules as above. `DRAWIO_RT_SECRET` matches the app that mints tokens.
4. Leave autodeploy off, or watch only this repository.
5. Deploy, then run `./scripts/check.sh` from a machine that can reach the hostname.

Do not use a **raw** deploy. Raw deploy deletes the cloned directory and writes a compose file with no `PreConfig.js`, so the image builds as ordinary draw.io and collaboration is gone.

Traefik router names in that file are `drawio-collab` and `drawio-collab-rt`. If this Dokploy server already has routers with those names, rename them in the compose file before the first deploy. A clash fails the deploy.

`/rt` and `/cache` are a separate router with a higher priority so they hit the room server and not Tomcat. They stay on the same hostname as the editor. Moving them to another hostname makes the editor's Content-Security-Policy drop the socket.

## PlantUML and image export

The editor works without these. To enable PlantUML and the image export item in the editor menu:

```bash
docker compose -f docker-compose.yml -f docker-compose.export.yml up -d --build
```

They run when someone exports. They are not where the `.drawio` file is stored.

## Symbol libraries

`libs/` is empty. Mount your own library XML. See [docs/libraries.md](docs/libraries.md).

## Do not change these

The reasons are in [docs/why.md](docs/why.md). Short version:

- Leave the base image on `jgraph/drawio:24.7.17` until you have done the two-browser test in [docs/upgrade.md](docs/upgrade.md). The Node tests do not load `app.min.js`.
- Do not remove `sync=manual`, and do not point `/rt` at diagrams.net. The public channel returns 403 for this origin, and the patches are encrypted with a key that never leaves `app.min.js`.
- Do not edit `app.min.js`.
- `entrypoint.sh` must run the official entrypoint and then overwrite `PreConfig.js`. The official entrypoint rewrites that file on every start.
- `/rt`, `/cache`, and the editor stay on one hostname.
- `DRAWIO_ORIGIN` is the editor. `DRAWIO_FRAME_ANCESTORS` is the parent. They are not interchangeable.
- An empty `DRAWIO_RT_SECRET` closes every room. Do not remove the check.
- `/cache?alive=1` stays public and returns `1`.
- A snapshot is for someone who joins late. It is not replayed onto a canvas that is already open.
- Do not send the diagram XML through your app's websocket. `postMessage` saves the file. The room moves the live shapes.
- Do not tighten `script-src` by removing `'unsafe-eval'`. draw.io does not start without it.
- `drawioPeers` and `drawioRt` are the event names the parent listens for. Renaming them in `PreConfig.js` disconnects the example and any other parent.

## Tests

```bash
./scripts/test.sh
```

That runs the room-server tests, the token vector (Node, and PHP and Python when they are installed), and the example parent API.

## Layout

| Path | Role |
| --- | --- |
| `Dockerfile`, `entrypoint.sh`, `PreConfig.js`, `PostConfig.js` | Official image plus the collaboration shim |
| `realtime/` | Room server. Memory only. MIT. |
| `Caddyfile`, `docker-compose.yml` | Server: hostname, TLS, `/rt` and `/cache` on that hostname |
| `Caddyfile.local`, `docker-compose.local.yml` | Laptop: HTTP on port 8080, no certificate |
| `docker-compose.dokploy.yml` | Same stack behind Dokploy's Traefik |
| `examples/embed/` | Parent page you can open twice |
| `examples/nextcloud/drawio_collab/` | Nextcloud app that adds `room` and `rt` |
| `examples/token/` | Token in Node, PHP, and Python |
| `docs/contract.md` | URL, token, messages |
| `docs/why.md` | Why the pieces are separate |

## Publishing

Suggested GitHub description:

> Self-hosted draw.io with real-time collaborative editing. Live cursors and page sync on your own server. Files stay in your app or Nextcloud. No Cloudflare, no Pusher, no embed.diagrams.net.

Suggested topics: `drawio`, `diagrams-net`, `self-hosted`, `collaboration`, `realtime`, `websocket`, `nextcloud`, `dokploy`.

The npm package in `realtime/package.json` is `"private": true` so it is not published to the npm registry by mistake. The public artifact is this repository.

## How this stays within the draw.io rules

- The editor is the official image `jgraph/drawio`, pulled from Docker Hub and started with its own entrypoint. No fork, no rebuild of the app, no patched `app.min.js`.
- Configuration is only what draw.io itself provides for it: `PreConfig.js` and `PostConfig.js` in the webapp, the documented `DRAWIO_*` environment variables, URL parameters, and the embed protocol with `proto=json`.
- Collaboration uses draw.io's own page functions (`diffPages`, `applyPatches`) through that configuration. The diagram format is unchanged, so a file written here opens in any draw.io.
- The hosted diagrams.net services stay out. `sync=manual` remains, the public realtime channel is not called, and no attempt is made to decrypt or impersonate it.
- The Apache-2.0 base image keeps its license and notices. The files in this repository are MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
- draw.io and diagrams.net are trademarks of their owners. This project is not affiliated with or endorsed by them, and it does not redistribute their trademarks or their hosted service.
- No symbol libraries are shipped. `libs/` is empty so nobody republishes drawings they do not own.
