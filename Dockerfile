# Pinned on purpose. PreConfig.js calls internal methods of this exact build
# (diffPages, applyPatches, clonePages, EditorUi.init). A newer tag can
# remove them and live editing stops. Read docs/upgrade.md before changing it.
FROM jgraph/drawio:24.7.17

COPY PreConfig.js PostConfig.js entrypoint.sh /config/
COPY libs /config/libs

CMD ["/bin/bash", "/config/entrypoint.sh"]
