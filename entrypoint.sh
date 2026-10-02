#!/bin/bash
set -euo pipefail

# The official jgraph/drawio entrypoint regenerates PreConfig.js on every start
# and forces urlParams['sync'] = 'manual'. That line stays. It stops the hosted
# diagrams.net channel (Cloudflare, Pusher, encrypted patches). We run the
# official entrypoint first, then replace the file it just wrote.

CONFIG_DIR="$(cd "$(dirname "$0")" && pwd)"
CATALINA="${CATALINA_HOME:-/usr/local/tomcat}"
DRAW_JS="${CATALINA}/webapps/draw/js"

if [[ -z "${DRAWIO_PUBLIC_HOST:-}" ]]; then
    echo "DRAWIO_PUBLIC_HOST is empty. Set it to the editor hostname, for example drawio.example.com" >&2
    exit 1
fi

if [[ "${DRAWIO_PUBLIC_HOST}" == *"/"* || "${DRAWIO_PUBLIC_HOST}" == *"://"* ]]; then
    echo "DRAWIO_PUBLIC_HOST must be a hostname, not a URL. Got: ${DRAWIO_PUBLIC_HOST}" >&2
    exit 1
fi

# useSendfile skips Tomcat's compression filter, so /js/app.min.js (~9 MB) is sent raw.
enable_static_delivery() {
    local server_xml="${CATALINA}/conf/server.xml"
    local web_xml="${CATALINA}/webapps/draw/WEB-INF/web.xml"
    local connector='/Server/Service/Connector[@port="8080"]'

    if [[ -f "${server_xml}" ]]; then
        local sendfile
        sendfile="$(xmlstarlet sel -t -v "${connector}/@useSendfile" "${server_xml}" 2>/dev/null || true)"
        if [[ "${sendfile}" != "false" ]]; then
            xmlstarlet ed -P -S -L \
                -i "${connector}" -t attr -n compression -v on \
                -i "${connector}" -t attr -n compressionMinSize -v 2048 \
                -i "${connector}" -t attr -n compressibleMimeType -v 'text/html,text/xml,text/plain,text/css,text/javascript,application/javascript,application/json,application/xml,image/svg+xml' \
                -i "${connector}" -t attr -n useSendfile -v false \
                "${server_xml}"
        fi
    fi

    if [[ -f "${web_xml}" ]] && ! grep -q 'drawioStaticCache' "${web_xml}"; then
        local tmp
        tmp="$(mktemp)"
        awk '
            /<\/web-app>/ && !inserted {
                print "    <filter>"
                print "        <filter-name>drawioStaticCache</filter-name>"
                print "        <filter-class>org.apache.catalina.filters.ExpiresFilter</filter-class>"
                print "        <init-param>"
                print "            <param-name>ExpiresByType text/javascript</param-name>"
                print "            <param-value>access plus 1 day</param-value>"
                print "        </init-param>"
                print "        <init-param>"
                print "            <param-name>ExpiresByType application/javascript</param-name>"
                print "            <param-value>access plus 1 day</param-value>"
                print "        </init-param>"
                print "        <init-param>"
                print "            <param-name>ExpiresByType text/css</param-name>"
                print "            <param-value>access plus 1 day</param-value>"
                print "        </init-param>"
                print "        <init-param>"
                print "            <param-name>ExpiresByType application/xml</param-name>"
                print "            <param-value>access plus 1 day</param-value>"
                print "        </init-param>"
                print "        <init-param>"
                print "            <param-name>ExpiresByType text/xml</param-name>"
                print "            <param-value>access plus 1 day</param-value>"
                print "        </init-param>"
                print "    </filter>"
                print "    <filter-mapping>"
                print "        <filter-name>drawioStaticCache</filter-name>"
                print "        <url-pattern>/*</url-pattern>"
                print "    </filter-mapping>"
                inserted = 1
            }
            { print }
        ' "${web_xml}" > "${tmp}"
        mv "${tmp}" "${web_xml}"
    fi
}

if [[ -x /docker-entrypoint.sh ]]; then
    /docker-entrypoint.sh true
fi

enable_static_delivery

cp "${CONFIG_DIR}/PreConfig.js" "${DRAW_JS}/PreConfig.js"
cp "${CONFIG_DIR}/PostConfig.js" "${DRAW_JS}/PostConfig.js"

# PreConfig.js is baked with the placeholder drawio.example.com.
# DRAWIO_SCHEME=http is the laptop path (ws://). The default is https (wss://).
SCHEME="${DRAWIO_SCHEME:-https}"
case "${SCHEME}" in
    http) WS_SCHEME="ws" ;;
    https) WS_SCHEME="wss" ;;
    *)
        echo "DRAWIO_SCHEME must be http or https. Got: ${SCHEME}" >&2
        exit 1
        ;;
esac

sed -i \
    -e "s#https://drawio.example.com#${SCHEME}://${DRAWIO_PUBLIC_HOST}#g" \
    -e "s#wss://drawio.example.com#${WS_SCHEME}://${DRAWIO_PUBLIC_HOST}#g" \
    "${DRAW_JS}/PreConfig.js"

if ! grep -q "${WS_SCHEME}://${DRAWIO_PUBLIC_HOST}/rt" "${DRAW_JS}/PreConfig.js"; then
    echo "PreConfig.js has no ${WS_SCHEME}://${DRAWIO_PUBLIC_HOST}/rt after rewrite" >&2
    exit 1
fi

DRAW_ROOT="${CATALINA}/webapps/draw"
if [[ -d "${CONFIG_DIR}/libs" ]]; then
    mkdir -p "${DRAW_ROOT}/libs"
    cp -a "${CONFIG_DIR}/libs/." "${DRAW_ROOT}/libs/"
fi

# Browsers cache js/PreConfig.js across deploys. Stamp the HTML so the
# shim actually loads after we replace the official file.
STAMP="$(date +%s)"
for html in "${DRAW_ROOT}/index.html" "${DRAW_ROOT}/teams.html"; do
    if [[ -f "${html}" ]]; then
        sed -i.bak \
            -e "s|js/PreConfig.js|js/PreConfig.js?v=${STAMP}|g" \
            -e "s|js/PostConfig.js|js/PostConfig.js?v=${STAMP}|g" \
            "${html}" || true
    fi
done

exec catalina.sh run
