import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'test-secret-for-rt';

async function start() {
    const data = await mkdtemp(path.join(tmpdir(), 'drawio-embed-'));
    const port = 21000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['server.mjs'], {
        cwd: dir,
        env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
            DRAWIO_RT_SECRET: SECRET,
            DRAWIO_EMBED_URL: 'https://drawio.example.com',
            DATA_DIR: data,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
        child.stdout.on('data', (buf) => {
            if (String(buf).includes('listening')) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`server exited ${code}`));
        });
    });

    return {
        port,
        data,
        async stop() {
            child.kill('SIGTERM');
            await Promise.race([
                once(child, 'exit'),
                new Promise((resolve) => setTimeout(resolve, 500)),
            ]);
            await rm(data, { recursive: true, force: true });
        },
    };
}

test('session URL uses the Nextcloud plugin and a signed room token', async (t) => {
    const server = await start();
    t.after(() => server.stop());

    const response = await fetch(`http://127.0.0.1:${server.port}/api/session?name=Ada&room=demo`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const url = new URL(body.iframeUrl);

    assert.equal(url.origin, 'https://drawio.example.com');
    assert.equal(url.searchParams.get('p'), 'nxtcld');
    assert.equal(url.searchParams.get('proto'), 'json');
    assert.equal(url.searchParams.get('sync'), 'manual');
    assert.equal(url.searchParams.get('embed'), '1');
    assert.equal(url.searchParams.get('room'), 'd-demo');
    assert.equal(url.searchParams.get('who'), 'Ada');
    assert.equal(url.searchParams.get('uid'), 'ada');

    const token = url.searchParams.get('rt');
    const dot = token.indexOf('.');
    const tokenBody = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac('sha256', SECRET).update(tokenBody).digest('hex');
    assert.equal(sig, expected);
    const payload = JSON.parse(Buffer.from(tokenBody, 'base64url').toString('utf8'));
    assert.equal(payload.r, 'd-demo');
    assert.equal(payload.u, 'ada');
    assert.equal(payload.n, 'Ada');
});

test('saves a diagram and reads it back', async (t) => {
    const server = await start();
    t.after(() => server.stop());
    const xml = '<mxfile><diagram id="page-1" name="Page-1">x</diagram></mxfile>';
    const saved = await fetch(`http://127.0.0.1:${server.port}/api/file?room=demo`, {
        method: 'PUT',
        body: xml,
    });
    assert.equal(saved.status, 200);
    const loaded = await fetch(`http://127.0.0.1:${server.port}/api/file?room=demo`);
    const info = await loaded.json();
    assert.equal(info.xml, xml);
    assert.equal(info.writeable, true);
    assert.equal(info.id, 'd-demo');
});

test('refuses the placeholder secret', async (t) => {
    const port = 22000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['server.mjs'], {
        cwd: dir,
        env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
            DRAWIO_RT_SECRET: 'replace-me',
            DRAWIO_EMBED_URL: 'https://drawio.example.com',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => child.kill('SIGTERM'));
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
        child.stdout.on('data', (buf) => {
            if (String(buf).includes('listening')) {
                clearTimeout(timer);
                resolve();
            }
        });
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/session?name=Ada&room=demo`);
    assert.equal(response.status, 500);
});
