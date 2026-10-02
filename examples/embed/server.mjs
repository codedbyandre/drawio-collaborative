import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintToken } from '../token/mint.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(root, 'data');
const publicDir = path.join(root, 'public');
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const secret = process.env.DRAWIO_RT_SECRET ?? '';
const embedUrl = String(process.env.DRAWIO_EMBED_URL ?? '').replace(/\/$/, '');
const host = process.env.HOST ?? '127.0.0.1';

const BLANK = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="embed" agent="drawio-collaborative">
  <diagram id="page-1" name="Page-1">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

function fail(res, status, message) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: message }));
}

export function roomId(raw) {
    const name = String(raw || 'demo').trim();
    const id = name.startsWith('d-') ? name : `d-${name}`;

    if (!/^d-[A-Za-z0-9_-]{1,80}$/.test(id)) {
        return null;
    }

    return id;
}

function userId(name) {
    const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '');

    return slug.slice(0, 64) || 'guest';
}

function firstName(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim();

    return clean === '' ? 'Guest' : clean.split(' ')[0].slice(0, 40);
}

function filePath(room) {
    return path.join(dataDir, `${room}.drawio`);
}

async function readDiagram(room) {
    try {
        const xml = await readFile(filePath(room), 'utf8');

        return xml.startsWith('<') ? xml : BLANK;
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return BLANK;
        }

        throw error;
    }
}

async function writeDiagram(room, xml) {
    await mkdir(dataDir, { recursive: true });
    const target = filePath(room);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, xml, 'utf8');
    await rename(tmp, target);
}

function etagOf(xml) {
    return createHash('sha256').update(xml).digest('hex').slice(0, 16);
}

function fileInfo(room, xml) {
    return {
        id: room,
        name: `${room}.drawio`,
        etag: etagOf(xml),
        mtime: Date.now(),
        size: Buffer.byteLength(xml),
        ver: 1,
        versionsEnabled: false,
        writeable: true,
        instanceId: room,
        xml,
    };
}

export function iframeUrl({ embed, room, who, uid, token }) {
    const params = new URLSearchParams({
        embed: '1',
        embedRT: '1',
        sync: 'manual',
        keepModified: '1',
        lang: 'en',
        ui: 'kennedy',
        configure: '1',
        libraries: '1',
        plugins: '1',
        p: 'nxtcld',
        proto: 'json',
        saveAndExit: '0',
        noSaveBtn: '1',
        noExitBtn: '1',
        room,
        who,
        uid,
        rt: token,
    });

    return `${embed}/?${params.toString()}`;
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(Object.assign(new Error('too large'), { status: 413 }));
                req.destroy();

                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function send(res, status, body, type) {
    res.writeHead(status, { 'content-type': type }).end(body);
}

function configured(res) {
    if (secret === '' || secret === 'replace-me') {
        fail(res, 500, 'DRAWIO_RT_SECRET is missing. Use the same value as the draw.io host.');

        return false;
    }

    if (embedUrl === '') {
        fail(res, 500, 'DRAWIO_EMBED_URL is missing. Example: https://drawio.example.com');

        return false;
    }

    return true;
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    try {
        if (req.method === 'GET' && url.pathname === '/favicon.ico') {
            res.writeHead(204).end();

            return;
        }

        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/parent.js')) {
            const file = url.pathname === '/' ? 'index.html' : 'parent.js';
            const body = await readFile(path.join(publicDir, file));
            const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
            send(res, 200, body, type);

            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/session') {
            if (!configured(res)) {
                return;
            }

            const room = roomId(url.searchParams.get('room'));
            const name = String(url.searchParams.get('name') || '').trim();
            if (!room || name === '') {
                fail(res, 400, 'name and a room of letters, numbers, _ and - are required');

                return;
            }

            const who = firstName(name);
            const uid = userId(name);
            const token = mintToken(room, uid, Math.floor(Date.now() / 1000) + (8 * 60 * 60), secret, who);
            send(res, 200, JSON.stringify({
                iframeUrl: iframeUrl({ embed: embedUrl, room, who, uid, token }),
                origin: new URL(embedUrl).origin,
                room,
                who,
                uid,
            }), 'application/json; charset=utf-8');

            return;
        }

        if (url.pathname === '/api/file') {
            if (!configured(res)) {
                return;
            }

            const room = roomId(url.searchParams.get('room'));
            if (!room) {
                fail(res, 400, 'room required');

                return;
            }

            if (req.method === 'GET') {
                send(res, 200, JSON.stringify(fileInfo(room, await readDiagram(room))), 'application/json; charset=utf-8');

                return;
            }

            if (req.method === 'PUT') {
                const xml = await readBody(req, 8 * 1024 * 1024);
                if (!xml.startsWith('<')) {
                    fail(res, 400, 'diagram XML must start with <');

                    return;
                }

                await writeDiagram(room, xml);
                const info = fileInfo(room, xml);
                send(res, 200, JSON.stringify({
                    success: true,
                    etag: info.etag,
                    size: info.size,
                    mtime: info.mtime,
                }), 'application/json; charset=utf-8');

                return;
            }
        }

        fail(res, 404, 'not found');
    } catch (error) {
        const status = error && error.status ? error.status : 500;
        fail(res, status, error instanceof Error ? error.message : 'error');
    }
});

server.listen(port, host, () => {
    process.stdout.write(`listening ${host}:${port}\nOpen http://localhost:${port} or http://127.0.0.1:${port}\n`);
});
