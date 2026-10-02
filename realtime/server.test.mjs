import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket as WsClient } from 'ws';

const SECRET = 'test-secret-for-rt';
const KNOWN_TOKEN = 'eyJyIjoiZC0xIiwidSI6IjkiLCJlIjo0MTAyNDQ0ODAwfQ.d12a76594d6a3be8a103f7cfc0619b96fcf32adcbc38ced512b7ea97db6d4991';

function mint(room, uid = '9', exp = 4102444800, name = '') {
    const payload = { r: room, u: uid, e: exp };
    if (name) {
        payload.n = name;
    }

    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');

    return `${body}.${sig}`;
}

const dir = path.dirname(fileURLToPath(import.meta.url));

async function startServer(extraEnv = {}) {
    const port = 18000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['server.mjs'], {
        cwd: dir,
        env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: 'test',
            DRAWIO_ORIGIN: 'https://drawio.example.com',
            DRAWIO_RT_SECRET: SECRET,
            ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
        const onData = (buf) => {
            if (String(buf).includes('listening')) {
                clearTimeout(timer);
                resolve();
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', () => {});
        child.once('error', reject);
        child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`server exited ${code}`));
        });
    });

    return { child, port };
}

function connect(port, room, token = mint(room), origin = 'https://drawio.example.com') {
    return new WsClient(`ws://127.0.0.1:${port}/rt?id=${encodeURIComponent(room)}&rt=${encodeURIComponent(token)}`, {
        headers: { Origin: origin },
    });
}

async function opened(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        return;
    }

    await once(ws, 'open');
}

function parseEvent(event) {
    return JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
}

function waitMessage(ws, timeoutMs) {
    return new Promise((resolve) => {
        const onMsg = (event) => {
            clearTimeout(timer);
            ws.removeEventListener('message', onMsg);
            resolve(parseEvent(event));
        };
        const timer = setTimeout(() => {
            ws.removeEventListener('message', onMsg);
            resolve(null);
        }, timeoutMs);
        ws.addEventListener('message', onMsg);
    });
}

async function nextMessage(ws) {
    const msg = await waitMessage(ws, 2000);
    if (msg === null) {
        throw new Error('timed out waiting for message');
    }

    return msg;
}

async function flushInbox(ws, ms = 80) {
    const messages = [];
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const msg = await waitMessage(ws, Math.max(1, deadline - Date.now()));
        if (msg === null) {
            break;
        }

        messages.push(msg);
    }

    return messages;
}

async function join(ws) {
    const messages = [];
    const onMsg = (event) => {
        messages.push(parseEvent(event));
    };
    ws.addEventListener('message', onMsg);
    await opened(ws);
    await sleep(80);
    ws.removeEventListener('message', onMsg);

    return messages;
}

function nextOfType(ws, type, timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.removeEventListener('message', onMsg);
            reject(new Error(`timed out waiting for ${type}`));
        }, timeoutMs);
        const onMsg = (event) => {
            const msg = parseEvent(event);
            if (msg.type !== type) {
                return;
            }

            clearTimeout(timer);
            ws.removeEventListener('message', onMsg);
            resolve(msg);
        };
        ws.addEventListener('message', onMsg);
    });
}

test('relays xml to the other client and late joiners', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const alive = await fetch(`http://127.0.0.1:${port}/cache?alive=1`);
    assert.equal(alive.status, 200);
    assert.equal(await alive.text(), '1');

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(await health.text(), 'ok');

    const a = connect(port, 'room-a');
    const b = connect(port, 'room-a');
    await Promise.all([join(a), join(b)]);

    const xml = '<mxGraphModel><root/></mxGraphModel>';
    const got = nextMessage(b);
    a.send(JSON.stringify({ type: 'xml', xml }));
    assert.deepEqual(await got, { type: 'xml', xml });

    a.close();
    b.close();

    const late = connect(port, 'room-a');
    const inbox = await join(late);
    assert.deepEqual(inbox.find((msg) => msg.type === 'xml'), { type: 'xml', xml });
    late.close();

    await sleep(50);
});

test('relays cursor positions without storing them as last xml', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const a = connect(port, 'room-c', mint('room-c', 'ada', 4102444800, 'Ada'));
    await join(a);
    const b = connect(port, 'room-c', mint('room-c', 'ben', 4102444800, 'Ben'));
    await join(b);

    const got = nextOfType(b, 'cursor');
    a.send(JSON.stringify({ type: 'cursor', x: 12, y: 34, sid: 'ignored', name: 'Ignored', pageId: 'p1' }));
    assert.deepEqual(await got, {
        type: 'cursor',
        x: 12,
        y: 34,
        sid: 'ada',
        name: 'Ada',
        color: '#e6194b',
        pageId: 'p1',
        hide: false,
    });

    a.close();
    b.close();

    const late = connect(port, 'room-c');
    await opened(late);
    const inbox = await flushInbox(late, 150);
    assert.deepEqual(inbox.filter((msg) => msg.type !== 'presence'), []);
    late.close();
});

test('keeps health and alive probes open without an origin', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok');

    const foreignHealth = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: 'https://evil.example' },
    });
    assert.equal(foreignHealth.status, 200);

    const alive = await fetch(`http://127.0.0.1:${port}/cache?alive=1`);
    assert.equal(alive.status, 200);
    assert.equal(await alive.text(), '1');
});

test('rejects a foreign origin on /cache', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const res = await fetch(`http://127.0.0.1:${port}/cache`, {
        headers: { Origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
});

test('rejects a socket without a room token', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/rt?id=d-1`);
    const closed = Promise.race([
        once(ws, 'open').then(() => 'open'),
        once(ws, 'close').then(() => 'close'),
        once(ws, 'error').then(() => 'error'),
        sleep(500).then(() => 'timeout'),
    ]);
    assert.notEqual(await closed, 'open');
    ws.close();
});

test('rejects a token minted for another room', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const ws = connect(port, 'd-1', mint('d-2'));
    let opened = false;
    ws.on('error', () => {});
    ws.on('open', () => {
        opened = true;
    });
    await sleep(200);
    assert.equal(opened, false);
    ws.close();
});

test('rejects a socket with a valid token and no origin', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/rt?id=d-1&rt=${encodeURIComponent(mint('d-1'))}`);
    const closed = Promise.race([
        once(ws, 'open').then(() => 'open'),
        once(ws, 'close').then(() => 'close'),
        once(ws, 'error').then(() => 'error'),
        sleep(500).then(() => 'timeout'),
    ]);
    assert.notEqual(await closed, 'open');
    ws.close();
});

test('rejects a foreign origin even with a valid token', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const ws = new WsClient(`ws://127.0.0.1:${port}/rt?id=d-1&rt=${encodeURIComponent(mint('d-1'))}`, {
        headers: { Origin: 'https://evil.example' },
    });
    let opened = false;
    ws.on('error', () => {});
    ws.on('open', () => {
        opened = true;
    });
    await sleep(200);
    assert.equal(opened, false);
    ws.close();
});

test('accepts the PHP known-vector token', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const ws = connect(port, 'd-1', KNOWN_TOKEN);
    await opened(ws);
    ws.close();
});

test('relays page diffs without storing them as last xml', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const a = connect(port, 'room-d');
    const b = connect(port, 'room-d');
    await Promise.all([join(a), join(b)]);

    const diff = { u: { 'page-1': { name: 'Page-2' } } };
    const got = nextMessage(b);
    a.send(JSON.stringify({ type: 'diff', diff, pageId: 'page-1' }));
    assert.deepEqual(await got, { type: 'diff', diff, pageId: 'page-1' });

    a.close();
    b.close();

    const late = connect(port, 'room-d');
    await opened(late);
    const inbox = await flushInbox(late, 150);
    assert.deepEqual(inbox.filter((msg) => msg.type !== 'presence'), []);
    late.close();
});

test('stores snapshots for late joiners without broadcasting them', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const a = connect(port, 'room-s');
    const b = connect(port, 'room-s');
    await Promise.all([join(a), join(b)]);

    const xml = '<mxfile><diagram id="p1">x</diagram></mxfile>';
    const leaked = Promise.race([
        nextMessage(b).then(() => 'got'),
        sleep(120).then(() => 'none'),
    ]);
    a.send(JSON.stringify({ type: 'snapshot', xml }));
    assert.equal(await leaked, 'none');

    a.close();
    b.close();

    const late = connect(port, 'room-s');
    const inbox = await join(late);
    assert.deepEqual(inbox.find((msg) => msg.type === 'xml'), { type: 'xml', xml });
    late.close();
});

test('relays selection changes without storing them', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const a = connect(port, 'room-sel', mint('room-sel', 'ada', 4102444800, 'Ada'));
    await join(a);
    const b = connect(port, 'room-sel', mint('room-sel', 'ben', 4102444800, 'Ben'));
    await join(b);

    const got = nextOfType(b, 'selection');
    a.send(JSON.stringify({
        type: 'selection',
        sid: 'ignored',
        name: 'Ignored',
        pageId: 'p1',
        added: ['c1'],
        removed: ['c0'],
    }));
    assert.deepEqual(await got, {
        type: 'selection',
        sid: 'ada',
        name: 'Ada',
        color: '#e6194b',
        pageId: 'p1',
        added: ['c1'],
        removed: ['c0'],
    });

    a.close();
    b.close();
});

test('broadcasts who is in the room', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const a = connect(port, 'room-p', mint('room-p', '1', 4102444800, 'Ada'));
    await join(a);
    const b = connect(port, 'room-p', mint('room-p', '2', 4102444800, 'Ben'));
    const seen = [];
    const onPresence = (event) => {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        if (msg.type === 'presence') {
            seen.push(msg);
        }
    };
    b.addEventListener('message', onPresence);
    await Promise.all([opened(a), opened(b)]);
    await sleep(120);
    b.removeEventListener('message', onPresence);

    const latest = seen.findLast((msg) => msg.peers.length === 2) ?? seen.at(-1);
    assert.ok(latest);
    assert.deepEqual(
        [...latest.peers].sort((left, right) => left.sid.localeCompare(right.sid)),
        [
            { sid: '1', name: 'Ada', color: '#e6194b' },
            { sid: '2', name: 'Ben', color: '#3cb44b' },
        ],
    );

    a.close();
    b.close();
});

test('one roster row and one color for two sockets of the same user', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const first = connect(port, 'room-dup', mint('room-dup', 'ada', 4102444800, 'Ada'));
    await join(first);
    const second = connect(port, 'room-dup', mint('room-dup', 'ada', 4102444800, 'Ada'));
    const inbox = await join(second);
    const presence = inbox.filter((msg) => msg.type === 'presence').at(-1);

    assert.deepEqual(presence?.peers, [
        { sid: 'ada', name: 'Ada', color: '#e6194b' },
    ]);

    first.close();
    second.close();
});

test('rejects the 33rd client when the room is full', async (t) => {
    const { child, port } = await startServer({ DRAWIO_RT_MAX_CLIENTS: '2' });
    t.after(() => {
        child.kill('SIGTERM');
    });

    const a = connect(port, 'room-full');
    const b = connect(port, 'room-full');
    await Promise.all([opened(a), opened(b)]);

    const extra = connect(port, 'room-full');
    extra.addEventListener('error', () => {});
    await Promise.race([
        once(extra, 'open'),
        once(extra, 'close'),
        sleep(300),
    ]);
    await sleep(50);
    assert.notEqual(extra.readyState, WebSocket.OPEN);
    extra.close();
    a.close();
    b.close();
});
