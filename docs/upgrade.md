# Upgrading draw.io

`Dockerfile` starts from `jgraph/drawio:24.7.17`. Stay on that tag until you have watched two browsers edit one diagram on the new tag.

`PreConfig.js` is not a supported plugin API. It waits until `EditorUi` or `App` exists, wraps `init`, and then calls methods that live inside that build:

- `diffPages`
- `applyPatches`
- `clonePages`
- `getPagesForXml`
- `getXmlForPages`
- `graph.highlightCell`
- `mxscript`

The Node tests do not load `app.min.js`. They cannot tell you that a new image still syncs shapes. A green `npm test` only means the room server still routes messages.

## What a careful upgrade looks like

1. Change the tag in `Dockerfile`.
2. Build on a hostname that is not the one people are using.
3. Open one diagram in two browsers.
4. Move a shape. It appears on the other side, and each person stays on their own page.
5. Click a shape. The other browser shows a coloured outline and the first name.
6. Reload one browser. It receives the drawing the other browser still has open.
7. Confirm `./scripts/check.sh` still passes, including gzip on `app.min.js`.

If shapes do not move, the new build dropped or renamed one of those methods. Revert the tag. Do not patch `app.min.js`. The license allows you to ship the official image with this configuration in front of it. A private patch of the minified bundle is a fork you would have to rebase on every release, and this project is not that.

The official image entrypoint rewrites `PreConfig.js` on every start and sets `sync=manual`. `entrypoint.sh` has to keep running that entrypoint and then copy this repository's file over the result. An upgrade that changes the entrypoint path or the webapp directory (`/usr/local/tomcat/webapps/draw`) needs the same check.
