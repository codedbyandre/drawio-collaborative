# Why it is built this way

The public diagrams.net editor can collaborate. That path is not in the Docker image you can run yourself. The image has no `/rt` servlet. The hosted channel speaks to Cloudflare, a patch cache, and Pusher, with a key baked into `app.min.js`. Patches are AES-encrypted inside a closure in that file. A request from any other origin gets **403** from that socket. Pointing your own hostname at it, or rewriting the `Origin` header so it is accepted, sends the live diagram off your network.

So this repository does not turn that channel on. It keeps `sync=manual`, which the official entrypoint writes on every start, and adds a room you run yourself.

## Three separate paths

```text
Browser on your app or Nextcloud
  │
  ├─ iframe          editor HTML, app.min.js, /libs     this host
  ├─ postMessage     getFileInfo / saveFile             your app stores the file
  └─ wss://…/rt      page diffs, cursors, presence      this host, memory only
```

The file never moves onto the editor host. Rebuilding or replacing the editor cannot delete diagrams. Live bytes are not written through the app's own broadcast bus: that bus would become a second, slower merge, and a re-render of the page would reload the iframe and kick everyone out.

## Why `p=nxtcld`

draw.io ships an embed plugin named `nxtcld`. Nextcloud's Draw.io app already opens the editor with `p=nxtcld` and `proto=json`. The plugin asks the parent window to load and save. This host uses that same plugin for every parent, including a custom app, so there is one editor image and one protocol.

Nextcloud's own documentation says real-time collaboration needs `https://embed.diagrams.net` and does not work on a self-hosted draw.io. Their app can still save. It does not pass `room` or `rt`, because it expects the public channel. `examples/nextcloud/drawio_collab` adds those two parameters after Nextcloud has built the iframe URL. The plugin, the file, and the Nextcloud UI stay theirs.

## Why the shim is outside `app.min.js`

`PreConfig.js` runs in the browser before the editor boots. `PostConfig.js` runs after. The official entrypoint deletes and rewrites `PreConfig.js` on every container start, including `sync=manual`. `entrypoint.sh` lets that finish, then copies the configured files back and replaces the placeholder host. If you bind-mount a different `PreConfig.js` over the image and skip the entrypoint, the official file comes back at the next start and the room never connects.

`PostConfig.js` sets `Editor.enableRealtimeCache = false`. The official cache would POST AES blobs to `/cache`. Nobody outside diagrams.net can decrypt them. The local `/cache` reads those POSTs and throws them away. `GET /cache?alive=1` returns `1` because the editor blocks startup until that probe answers.

A Pusher script tag is dropped. `window.Pusher` is a stand-in that reports `connected` immediately, so the editor does not wait on `js.pusher.com`.

## Why diffs, not the whole file, and why a late joiner is special

On each local change the shim calls draw.io's own `diffPages` and sends that object. Peers call `applyPatches` and stay on the page they are looking at. Sending the whole XML on every nudge is the fallback, used only when a diff cannot be built.

A full snapshot is kept in the room for someone who opens the file later. It is delivered once, before their canvas is live. It is not applied again onto a diagram that is already open. Applying it there jumps the page and fights the person who is drawing. That behaviour is intentional. Do not "fix" it by painting every `xml` message onto the current canvas.

## Why the token is checked on the room server

The room server and the app that stores the file do not share a database. They share `DRAWIO_RT_SECRET`. The app signs `room + user + expiry + name`. The room server checks the signature and does not call the app. An empty secret signs nothing, and every join is rejected. That is the safe failure. A room with no check would let anyone who can guess `d-<id>` read and write the live diagram.

The `Origin` on the socket is the editor's origin, because the socket is created inside the iframe. `DRAWIO_FRAME_ANCESTORS` is a different list: the sites allowed to embed that iframe. Mixing those two up looks like a successful deploy with a dead socket.

## Why compression and caching are in the entrypoint

`app.min.js` is about 9 MB. Tomcat's `useSendfile` skips the gzip filter, so browsers download the raw file. The entrypoint turns compression on and caches static files for a day. The HTML is stamped with `?v=<time>` on `PreConfig.js` because a cached shim from the previous deploy would ignore the new one. After an `.env` change, recreate the container. Restart is not always enough if the old process is still the one serving.

## Why the image tag is pinned

The shim calls internal methods of draw.io 24.7.17. Those names are not a public API. A newer image can boot, pass every Node test, and silently stop syncing shapes. [upgrade.md](upgrade.md) is the only supported way to move the tag.

## Rejected alternatives

| Idea | Why it is not in this repo |
| --- | --- |
| iframe `https://embed.diagrams.net` | The live diagram leaves your network. |
| Proxy that rewrites `Origin` to their host | Their socket accepts it, and the bytes still leave. |
| Broadcast the XML through the app on every save | Slow, and it reloads or fights the iframe. |
| Official image with environment variables only | Nothing in the image turns on a local room. Their channel is not in the image. |
| Patch `app.min.js` | Breaks on every upstream release. Configuration in front of the image is enough. |
