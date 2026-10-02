#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

node --check PreConfig.js
node --check PostConfig.js
node --check realtime/server.mjs
node --check examples/embed/server.mjs
node --check examples/embed/public/parent.js
node --check examples/token/mint.mjs
node --check examples/nextcloud/drawio_collab/js/inject.js
node --test examples/token/mint.test.mjs examples/embed/server.test.mjs

if command -v php >/dev/null 2>&1; then
    php -l examples/token/mint.php
    php -l examples/nextcloud/drawio_collab/appinfo/routes.php
    php -l examples/nextcloud/drawio_collab/lib/AppInfo/Application.php
    php -l examples/nextcloud/drawio_collab/lib/Controller/TokenController.php
    php examples/token/mint.php --vector
fi

if command -v python3 >/dev/null 2>&1; then
    python3 examples/token/mint.py --vector
fi

if command -v bash >/dev/null 2>&1; then
    bash -n entrypoint.sh
    bash -n scripts/check.sh
fi

(cd realtime && npm ci --omit=dev --no-audit --no-fund && npm test)
echo "OK"
