# Two-browser example

This page is a parent for the draw.io Nextcloud plugin (`p=nxtcld`). It loads one diagram, saves it when the editor asks, and lets the draw.io host sync shapes between windows.

It has no login. It listens on `127.0.0.1` only. Do not put it on a public port.

The draw.io host must already be running, and `DRAWIO_FRAME_ANCESTORS` must contain `http://localhost:3000`.

On a laptop, start the host first (port 8080, no certificate):

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Then, from `examples/embed`, with the same secret as `.env`:

```bash
cd examples/embed
set -a && source ../../.env && set +a
DRAWIO_EMBED_URL=http://localhost:8080 node server.mjs
```

Open <http://localhost:3000> in two windows. Use a different first name in each. Leave the room as `demo`. Draw a shape in one window.

What you should see in the other window:

- the shape appears
- a coloured outline with the first name when the other person clicks
- the line "In this room" lists both names

Full steps and the failure list: [ANLEITUNG.md](../../ANLEITUNG.md) and [README.md](../../README.md).

The file is written to `examples/embed/data/d-demo.drawio`. The live copy in the room is memory on the draw.io host and disappears 30 minutes after the last window closes. The file in `data/` is the saved copy.
