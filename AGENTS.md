# Agent guide

This repository is a self-hosted draw.io editor plus a real-time room. It does not store the `.drawio` file. The application that embeds the iframe stores the file, decides who may open it, and mints the room token.

Copy the reference implementations. The byte formats below are the contract. A shorter iframe URL or a different token encoding will load the editor and then fail the room.

Full message list: [docs/contract.md](docs/contract.md). Why the pieces are separate: [docs/why.md](docs/why.md).

## Who owns what

| Piece | Owner |
| --- | --- |
| Editor HTML, `app.min.js`, `/libs` | This host, iframe |
| Live shapes, cursors, presence | This host, `wss://<editor>/rt` |
| `.drawio` file, login, who may open a diagram | The parent application |
| Load and save | `postMessage` between the iframe and the parent |

The parent never opens the room socket. JavaScript inside the iframe does. The browser therefore sends `Origin: <editor origin>`.

## Copy these files

| Need | File |
| --- | --- |
| Iframe URL | `iframeUrl` in `examples/embed/server.mjs` |
| Parent page (`configure`, `init`, `remoteInvoke`) | `examples/embed/public/parent.js` |
| Token | `examples/token/mint.mjs`, `mint.php`, or `mint.py` |
| Nextcloud, where the Draw.io app already builds the iframe | `examples/nextcloud/drawio_collab/` |

Run `./scripts/test.sh` after changing the token or the room server. The known vector must still match.

## Host settings the parent depends on

Set these on the draw.io host before the parent can embed it. Names and meanings are in `.env.example`.

- `DRAWIO_PUBLIC_HOST` is the editor hostname only, no scheme. The parent opens `https://<that host>/`.
- `DRAWIO_ORIGIN` is the editor origin (`https://drawio.example.com`). It is the `Origin` header of the socket. Setting it to the parent application rejects every join.
- `DRAWIO_FRAME_ANCESTORS` lists every parent origin that may embed the iframe, scheme and port included. `http://localhost:3000` and `http://127.0.0.1:3000` are two origins.
- `DRAWIO_RT_SECRET` is the same long random value on the host and in the parent app that mints tokens. `openssl rand -hex 32`. An empty secret, or the placeholder `replace-me`, closes every room.

After an `.env` change, recreate the stack and run `./scripts/check.sh`.

## Iframe URL

Open `https://<DRAWIO_PUBLIC_HOST>/` with every parameter from `iframeUrl` in `examples/embed/server.mjs`. The ones that define the protocol:

| Parameter | Value |
| --- | --- |
| `embed` | `1` |
| `p` | `nxtcld` |
| `proto` | `json` |
| `configure` | `1` |
| `plugins` | `1` |
| `sync` | `manual` |
| `embedRT` | `1` |
| `room` | Stable id for this diagram, one room per file |
| `rt` | HMAC token from the section below |
| `who` | Display name |
| `uid` | Stable user id. Two sockets with the same `uid` share one colour |

`configure=1` means the parent must answer `configure` or the iframe stays blank. `p=nxtcld` is draw.io's Nextcloud embed plugin and is the load/save protocol for every parent, including an app that is not Nextcloud.

Optional libraries: `clibs=Uhttps://<editor>/libs/File.xml`, several joined by `;`. See [docs/libraries.md](docs/libraries.md). The example parent omits `clibs`.

The example room id is `d-` plus 1–80 characters from `[A-Za-z0-9_-]`. Use one stable id per diagram for the life of that file. Nextcloud uses `d-<file id>`.

## Token

Mint it on the server, after the parent app has decided this user may open this file. The room server checks the signature, the room, and the expiry. It does not call the parent app.

HMAC-SHA256 over a base64url JSON body, no padding. Secret is `DRAWIO_RT_SECRET`. Key order is `r`, `u`, `e`, then `n` only when the display name is non-empty.

```json
{"r":"d-1","u":"9","e":4102444800}
```

```text
body = base64url(utf8(json))
token = body + "." + hex(hmac_sha256(secret, body))
```

Known vector, secret `test-secret-for-rt`, room `d-1`, user `9`, expiry `4102444800`, no name:

```text
eyJyIjoiZC0xIiwidSI6IjkiLCJlIjo0MTAyNDQ0ODAwfQ.d12a76594d6a3be8a103f7cfc0619b96fcf32adcbc38ced512b7ea97db6d4991
```

`e` is a unix expiry in seconds. The example uses 8 hours. Anyone who can read the iframe URL can use the token until then. Keep the secret out of browser JavaScript, diagrams, and git.

An empty secret returns an empty token. The room rejects it. If minting fails, still open the editor without `room` and `rt`. Saving keeps working. Live cursors stay off. That is what `examples/nextcloud/drawio_collab/js/inject.js` does.

The name other clients display is `n` inside the token. The `who` query parameter is only a label on the URL.

## postMessage

Accept messages only from the editor origin. Bodies are JSON strings. The editor spells the remote-invoke field `funtionName`. Keep that spelling.

Reply with `iframe.contentWindow.postMessage(JSON.stringify(payload), editorOrigin)`.

Order:

1. Editor sends `{ "event": "configure" }`.
2. Parent replies `{ "action": "configure", "config": { "autosave": 1, "enableAi": false } }`. The example also sets cursor sharing and `compressXml`. Copy `onEditorMessage` in `examples/embed/public/parent.js`.
3. Editor sends `{ "event": "init" }`.
4. Parent replies `{ "action": "load", "xml": "<mxfile…>", "title": "Name.drawio", "autosave": true, "desc": { …file info… } }`, then `{ "action": "remoteInvokeReady" }`.
5. Editor sends `{ "event": "remoteInvoke", "funtionName": "...", "functionArgs": [...], "msgMarkers": ... }`.
6. Parent replies `{ "action": "remoteInvokeResponse", "msgMarkers": <same>, "resp": [ ... ] }`. Errors use `error.errResp` and omit `resp`.

`xml` in `load` and in file info is the diagram text. Decode base64 before `load` when the parent app's own storage used it. File info uses the field name `writeable`.

A successful `saveFile` returns one object: `{ "etag", "size", "mtime", "success": true }`. The async reply wraps that object in the `resp` array. Implement `getFileInfo`, `loadFile`, and `saveFile`. The example also implements `getCurrentUser`, and answers `getFileRevisions` with an empty list.

While the room is connected, save with last-write-wins. A strict etag rejection raises "modified by another user" for a canvas the room has already merged. The room is the live merge. The save is the stored copy.

The shim sends two extra events to the parent. Listen for them. Leave the names as they are in `PreConfig.js`.

- `drawioPeers` — `{ "event": "drawioPeers", "peers": [{ "sid", "name", "color" }] }`
- `drawioRt` — connection state, for debugging

## Room behaviour the parent must expect

The parent does not speak these frames. The shim does. Know the consequences:

- `diff` updates other open clients and is not stored.
- `xml` replaces the in-memory snapshot and is applied on peers.
- `snapshot` replaces the snapshot and is not painted onto a diagram that is already open. A late joiner receives that snapshot once, as `xml`, before their canvas is live.
- The snapshot lives in memory on the editor host and is dropped 30 minutes after the last client leaves. The file in the parent app is the durable copy.
- 32 clients per room unless `DRAWIO_RT_MAX_CLIENTS` says otherwise. The next client is closed with `1013`. Messages are limited to 8 MB.

## Leave these alone

- Keep the base image on the tag named in the `Dockerfile` until the two-browser test in [docs/upgrade.md](docs/upgrade.md) has passed. The Node tests do not load `app.min.js`.
- Leave `sync=manual` on the iframe URL. Leave the public diagrams.net channel unused.
- Leave `app.min.js` unchanged. Collaboration is `PreConfig.js` and `PostConfig.js`.
- Keep `/rt`, `/cache`, and the editor on one hostname.
- Keep `GET /cache?alive=1` public and answering `1`. The editor waits on it during startup.
- Keep `script-src` able to use `'unsafe-eval'`. The editor does not start without it.
- Send diagram XML through `postMessage` for save, and through the room for live shapes. A second websocket in the parent app becomes a second merge.

## Done when

1. The parent origin is listed in `DRAWIO_FRAME_ANCESTORS`, and `./scripts/check.sh` shows it.
2. Two browsers, two users, one room: a shape drawn in one appears in the other, and a click shows a coloured outline with the first name.
3. The saved `.drawio` file is in the parent app. Restarting the editor host does not delete it.
4. The token matches the known vector in `examples/token/`.
5. A missing secret still opens the editor and still saves. The room stays disconnected.
