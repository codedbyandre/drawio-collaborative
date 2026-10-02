# Embed contract

The draw.io host serves the editor and a room. It does not store the `.drawio` file. The page that embeds the iframe stores the file and answers the Nextcloud plugin.

## Iframe URL

Open `https://<DRAWIO_PUBLIC_HOST>/` with these query parameters:

| Parameter | Value | Why |
| --- | --- | --- |
| `embed` | `1` | The editor talks to the parent instead of offering its own file dialogs. |
| `p` | `nxtcld` | Loads draw.io's Nextcloud embed plugin. That plugin is the save/load protocol. Nextcloud already sends this. A custom parent sends it too, so one editor build serves both. |
| `proto` | `json` | `postMessage` bodies are JSON strings. |
| `configure` | `1` | The editor waits for a `configure` reply before it boots. If the parent ignores it, the iframe stays blank. |
| `sync` | `manual` | Keeps the public diagrams.net channel off. The official image also forces this. Leave it. |
| `embedRT` | `1` | Tells the editor that collaboration exists. The shim then uses the local socket, because `sync=manual` blocked the hosted one. |
| `plugins` | `1` | Required for `p=nxtcld` to load. |
| `room` | `d-<id>` | Room name. The same diagram always uses the same room. |
| `rt` | HMAC token | See below. Without it the socket is closed. |
| `who` | first name | Label on the cursor. The token's `n` field is what other clients actually display. |
| `uid` | stable user id | Identity inside the room. Two sockets with the same `uid` share one colour. |
| `clibs` | optional | `Uhttps://<host>/libs/File.xml`, joined by `;`. |

`examples/embed/server.mjs` builds this URL. Copy that function rather than inventing a shorter one.

## Token

HMAC-SHA256 over a base64url JSON body (no padding). The secret is `DRAWIO_RT_SECRET`.

```json
{"r":"d-1","u":"9","e":4102444800}
```

`r` is the room, `u` is the user id, `e` is a unix expiry in seconds. Optional `n` is the display name, added only when it is non-empty, and the key order stays `r`, `u`, `e`, `n`.

```text
body = base64url(utf8(json))
token = body + "." + hex(hmac_sha256(secret, body))
```

The known vector, secret `test-secret-for-rt`, room `d-1`, user `9`, expiry `4102444800`:

```text
eyJyIjoiZC0xIiwidSI6IjkiLCJlIjo0MTAyNDQ0ODAwfQ.d12a76594d6a3be8a103f7cfc0619b96fcf32adcbc38ced512b7ea97db6d4991
```

Implementations: `examples/token/mint.mjs`, `mint.php`, `mint.py`. An empty secret returns an empty token, and the room server rejects the join.

The room server checks the signature, the room, the expiry, and the `Origin` header itself. It does not call your app. Mint the token only after your app has decided this user may open this file.

## Origin header

The socket is opened by JavaScript inside the iframe. The browser sends `Origin: https://<editor-host>`. `DRAWIO_ORIGIN` must include that origin. Setting it to your Nextcloud origin rejects every join.

An empty `Origin` is rejected. `/health` and `GET /cache?alive=1` stay open so probes and the editor startup check work.

## postMessage

The parent only accepts messages whose `origin` is the editor origin. Bodies are JSON strings. The editor spells the remote-invoke field `funtionName`.

Order:

1. Editor sends `{ "event": "configure" }`.
2. Parent replies `{ "action": "configure", "config": { "autosave": 1, "enableAi": false } }`.
3. Editor sends `{ "event": "init" }`.
4. Parent replies `{ "action": "load", "xml": "<mxfile…>", "title": "Name.drawio", "autosave": true, "desc": { …file info… } }` and then `{ "action": "remoteInvokeReady" }`.
5. Editor calls `remoteInvoke`. Parent replies `remoteInvokeResponse` with the same `msgMarkers`.

Async replies use `resp` as the argument list. A successful `saveFile` is `resp: [{ "etag", "size", "mtime", "success": true }]`. Errors use `error.errResp`.

File info uses the field name `writeable` (the spelling the Nextcloud plugin already uses). `xml` in that object is the diagram text, not base64. Base64 is only useful on a transport that cannot carry the raw XML. Decode it before the `load` message.

`examples/embed/public/parent.js` is the reference parent.

## Room messages

JSON text frames on `wss://<editor>/rt?id=<room>&rt=<token>`.

| type | Who receives it | Stored |
| --- | --- | --- |
| `diff` | Other clients in the room | No. Last `applyPatches` on a cell wins. |
| `xml` | Other clients | Replaces the in-memory snapshot and is applied on peers. |
| `snapshot` | Nobody else | Replaces the snapshot. Late joiners receive it as `xml`. It is not painted onto a diagram that is already open. |
| `cursor`, `selection` | Other clients | No. |
| `presence` | Everyone in the room | No. The shim forwards it to the parent as `{ "event": "drawioPeers", "peers": [...] }`. |
| `sync-request` | The sender, if a snapshot exists | Asks for the current snapshot. |

Limits: 32 clients per room unless `DRAWIO_RT_MAX_CLIENTS` says otherwise (the next client is closed with `1013`), messages up to 8 MB, snapshot kept 30 minutes after the last disconnect.

`drawioPeers` and `drawioRt` are the two events the shim sends to the parent window. `drawioPeers` is the roster. `drawioRt` is connection state, useful while debugging. Renaming them in `PreConfig.js` breaks every parent that listens, including the example.

## What the host will not do

- Store the file.
- Merge two autosaves. Your app decides. The example and a typical app use last-write-wins so the editor does not raise "modified by another user" for a canvas the room has already merged.
- Broadcast the XML through your app's own websocket or push channel. That path is a second merge and it fights the room.
