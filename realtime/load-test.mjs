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
const CLIENTS = 24;
const dir = path.dirname(fileURLToPath(import.meta.url));

function mint(room, uid) {
    const body = Buffer.from(JSON.stringify({
        r: room,
        u: String(uid),
        n: `User${uid}`,
        e: 4102444800,
    })).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');

    return `${body}.${sig}`;
}

async function startServer() {
    const port = 19000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['server.mjs'], {
        cwd: dir,
        env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: 'test',
            DRAWIO_ORIGIN: 'https://drawio.example.com',
            DRAWIO_RT_SECRET: SECRET,
            DRAWIO_RT_MAX_CLIENTS: '32',
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

function connect(port, room, uid) {
    const token = mint(room, uid);
    const ws = new WsClient(`ws://127.0.0.1:${port}/rt?id=${encodeURIComponent(room)}&rt=${encodeURIComponent(token)}`, {
        headers: { Origin: 'https://drawio.example.com' },
    });
    const bag = { diff: [], xml: [], presence: [], cursor: [], selection: [], finishedAt: null };

    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        bag[msg.type]?.push(msg);
        if (msg.type === 'diff' && bag.diff.length === CLIENTS - 1 && bag.finishedAt === null) {
            bag.finishedAt = Date.now();
        }
    });

    return { ws, bag, uid };
}

async function opened(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        return;
    }

    await once(ws, 'open');
}

function pageDiff(uid) {
    const pageId = `page-${uid}`;

    return {
        type: 'diff',
        pageId,
        diff: {
            inserted: {
                [pageId]: {
                    name: `Seite ${uid}`,
                    root: { id: `root-${uid}` },
                },
            },
        },
    };
}

test('24 editors can join, add pages, and receive every foreign change', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const room = 'room-load';
    const clients = Array.from({ length: CLIENTS }, (_, index) => connect(port, room, index + 1));
    await Promise.all(clients.map((client) => opened(client.ws)));
    await sleep(150);

    const roster = clients[0].bag.presence.at(-1);
    assert.ok(roster);
    assert.equal(roster.peers.length, CLIENTS);

    const started = Date.now();
    for (const client of clients) {
        client.ws.send(JSON.stringify(pageDiff(client.uid)));
    }

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const done = clients.every((client) => client.bag.diff.length >= CLIENTS - 1);
        if (done) {
            break;
        }

        await sleep(20);
    }

    const elapsed = Date.now() - started;
    const latencies = clients
        .map((client) => (client.bag.finishedAt ?? elapsed + started) - started)
        .sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? null;

    for (const client of clients) {
        assert.equal(client.bag.diff.length, CLIENTS - 1, `user ${client.uid} missed diffs`);
        assert.equal(client.bag.xml.length, 0, `user ${client.uid} got a full xml fan-out`);
        const pages = new Set(client.bag.diff.map((msg) => msg.pageId));
        assert.equal(pages.size, CLIENTS - 1);
        assert.equal(pages.has(`page-${client.uid}`), false);
    }

    assert.ok(elapsed < 1500, `fan-out took ${elapsed}ms`);
    assert.ok(p95 !== null && p95 < 250, `p95 latency ${p95}ms`);

    const lastXml = `<mxfile><diagram id="final">last-write-${Date.now()}</diagram></mxfile>`;
    clients[0].ws.send(JSON.stringify({ type: 'snapshot', xml: lastXml }));
    await sleep(80);
    assert.equal(clients[1].bag.xml.length, 0);

    clients.forEach((client) => client.ws.close());

    const late = connect(port, room, 99);
    await opened(late.ws);
    await sleep(120);
    assert.equal(late.bag.xml[0]?.xml, lastXml);
    assert.equal(late.bag.diff.length, 0);
    late.ws.close();

    process.stdout.write(`load 24: elapsed=${elapsed}ms p95=${p95}ms diffs=${CLIENTS * (CLIENTS - 1)}\n`);
});

test('concurrent snapshots last-write-wins for late joiners', async (t) => {
    const { child, port } = await startServer();
    t.after(() => {
        child.kill('SIGTERM');
    });

    const room = 'room-snap';
    const clients = Array.from({ length: 8 }, (_, index) => connect(port, room, index + 1));
    await Promise.all(clients.map((client) => opened(client.ws)));
    await sleep(80);

    const snapshots = clients.map((client, index) => `<mxfile><diagram id="p">snap-${index + 1}</diagram></mxfile>`);
    clients.forEach((client, index) => {
        client.ws.send(JSON.stringify({ type: 'snapshot', xml: snapshots[index] }));
    });
    await sleep(80);

    for (const client of clients) {
        assert.equal(client.bag.xml.length, 0);
    }

    clients.forEach((client) => client.ws.close());

    const late = connect(port, room, 99);
    await opened(late.ws);
    await sleep(120);
    assert.ok(snapshots.includes(late.bag.xml[0]?.xml));
    late.ws.close();
});
