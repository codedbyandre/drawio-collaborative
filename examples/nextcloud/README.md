# Nextcloud

Nextcloud's Draw.io app already embeds the editor with `p=nxtcld`. That plugin is how the editor loads and saves the `.drawio` file that lives in Nextcloud. The official app documents that a self-hosted draw.io server has no real-time collaboration. This host is that missing room.

Two settings have to match:

| Where | What |
| --- | --- |
| Nextcloud, Admin settings, Draw.io, draw.io URL | `https://drawio.example.com` (your editor, no path) |
| This host, `DRAWIO_FRAME_ANCESTORS` | `https://cloud.example.com` (your Nextcloud origin) |
| Both sides | the same `DRAWIO_RT_SECRET` |

Copy `drawio_collab/` into Nextcloud's `custom_apps/` (or `apps/`) and enable it. The app reads the file id from the Draw.io iframe, checks that the logged-in user can read that file, signs a room token, and appends `room`, `rt`, `who`, and `uid` to the iframe URL. If signing fails, the editor still opens and saves. Live cursors stay off until the token works.

Public share links are not covered. A guest has no logged-in user, so the token request is refused and the editor opens without the room.

Step by step: [ANLEITUNG.md](../../ANLEITUNG.md#4-nextcloud) and [README.md](../../README.md#nextcloud).

The Nextcloud app rejects a save when the file etag changed under it. Two people autosaving can produce "The file you are working on was updated in the meantime." The shapes are still synced through this host. That dialog is the Nextcloud app's file check. Do not point the draw.io URL back at `https://embed.diagrams.net` to clear it. That sends the session to the public service.
