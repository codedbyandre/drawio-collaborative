/*
 * Collaboration shim for the official draw.io image jgraph/drawio:24.7.17.
 *
 * The image entrypoint rewrites PreConfig.js on every start and forces
 * sync=manual. Our entrypoint runs that first, then copies this file over it.
 * The https and wss URLs in this file use a placeholder host.
 * entrypoint.sh replaces that host with DRAWIO_PUBLIC_HOST.
 * Do not point these URLs at diagrams.net.
 *
 * The parent page receives two postMessage events from this file:
 * drawioPeers (who is in the room) and drawioRt (connection state).
 * Those names are the contract. Renaming them silently breaks every
 * parent that listens for them.
 *
 * This file calls EditorUi.diffPages, applyPatches, clonePages and hooks
 * EditorUi.init. A newer draw.io build can remove those and the shim stops
 * syncing shapes. Stay on the pinned base image until you have retested
 * two browsers on one diagram.
 */
(function ignoreDrawioUnload() {
    var add = window.addEventListener;
    window.addEventListener = function (type, listener, options) {
        if (type === 'unload') {
            return;
        }

        return add.call(this, type, listener, options);
    };
})();

(function () {
    try {
        var s = document.createElement('meta');
        s.setAttribute('http-equiv', 'Content-Security-Policy');
        s.setAttribute('content', [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self' wss://drawio.example.com https://drawio.example.com",
            "frame-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
        ].join('; '));
        var t = document.getElementsByTagName('meta')[0];
        t.parentNode.insertBefore(s, t);
    } catch (e) {}
})();

window.EXPORT_URL = '/service/0';
window.PLANT_URL = '/service/1';
window.DRAWIO_SERVER_URL = 'https://drawio.example.com/';
window.DRAWIO_BASE_URL = 'https://drawio.example.com';
window.DRAWIO_VIEWER_URL = 'https://drawio.example.com';
window.DRAWIO_LIGHTBOX_URL = 'https://drawio.example.com';
window.DRAW_MATH_URL = 'math/es5';

window.RT_WEBSOCKET_URL = 'wss://drawio.example.com/rt';
window.REALTIME_URL = 'https://drawio.example.com/cache';

window.DRAWIO_CONFIG = { lockdown: false, enableAi: false };

urlParams['sync'] = 'manual';
urlParams['db'] = '0';
urlParams['gh'] = '0';
urlParams['tr'] = '0';
urlParams['gapi'] = '0';
urlParams['od'] = '0';
urlParams['gl'] = '0';

(function blockRemotePush() {
    var impl = window.mxscript;

    function wrap(fn) {
        if (typeof fn !== 'function' || fn.__drawioSkipRemotePush) {
            return fn;
        }

        var wrapped = function (src, onload) {
            if (typeof src === 'string' && /pusher/i.test(src)) {
                if (typeof onload === 'function') {
                    onload();
                }

                return;
            }

            return fn.call(this, src, function () {
                if (window.__drawioHookEditor) {
                    window.__drawioHookEditor();
                }

                if (typeof onload === 'function') {
                    onload.apply(this, arguments);
                }
            });
        };
        wrapped.__drawioSkipRemotePush = true;

        return wrapped;
    }

    if (typeof impl === 'function') {
        impl = wrap(impl);
    }

    try {
        Object.defineProperty(window, 'mxscript', {
            configurable: true,
            get: function () { return impl; },
            set: function (value) { impl = wrap(value); },
        });
    } catch (e) {
        window.mxscript = impl;
    }
})();

window.Pusher = function () {
    this.connection = {
        state: 'connected',
        bind: function (event, callback) {
            if (event === 'state_change' && typeof callback === 'function') {
                setTimeout(function () {
                    callback({ previous: 'connecting', current: 'connected' });
                }, 0);
            }

            return this;
        },
        unbind: function () { return this; },
    };
};
window.Pusher.prototype.subscribe = function () {
    return { bind: function () { return this; }, unbind: function () { return this; } };
};
window.Pusher.prototype.unsubscribe = function () {};
window.Pusher.prototype.disconnect = function () {};
window.Pusher.prototype.bind = function () { return this; };

(function localRealtime() {
    var applying = false;
    var attached = false;
    var lastSent = '';
    var socket = null;
    var relayRaf = 0;
    var relayDirty = false;
    var bootTimer = 0;

    window.__drawioRt = { room: '', socket: 0, attached: false, ui: false };

    function roomId() {
        var fromUrl = (urlParams['room'] || '').toString();
        if (fromUrl) {
            return fromUrl;
        }

        var ui = window.__drawioUi;
        try {
            var file = ui && ui.getCurrentFile && ui.getCurrentFile();
            var id = file && (typeof file.getId === 'function' ? file.getId() : file.id);
            if (id) {
                return 'd-' + id;
            }
        } catch (e) {}

        return '';
    }

    function wrapInit(fn) {
        if (typeof fn !== 'function' || fn.__drawioInit) {
            return fn;
        }

        var wrapped = function () {
            window.__drawioUi = this;
            window.__drawioRt.ui = true;
            var result = fn.apply(this, arguments);
            tryStart();

            return result;
        };
        wrapped.__drawioInit = true;

        return wrapped;
    }

    function hookClass(name) {
        var held = window[name];

        function install(Cls) {
            if (typeof Cls !== 'function' || ! Cls.prototype) {
                return Cls;
            }

            var proto = Cls.prototype;
            var desc = Object.getOwnPropertyDescriptor(proto, 'init');
            if (desc && typeof desc.set === 'function') {
                return Cls;
            }

            var current = proto.init;
            Object.defineProperty(proto, 'init', {
                configurable: true,
                enumerable: true,
                get: function () { return current; },
                set: function (value) { current = wrapInit(value); },
            });
            current = wrapInit(current);

            return Cls;
        }

        try {
            Object.defineProperty(window, name, {
                configurable: true,
                enumerable: true,
                get: function () { return held; },
                set: function (value) { held = install(value); },
            });
            if (held) {
                held = install(held);
            }
        } catch (e) {
            if (held) {
                install(held);
            }
        }
    }

    window.__drawioHookEditor = function () {
        hookClass('EditorUi');
        hookClass('App');
    };

    hookClass('EditorUi');
    hookClass('App');

    function fileIsOpen(ui) {
        if (ui && ui.editor && ui.editor.graph && (urlParams['room'] || '').toString()) {
            return true;
        }

        try {
            return typeof ui.getCurrentFile === 'function' && ui.getCurrentFile() !== null;
        } catch (e) {
            return false;
        }
    }

    function cellCount(graph) {
        var cells = graph.model.cells;
        var n = 0;
        var id;

        if (! cells) {
            return 0;
        }

        for (id in cells) {
            if (Object.prototype.hasOwnProperty.call(cells, id)) {
                n++;
            }
        }

        return n;
    }

    var snapshot = null;
    var snapshotTimer = 0;
    var pending = null;

    function pageId(ui) {
        try {
            return ui && ui.currentPage && typeof ui.currentPage.getId === 'function'
                ? String(ui.currentPage.getId())
                : '';
        } catch (e) {
            return '';
        }
    }

    function shortWho(name) {
        name = String(name || '').replace(/\s+/g, ' ').trim();
        if (! name) {
            return 'Gast';
        }

        return name.split(' ')[0];
    }

    function fileXml(ui) {
        try {
            if (typeof ui.getXmlForPages === 'function' && ui.pages) {
                return ui.getXmlForPages(ui.pages);
            }
        } catch (e) {}

        try {
            if (typeof ui.getFileData === 'function') {
                return ui.getFileData(true);
            }
        } catch (e) {}

        return mxUtils.getXml(new mxCodec().encode(ui.editor.graph.model));
    }

    function isEmptyDiff(diff) {
        if (! diff || typeof diff !== 'object') {
            return true;
        }

        var insKey = (window.EditorUi && EditorUi.DIFF_INSERT) || 'i';
        var remKey = (window.EditorUi && EditorUi.DIFF_REMOVE) || 'r';
        var updKey = (window.EditorUi && EditorUi.DIFF_UPDATE) || 'u';
        var ins = diff[insKey];
        var rem = diff[remKey];
        var upd = diff[updKey];

        if (ins && ins.length) {
            return false;
        }

        if (rem && rem.length) {
            return false;
        }

        return ! upd || mxUtils.isEmptyObject(upd);
    }

    function pageById(pages, id) {
        if (! pages || ! id) {
            return null;
        }

        var i;
        for (i = 0; i < pages.length; i++) {
            if (pages[i].getId() === id) {
                return pages[i];
            }
        }

        return null;
    }

    function pageStructureChanged(from, to) {
        if (! from || ! to || from.length !== to.length) {
            return true;
        }

        var i;
        for (i = 0; i < from.length; i++) {
            if (from[i].getId() !== to[i].getId()) {
                return true;
            }

            if (typeof from[i].getName === 'function' && typeof to[i].getName === 'function'
                && from[i].getName() !== to[i].getName()) {
                return true;
            }
        }

        return false;
    }

    function captureSnapshot(ui) {
        try {
            if (ui.pages && typeof ui.clonePages === 'function') {
                snapshot = ui.clonePages(ui.pages);
            }
        } catch (e) {
            snapshot = null;
        }
    }

    function replaceSnapshotPage(ui, page) {
        if (! snapshot || ! page || typeof ui.clonePages !== 'function') {
            captureSnapshot(ui);

            return;
        }

        var clones;
        try {
            clones = ui.clonePages([page]);
        } catch (e) {
            captureSnapshot(ui);

            return;
        }

        if (! clones || ! clones[0]) {
            captureSnapshot(ui);

            return;
        }

        var id = page.getId();
        var i;
        for (i = 0; i < snapshot.length; i++) {
            if (snapshot[i].getId() === id) {
                snapshot[i] = clones[0];

                return;
            }
        }

        captureSnapshot(ui);
    }

    function stayOnPage(ui, stay) {
        if (! stay || ! ui.pages || typeof ui.selectPage !== 'function') {
            return;
        }

        var id = typeof stay.getId === 'function' ? stay.getId() : null;
        var i;

        for (i = 0; i < ui.pages.length; i++) {
            if (ui.pages[i] === stay || (id && ui.pages[i].getId() === id)) {
                if (ui.currentPage !== ui.pages[i]) {
                    ui.selectPage(ui.pages[i], true);
                }

                return;
            }
        }

        if (ui.pages.length && mxUtils.indexOf(ui.pages, ui.currentPage) < 0) {
            ui.selectPage(ui.pages[0], true);
        }
    }

    function syncPages(ui, next, stay) {
        if (! next || ! ui.pages) {
            stayOnPage(ui, stay);

            return;
        }

        if (next !== ui.pages) {
            ui.pages.splice(0, ui.pages.length);
            var i;
            for (i = 0; i < next.length; i++) {
                ui.pages.push(next[i]);
            }
        }

        if (typeof ui.updateTabContainer === 'function') {
            ui.updateTabContainer();
        }

        stayOnPage(ui, stay);
    }

    function applyRemoteDiff(ui, diff, pid) {
        if (! diff || typeof ui.applyPatches !== 'function' || ! ui.pages) {
            return;
        }

        var stay = ui.currentPage;
        var graph = ui.editor.graph;

        applying = true;
        graph.model.beginUpdate();
        try {
            syncPages(ui, ui.applyPatches(ui.pages, [diff], true), stay);
        } finally {
            graph.model.endUpdate();
            applying = false;
            if (pid) {
                replaceSnapshotPage(ui, pageById(ui.pages, pid) || ui.currentPage);
            } else {
                captureSnapshot(ui);
            }
        }
    }

    function applyRemoteFile(ui, xml) {
        if (! xml || typeof ui.getPagesForXml !== 'function') {
            return;
        }

        var incoming;

        try {
            incoming = ui.getPagesForXml(xml);
        } catch (e) {
            return;
        }

        if (! incoming || ! incoming.length || ! ui.pages) {
            return;
        }

        if (incoming.length === 1 && ui.pages.length > 1
            && xml.indexOf('<mxfile') === -1 && xml.indexOf('<diagram') === -1) {
            return;
        }

        applyRemoteDiff(ui, ui.diffPages(ui.pages, incoming));
    }

    function sendJson(payload) {
        if (! socket || socket.readyState !== 1) {
            return;
        }

        socket.send(JSON.stringify(payload));
    }

    function sendSnapshot(ui) {
        var xml = fileXml(ui);
        if (! xml || xml === lastSent) {
            return;
        }

        lastSent = xml;
        sendJson({ type: 'snapshot', xml: xml });
    }

    function scheduleSnapshot(ui) {
        clearTimeout(snapshotTimer);
        snapshotTimer = setTimeout(function () {
            sendSnapshot(ui);
        }, 1500);
    }

    function sendLocalChanges(ui) {
        if (! canRelay(ui)) {
            return;
        }

        var diff;
        var full = ! snapshot || pageStructureChanged(snapshot, ui.pages);
        var currentId = pageId(ui);

        if (snapshot && typeof ui.diffPages === 'function') {
            try {
                if (full) {
                    diff = ui.diffPages(snapshot, ui.pages);
                } else {
                    var from = pageById(snapshot, currentId);
                    var to = ui.currentPage;
                    diff = (from && to) ? ui.diffPages([from], [to]) : ui.diffPages(snapshot, ui.pages);
                }
            } catch (e) {
                diff = null;
            }
        }

        if (diff && ! isEmptyDiff(diff)) {
            if (full) {
                captureSnapshot(ui);
            } else {
                replaceSnapshotPage(ui, ui.currentPage);
            }
            sendJson({ type: 'diff', diff: diff, pageId: currentId });
            scheduleSnapshot(ui);

            return;
        }

        if (full) {
            captureSnapshot(ui);
        }

        if (! diff) {
            var xml = fileXml(ui);
            if (xml && xml !== lastSent) {
                lastSent = xml;
                sendJson({ type: 'xml', xml: xml, pageId: currentId });
            }
        }
    }

    function flushRelay(ui) {
        relayDirty = false;
        if (relayRaf) {
            cancelAnimationFrame(relayRaf);
            relayRaf = 0;
        }
        sendLocalChanges(ui);
    }

    function scheduleRelay(ui) {
        relayDirty = true;
        if (relayRaf) {
            return;
        }

        relayRaf = requestAnimationFrame(function () {
            relayRaf = 0;
            if (! relayDirty) {
                return;
            }
            relayDirty = false;
            sendLocalChanges(ui);
        });
    }

    var CURSOR_COLORS = '#e6194b #3cb44b #4363d8 #f58231 #911eb4 #f032e6 #469990 #9A6324'.split(' ');
    var remoteCursors = {};
    var mySid = (urlParams['uid'] || '').toString() || ('s' + Math.random().toString(36).slice(2, 10));
    var myName = (function () {
        var raw;
        try {
            raw = decodeURIComponent((urlParams['who'] || '').toString());
        } catch (e) {
            raw = (urlParams['who'] || '').toString();
        }

        return shortWho(raw);
    }());

    function colorFor(sid, color) {
        if (typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color)) {
            return color;
        }

        var n = 0;
        var i;
        for (i = 0; i < sid.length; i++) {
            n = (n * 31 + sid.charCodeAt(i)) >>> 0;
        }

        return CURSOR_COLORS[n % CURSOR_COLORS.length];
    }

    function sendCursor(ui, x, y, hide) {
        sendJson({
            type: 'cursor',
            sid: mySid,
            name: myName,
            pageId: pageId(ui),
            x: x,
            y: y,
            hide: !! hide,
        });
    }

    function cellIds(cells) {
        var out = [];
        var i;
        if (! cells) {
            return out;
        }

        for (i = 0; i < cells.length; i++) {
            if (cells[i] && cells[i].id) {
                out.push(String(cells[i].id));
            }
        }

        return out;
    }

    function clearHighlights(rec) {
        var id;
        if (! rec || ! rec.selection) {
            return;
        }

        for (id in rec.selection) {
            if (Object.prototype.hasOwnProperty.call(rec.selection, id) && rec.selection[id]) {
                rec.selection[id].destroy();
            }
        }

        rec.selection = {};
    }

    function samePage(ui, pid) {
        return ! pid || pid === pageId(ui);
    }

    function placeCursor(ui, rec, animate) {
        var graph = ui.editor.graph;
        var tr = graph.view.translate;
        var scale = graph.view.scale;
        var visible = ! rec.hide && samePage(ui, rec.pageId);

        rec.el.style.transition = animate
            ? 'left 16ms linear, top 16ms linear'
            : 'none';
        rec.el.style.left = ((tr.x + rec.x) * scale + 8) + 'px';
        rec.el.style.top = ((tr.y + rec.y) * scale - 12) + 'px';
        rec.el.style.display = visible ? '' : 'none';
    }

    function ensureRemote(ui, sid, name, color) {
        var rec = remoteCursors[sid];
        var host;
        var paint;
        var el;
        var tip;
        var label;

        if (rec) {
            if (name) {
                rec.label.textContent = shortWho(name);
            }
            paint = colorFor(sid, color);
            if (rec.color !== paint) {
                rec.color = paint;
                rec.tip.style.borderBottomColor = paint;
                rec.label.style.background = paint;
            }

            return rec;
        }

        paint = colorFor(sid, color);
        host = ui.diagramContainer || ui.editor.graph.container;
        el = document.createElement('div');
        el.setAttribute('data-drawio-cursor', sid);
        el.style.cssText = 'pointer-events:none;position:absolute;z-index:20;opacity:0.92;display:none';
        tip = document.createElement('div');
        tip.style.cssText = 'width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:12px solid '
            + paint + ';transform:rotate(-20deg);margin-left:2px';
        el.appendChild(tip);
        label = document.createElement('div');
        label.style.cssText = 'background:' + paint + ';color:#fff;font:600 10px/1.2 system-ui,sans-serif;padding:2px 6px;margin-top:3px;border-radius:8px;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        label.textContent = shortWho(name);
        el.appendChild(label);
        host.appendChild(el);
        rec = { el: el, tip: tip, label: label, color: paint, x: 0, y: 0, hide: false, pageId: '', to: 0, selection: {} };
        remoteCursors[sid] = rec;

        return rec;
    }

    function showRemoteCursor(ui, msg) {
        var rec = ensureRemote(ui, msg.sid || 'anon', msg.name, msg.color);

        rec.x = msg.x;
        rec.y = msg.y;
        rec.hide = !! msg.hide;
        rec.pageId = msg.pageId || '';
        placeCursor(ui, rec, true);
        clearTimeout(rec.to);
        rec.to = setTimeout(function () {
            rec.el.style.display = 'none';
        }, 8000);
    }

    function showRemoteSelection(ui, msg) {
        var rec = ensureRemote(ui, msg.sid || 'anon', msg.name, msg.color);
        var graph = ui.editor.graph;
        var added = msg.added || [];
        var removed = msg.removed || [];
        var i;
        var cell;
        var highlight;

        rec.pageId = msg.pageId || rec.pageId;

        if (! samePage(ui, rec.pageId) || typeof graph.highlightCell !== 'function') {
            clearHighlights(rec);

            return;
        }

        for (i = 0; i < removed.length; i++) {
            highlight = rec.selection[removed[i]];
            if (highlight) {
                highlight.destroy();
                delete rec.selection[removed[i]];
            }
        }

        for (i = 0; i < added.length; i++) {
            cell = graph.model.getCell(added[i]);
            if (! cell || rec.selection[added[i]]) {
                continue;
            }

            rec.selection[added[i]] = graph.highlightCell(cell, colorFor(msg.sid || 'anon', msg.color), 60000, 70, 3);
        }
    }

    function refreshOverlays(ui, animate) {
        var sid;
        var rec;
        var pid = pageId(ui);

        for (sid in remoteCursors) {
            if (! Object.prototype.hasOwnProperty.call(remoteCursors, sid)) {
                continue;
            }

            rec = remoteCursors[sid];
            placeCursor(ui, rec, !! animate);
            if (rec.pageId && rec.pageId !== pid) {
                clearHighlights(rec);
            }
        }
    }

    function graphPoint(graph, me) {
        var off = mxUtils.getOffset(graph.container);
        var tr = graph.view.translate;
        var scale = graph.view.scale;

        return {
            x: Math.round((me.getX() - off.x + graph.container.scrollLeft) / scale - tr.x),
            y: Math.round((me.getY() - off.y + graph.container.scrollTop) / scale - tr.y),
        };
    }

    function attachPresence(ui) {
        var graph = ui.editor.graph;
        var last = 0;
        var lastSel = [];
        var lastPoint = { x: 0, y: 0 };

        function sendSelection() {
            var ids = cellIds(graph.getSelectionCells());
            var added = [];
            var removed = [];
            var i;

            for (i = 0; i < ids.length; i++) {
                if (lastSel.indexOf(ids[i]) === -1) {
                    added.push(ids[i]);
                }
            }

            for (i = 0; i < lastSel.length; i++) {
                if (ids.indexOf(lastSel[i]) === -1) {
                    removed.push(lastSel[i]);
                }
            }

            lastSel = ids;
            sendJson({
                type: 'selection',
                sid: mySid,
                name: myName,
                pageId: pageId(ui),
                added: added,
                removed: removed,
            });
            sendCursor(ui, lastPoint.x, lastPoint.y, false);
        }

        graph.addMouseListener({
            mouseDown: function (sender, me) {
                lastPoint = graphPoint(graph, me);
                sendCursor(ui, lastPoint.x, lastPoint.y, false);
            },
            mouseMove: function (sender, me) {
                var now;

                lastPoint = graphPoint(graph, me);
                if (graph.isMouseDown) {
                    return;
                }

                now = Date.now();
                if (now - last < 16) {
                    return;
                }

                last = now;
                sendCursor(ui, lastPoint.x, lastPoint.y, false);
            },
            mouseUp: function () {
                flushRelay(ui);
            },
        });

        graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
            if (applying) {
                return;
            }

            sendSelection();
        });

        function reposition() {
            refreshOverlays(ui, false);
        }

        mxEvent.addListener(graph.container, 'scroll', reposition);
        graph.getView().addListener(mxEvent.SCALE, reposition);
        graph.getView().addListener(mxEvent.TRANSLATE, reposition);
        function onPagesChanged() {
            if (applying) {
                return;
            }

            scheduleRelay(ui);
        }

        if (typeof ui.addListener === 'function') {
            ui.addListener('pageInserted', onPagesChanged);
            ui.addListener('pageRemoved', onPagesChanged);
            ui.addListener('pageMoved', onPagesChanged);
            ui.addListener('pageSelected', function () {
                refreshOverlays(ui, false);
            });
        }

        window.addEventListener('pagehide', function () {
            sendCursor(ui, 0, 0, true);
        });
    }

    function canRelay(ui) {
        return ! applying && !! ui && !! ui.editor && !! ui.editor.graph
            && fileIsOpen(ui) && !! ui.pages && ui.pages.length > 0;
    }

    function applyIncoming(ui, msg) {
        if (msg.type === 'diff') {
            applyRemoteDiff(ui, msg.diff, msg.pageId);

            return;
        }

        if (msg.type === 'xml' && typeof msg.xml === 'string') {
            applyRemoteFile(ui, msg.xml);
        }
    }

    function attach(ui) {
        if (attached || ! ui.editor || ! ui.editor.graph) {
            return;
        }

        attached = true;
        window.__drawioRt.attached = true;
        captureSnapshot(ui);

        attachPresence(ui);

        function afterFileReady() {
            captureSnapshot(ui);
            if (pending && fileIsOpen(ui)) {
                applyIncoming(ui, pending);
                pending = null;
            }
        }

        var setGraphXml = ui.editor.setGraphXml;
        if (typeof setGraphXml === 'function' && ! setGraphXml.__drawioReady) {
            ui.editor.setGraphXml = function () {
                var result = setGraphXml.apply(this, arguments);
                setTimeout(afterFileReady, 0);

                return result;
            };
            ui.editor.setGraphXml.__drawioReady = true;
        }

        ui.editor.graph.model.addListener(mxEvent.CHANGE, function () {
            if (applying) {
                return;
            }

            scheduleRelay(ui);
        });

        if (pending && fileIsOpen(ui) && cellCount(ui.editor.graph) > 2) {
            afterFileReady();
        }

        setTimeout(function () {
            afterFileReady();
            sendSnapshot(ui);
        }, 600);
        window.__drawioRtScheduleRelay = function () {
            sendSnapshot(ui);
        };
        report();
    }

    function report() {
        try {
            window.parent.postMessage(JSON.stringify({
                event: 'drawioRt',
                state: window.__drawioRt,
                hasUi: !! window.__drawioUi,
                cells: window.__drawioUi && window.__drawioUi.editor
                    ? cellCount(window.__drawioUi.editor.graph)
                    : 0,
            }), '*');
        } catch (e) {}
    }

    function reportPeers(peers) {
        try {
            window.parent.postMessage(JSON.stringify({
                event: 'drawioPeers',
                peers: peers,
            }), '*');
        } catch (e) {}
    }

    function openSocket() {
        var id = roomId();
        var base = window.RT_WEBSOCKET_URL;
        window.__drawioRt.room = id;
        if (! id || ! base || socket) {
            return;
        }

        var rt = (urlParams['rt'] || '').toString();
        var query = 'id=' + encodeURIComponent(id);
        if (rt) {
            query += '&rt=' + encodeURIComponent(rt);
        }

        socket = new WebSocket(base + (base.indexOf('?') === -1 ? '?' : '&') + query);

        socket.onmessage = function (event) {
            var msg;
            try {
                msg = JSON.parse(event.data);
            } catch (e) {
                return;
            }

            if (msg.type === 'sync-request' && typeof window.__drawioRtScheduleRelay === 'function') {
                window.__drawioRtScheduleRelay();

                return;
            }

            if (msg.type === 'presence' && Array.isArray(msg.peers)) {
                reportPeers(msg.peers);

                return;
            }

            if (msg.type === 'cursor' && window.__drawioUi && window.__drawioUi.editor) {
                showRemoteCursor(window.__drawioUi, msg);

                return;
            }

            if (msg.type === 'selection' && window.__drawioUi && window.__drawioUi.editor) {
                showRemoteSelection(window.__drawioUi, msg);

                return;
            }

            if (msg.type !== 'diff' && msg.type !== 'xml') {
                return;
            }

            var ui = window.__drawioUi;
            if (! ui || ! ui.editor || ! fileIsOpen(ui)) {
                pending = msg;

                return;
            }

            if (msg.type === 'xml' && msg.xml === lastSent) {
                return;
            }

            applyIncoming(ui, msg);
        };

        socket.onopen = function () {
            window.__drawioRt.socket = 1;
            if (socket && socket.readyState === 1) {
                socket.send(JSON.stringify({ type: 'sync-request' }));
            }
        };

        socket.onclose = function () {
            window.__drawioRt.socket = 0;
            socket = null;
            setTimeout(openSocket, 2000);
        };
    }

    function tryStart() {
        openSocket();

        var ui = window.__drawioUi;
        if (ui) {
            attach(ui);
        }
    }

    function boot() {
        hookClass('EditorUi');
        hookClass('App');
        tryStart();
        report();
        if (attached && socket && socket.readyState === 1) {
            clearInterval(bootTimer);
            bootTimer = 0;
        }
    }

    hookClass('EditorUi');
    hookClass('App');
    openSocket();
    bootTimer = setInterval(boot, 250);
})();
