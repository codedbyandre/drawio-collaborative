# Symbol libraries

`libs/` in this repository is empty on purpose. The files that some deployments keep there are domain drawings (switchgear symbols and similar), not part of the editor. Publish only libraries you have the rights to publish.

A library is an uncompressed draw.io library XML. In the editor: **File → New Library**, add shapes, **Export**. Put the file in `libs/` on the server (or set `DRAWIO_LIBS_DIR` to that directory). The container copies it to `/libs/` when it starts. Recreate the `drawio` container after adding a file. A running container does not notice a new file until that copy step runs.

Reference it from the parent as a `clibs` URL parameter. The `U` prefix means the file is not compressed:

```text
clibs=Uhttps://drawio.example.com/libs/MyLibrary.xml
```

Several libraries are separated by `;`.

Do not load libraries from `raw.githubusercontent.com` or another third-party host at edit time. The editor CSP allows connections to its own origin. A remote library URL is also a dependency you do not control.

The example parent does not set `clibs`. Add the parameter in `iframeUrl` in `examples/embed/server.mjs` when you want the demo to show a library.
