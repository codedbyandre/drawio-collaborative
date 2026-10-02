#!/usr/bin/env bash
# Confirms a running host. Run this from the repository root after compose is up.
# Exit 0 means the editor host is answering the way the shim expects.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    echo "Missing .env. Copy .env.example to .env and fill it in."
    exit 1
fi

read_env() {
    local key="$1"
    local line
    line="$(grep -E "^${key}=" .env | tail -n 1 || true)"
    line="${line#*=}"
    line="${line%\"}"
    line="${line#\"}"
    line="${line%\'}"
    line="${line#\'}"
    printf '%s' "$line"
}

host="$(read_env DRAWIO_PUBLIC_HOST)"
origin="$(read_env DRAWIO_ORIGIN)"
ancestors="$(read_env DRAWIO_FRAME_ANCESTORS)"
secret="$(read_env DRAWIO_RT_SECRET)"
scheme="$(read_env DRAWIO_SCHEME)"
scheme="${scheme:-https}"

if [[ -z "$host" || "$host" == *"/"* ]]; then
    echo "DRAWIO_PUBLIC_HOST must be a hostname such as drawio.example.com"
    exit 1
fi

if [[ -z "$secret" || "$secret" == "replace-me" ]]; then
    echo "DRAWIO_RT_SECRET is still empty or replace-me. Generate one with: openssl rand -hex 32"
    exit 1
fi

case ",${origin}," in
    *",${scheme}://${host},"*) ;;
    *)
        echo "DRAWIO_ORIGIN must include ${scheme}://${host}"
        echo "The browser opens the socket from inside the editor iframe, so the Origin is the editor itself."
        echo "It is not your Nextcloud URL. Current value: ${origin:-<empty>}"
        exit 1
        ;;
esac

base="${scheme}://${host}"
echo "Checking ${base}"

fetch() {
    local url="$1"
    local out
    if ! out="$(curl -fsS --max-time "$2" "$url")"; then
        echo "Could not fetch ${url}"
        echo "If the certificate is new, wait a minute and run: docker compose logs caddy"
        exit 1
    fi
    printf '%s' "$out"
}

echo "1. PreConfig.js was rewritten for this host"
pre="$(fetch "${base}/js/PreConfig.js" 30)"
ws_scheme="wss"
if [[ "$scheme" == "http" ]]; then
    ws_scheme="ws"
fi
if ! grep -q "${ws_scheme}://${host}/rt" <<<"$pre"; then
    echo "FAIL: PreConfig.js does not contain ${ws_scheme}://${host}/rt"
    echo "Recreate the drawio container so entrypoint.sh can stamp the host:"
    echo "  docker compose up -d --force-recreate drawio"
    exit 1
fi
if grep -q "https://drawio.example.com" <<<"$pre" || grep -q "wss://drawio.example.com" <<<"$pre"; then
    echo "FAIL: PreConfig.js still contains the placeholder host drawio.example.com"
    exit 1
fi
if ! grep -q "applyPatches" <<<"$pre"; then
    echo "FAIL: the collaboration shim is not the file being served"
    exit 1
fi
if grep -q "js.pusher.com" <<<"$pre" || grep -q "app.diagrams.net" <<<"$pre"; then
    echo "FAIL: PreConfig.js points at the public diagrams.net realtime channel"
    exit 1
fi
echo "   ok"

echo "2. /cache?alive=1 answers 1"
alive="$(fetch "${base}/cache?alive=1" 20)"
if [[ "$alive" != "1" ]]; then
    echo "FAIL: /cache?alive=1 returned [${alive}]"
    echo "The editor waits on this URL at startup. /cache must reach the room server on the same hostname."
    exit 1
fi
echo "   ok"

echo "3. app.min.js is compressed"
# Header names are case-insensitive, and awk IGNORECASE is a GNU extension.
headers="$(curl -sS -D - -o /dev/null --max-time 60 -H 'Accept-Encoding: gzip' "${base}/js/app.min.js" | tr -d '\r' | tr 'A-Z' 'a-z')"
encoding="$(awk '/^content-encoding:/ { print $2 }' <<<"$headers" | tail -n 1)"
if [[ "$encoding" != "gzip" ]]; then
    echo "FAIL: content-encoding is [${encoding:-missing}], expected gzip"
    echo "HEAD requests skip compression. This check uses GET. Recreate the drawio container."
    exit 1
fi
echo "   ok"

echo "4. frame-ancestors lists the parent sites"
csp="$(curl -sS -D - -o /dev/null --max-time 20 "${base}/" | tr -d '\r' \
    | awk 'tolower($0) ~ /^content-security-policy:/ { sub(/^[^:]+:[[:space:]]*/, ""); print }')"
if [[ -z "$csp" ]] || ! grep -q "frame-ancestors" <<<"$csp"; then
    echo "FAIL: the editor document has no frame-ancestors header"
    echo "${csp}"
    exit 1
fi
if [[ -n "$ancestors" ]]; then
    for item in $ancestors; do
        if ! grep -F -q "$item" <<<"$csp"; then
            echo "FAIL: frame-ancestors does not contain ${item}"
            echo "${csp}"
            echo "Put that exact origin in DRAWIO_FRAME_ANCESTORS and recreate the proxy:"
            echo "  docker compose up -d --force-recreate"
            exit 1
        fi
    done
fi
echo "   ${csp}"
echo
echo "OK. Open the example or Nextcloud next. Two browsers, one diagram, a shape on one side appears on the other."
