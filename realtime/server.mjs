import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const RT_SECRET = process.env.DRAWIO_RT_SECRET ?? '';
const ALLOWED_ORIGINS = (process.env.DRAWIO_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const parsedMax = Number.parseInt(process.env.DRAWIO_RT_MAX_CLIENTS ?? '32', 10);
const MAX_CLIENTS_PER_ROOM = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 32;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
const CURSOR_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#f032e6', '#469990', '#9A6324'];

/** @type {Map<string, { clients: Set<import('ws').WebSocket>, lastXml: string|null, timer: NodeJS.Timeout|null }>} */
const rooms = new Map();

function roomOf(id) {
    let room = rooms.get(id);
    if (room === undefined) {
        room = { clients: new Set(), lastXml: null, timer: null };
        rooms.set(id, room);
    }

    if (room.timer) {
        clearTimeout(room.timer);
        room.timer = null;
    }

    return room;
}

function forgetIfEmpty(id, room) {
    if (room.clients.size > 0) {
        return;
    }

    room.timer = setTimeout(() => {
        const current = rooms.get(id);
        if (current && current.clients.size === 0) {
            rooms.delete(id);
        }
    }, EMPTY_ROOM_TTL_MS);
}

function originAllowed(origin) {
    if (! origin) {
        return false;
    }

    if (ALLOWED_ORIGINS.includes(origin)) {
        return true;
    }

    if (process.env.NODE_ENV !== 'production') {
        return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    }

    return false;
}

function verifyRtToken(token, roomId) {
    if (! RT_SECRET || typeof token !== 'string' || typeof roomId !== 'string' || roomId === '') {
        return null;
    }

    const dot = token.indexOf('.');
    if (dot < 1) {
        return null;
    }

    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac('sha256', RT_SECRET).update(body).digest('hex');
    const left = Buffer.from(sig);
    const right = Buffer.from(expected);
    if (left.length !== right.length || ! timingSafeEqual(left, right)) {
        return null;
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        return null;
    }

    if (payload.r !== roomId || typeof payload.e !== 'number' || payload.e < Math.floor(Date.now() / 1000)) {
        return null;
    }

    return payload;
}

function peerFrom(payload, fallback = {}) {
    return {
        sid: String(payload?.u ?? fallback.sid ?? '').slice(0, 64),
        name: String(payload?.n ?? fallback.name ?? '').slice(0, 40),
        color: typeof fallback.color === 'string' ? fallback.color : '',
    };
}

function assignColor(room, sid) {
    const same = [...room.clients].find((client) => client.peer?.sid === sid && client.peer?.color);
    if (same) {
        return same.peer.color;
    }

    const used = new Set([...room.clients].map((client) => client.peer?.color).filter(Boolean));

    return CURSOR_COLORS.find((color) => ! used.has(color)) ?? CURSOR_COLORS[used.size % CURSOR_COLORS.length];
}

function rememberPeer(ws, sid, name) {
    const next = {
        sid: String(sid || ws.peer?.sid || '').slice(0, 64),
        name: String(name || ws.peer?.name || '').slice(0, 40),
        color: ws.peer?.color || '',
    };
    const prev = ws.peer ?? { sid: '', name: '', color: '' };
    if (prev.sid === next.sid && prev.name === next.name && prev.color === next.color) {
        return false;
    }

    ws.peer = next;

    return true;
}

function presenceOf(room) {
    const bySid = new Map();
    for (const client of room.clients) {
        const peer = client.peer;
        if (! peer?.sid || bySid.has(peer.sid)) {
            continue;
        }

        bySid.set(peer.sid, {
            sid: peer.sid,
            name: peer.name || '',
            color: peer.color || '',
        });
    }

    return {
        type: 'presence',
        peers: [...bySid.values()],
    };
}

function broadcastPresence(room) {
    const payload = presenceOf(room);
    for (const client of room.clients) {
        jsonSend(client, payload);
    }
}

function httpOpen(req, url) {
    if (url.pathname === '/health') {
        return true;
    }

    if (url.pathname === '/cache' && req.method === 'GET' && url.searchParams.has('alive')) {
        return true;
    }

    return originAllowed(req.headers.origin);
}

function upgradeAllowed(req, url) {
    if (! url.pathname.startsWith('/rt')) {
        return false;
    }

    if (! originAllowed(req.headers.origin)) {
        return false;
    }

    return verifyRtToken(url.searchParams.get('rt') ?? '', url.searchParams.get('id') ?? '') !== null;
}

function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && originAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error('payload too large'));
                req.destroy();

                return;
            }

            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function jsonSend(ws, payload) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
    }
}

const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (! httpOpen(req, url)) {
        res.writeHead(403).end();

        return;
    }

    cors(req, res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204).end();

        return;
    }

    if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('ok');

        return;
    }

    if (url.pathname === '/cache') {
        if (url.searchParams.has('alive')) {
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('1');

            return;
        }

        if (req.method === 'POST') {
            try {
                await readBody(req, MAX_MESSAGE_BYTES);
            } catch {
                res.writeHead(413).end();

                return;
            }

            res.writeHead(200).end();

            return;
        }

        res.writeHead(200, { 'content-type': 'application/json' }).end('[]');

        return;
    }

    res.writeHead(404).end();
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (! upgradeAllowed(req, url)) {
        process.stdout.write(`reject ${url.pathname} origin=${req.headers.origin || '-'} room=${url.searchParams.get('id') || '-'}\n`);
        socket.destroy();

        return;
    }

    sockets.handleUpgrade(req, socket, head, (ws) => {
        sockets.emit('connection', ws, req);
    });
});

sockets.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const id = url.searchParams.get('id') ?? '';
    const payload = verifyRtToken(url.searchParams.get('rt') ?? '', id);
    if (id === '' || payload === null) {
        ws.close(1008, 'room required');

        return;
    }

    const room = roomOf(id);
    if (room.clients.size >= MAX_CLIENTS_PER_ROOM) {
        ws.close(1013, 'room full');

        return;
    }

    const peer = peerFrom(payload);
    peer.color = assignColor(room, peer.sid);
    ws.peer = peer;
    room.clients.add(ws);
    process.stdout.write(`join ${id} n=${room.clients.size}\n`);

    if (room.lastXml) {
        jsonSend(ws, { type: 'xml', xml: room.lastXml });
    }

    broadcastPresence(room);

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(String(data));
        } catch {
            return;
        }

        if (msg?.type === 'sync-request') {
            if (room.lastXml) {
                jsonSend(ws, { type: 'xml', xml: room.lastXml });
            }

            return;
        }

        if (msg?.type === 'cursor') {
            if (typeof msg.x !== 'number' || typeof msg.y !== 'number') {
                return;
            }

            const cursor = {
                type: 'cursor',
                x: msg.x,
                y: msg.y,
                sid: ws.peer?.sid || (typeof msg.sid === 'string' ? msg.sid.slice(0, 64) : ''),
                name: ws.peer?.name || (typeof msg.name === 'string' ? msg.name.slice(0, 40) : ''),
                color: ws.peer?.color || '',
                pageId: typeof msg.pageId === 'string' ? msg.pageId.slice(0, 64) : '',
                hide: Boolean(msg.hide),
            };

            if (rememberPeer(ws, cursor.sid, cursor.name)) {
                broadcastPresence(room);
            }

            for (const peer of room.clients) {
                if (peer !== ws) {
                    jsonSend(peer, cursor);
                }
            }

            return;
        }

        if (msg?.type === 'selection') {
            const added = Array.isArray(msg.added) ? msg.added.slice(0, 50).map((id) => String(id).slice(0, 64)) : [];
            const removed = Array.isArray(msg.removed) ? msg.removed.slice(0, 50).map((id) => String(id).slice(0, 64)) : [];
            const selection = {
                type: 'selection',
                sid: ws.peer?.sid || (typeof msg.sid === 'string' ? msg.sid.slice(0, 64) : ''),
                name: ws.peer?.name || (typeof msg.name === 'string' ? msg.name.slice(0, 40) : ''),
                color: ws.peer?.color || '',
                pageId: typeof msg.pageId === 'string' ? msg.pageId.slice(0, 64) : '',
                added,
                removed,
            };

            if (rememberPeer(ws, selection.sid, selection.name)) {
                broadcastPresence(room);
            }

            for (const peer of room.clients) {
                if (peer !== ws) {
                    jsonSend(peer, selection);
                }
            }

            return;
        }

        if (msg?.type === 'diff' && msg.diff && typeof msg.diff === 'object' && ! Array.isArray(msg.diff)) {
            const encoded = JSON.stringify(msg.diff);
            if (Buffer.byteLength(encoded, 'utf8') > MAX_MESSAGE_BYTES) {
                return;
            }

            const diff = {
                type: 'diff',
                diff: msg.diff,
                pageId: typeof msg.pageId === 'string' ? msg.pageId.slice(0, 64) : '',
            };

            for (const peer of room.clients) {
                if (peer !== ws) {
                    jsonSend(peer, diff);
                }
            }

            return;
        }

        if (msg?.type === 'snapshot' && typeof msg.xml === 'string' && msg.xml.startsWith('<')) {
            if (Buffer.byteLength(msg.xml, 'utf8') > MAX_MESSAGE_BYTES) {
                return;
            }

            room.lastXml = msg.xml;

            return;
        }

        if (msg?.type !== 'xml' || typeof msg.xml !== 'string' || ! msg.xml.startsWith('<')) {
            return;
        }

        if (Buffer.byteLength(msg.xml, 'utf8') > MAX_MESSAGE_BYTES) {
            return;
        }

        room.lastXml = msg.xml;

        for (const peer of room.clients) {
            if (peer !== ws) {
                jsonSend(peer, { type: 'xml', xml: msg.xml });
            }
        }
    });

    ws.on('close', () => {
        room.clients.delete(ws);
        broadcastPresence(room);
        forgetIfEmpty(id, room);
    });
});

httpServer.listen(PORT, '0.0.0.0', () => {
    if (RT_SECRET === '') {
        process.stdout.write('DRAWIO_RT_SECRET is empty; every room join will be rejected\n');
    }

    if (ALLOWED_ORIGINS.length === 0) {
        process.stdout.write('DRAWIO_ORIGIN is empty; every room join will be rejected\n');
    }

    process.stdout.write(`listening ${PORT} max=${MAX_CLIENTS_PER_ROOM}\n`);
});
