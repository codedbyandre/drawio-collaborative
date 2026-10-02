// Parent page for the draw.io Nextcloud embed plugin (URL parameter p=nxtcld).
// The editor never writes the file itself. It asks this page, and this page
// writes the diagram. Live shapes go through the room socket, not through here.

const statusEl = document.getElementById('status');
const peersEl = document.getElementById('peers');
let editorOrigin = '';
let room = '';
let etag = '';
let iframeWindow = null;

function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = isError ? 'error' : '';
}

function readMessage(data) {
    if (!data) {
        return null;
    }

    if (typeof data === 'string') {
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    return typeof data === 'object' ? data : null;
}

function post(payload) {
    if (!iframeWindow) {
        return;
    }

    iframeWindow.postMessage(JSON.stringify(payload), editorOrigin);
}

async function loadFile() {
    const response = await fetch(`/api/file?room=${encodeURIComponent(room)}`);
    if (!response.ok) {
        throw new Error('Could not load the diagram');
    }

    const data = await response.json();
    etag = data.etag || '';

    return data;
}

async function saveFile(xml) {
    const response = await fetch(`/api/file?room=${encodeURIComponent(room)}`, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: xml,
    });
    if (!response.ok) {
        throw new Error('Could not save the diagram');
    }

    const data = await response.json();
    etag = data.etag || etag;

    return data;
}

function sendResponse(msg, resp, error) {
    const payload = { action: 'remoteInvokeResponse', msgMarkers: msg.msgMarkers };
    if (error != null) {
        payload.error = { errResp: String(error) };
    } else if (resp != null) {
        payload.resp = resp;
    }

    post(payload);
}

const remote = {
    async getFileInfo(_fileId, _shareToken, success, error) {
        try {
            success(await loadFile());
        } catch (err) {
            error(err.message);
        }
    },
    async loadFile(_fileId, _shareToken, success, error) {
        try {
            success(await loadFile());
        } catch (err) {
            error(err.message);
        }
    },
    async getFileRevisions(_fileId, success) {
        success([]);
    },
    async loadFileVersion(_fileId, _revId, _success, error) {
        error('This example keeps one file, not a revision list.');
    },
    async saveFile(_id, _shareToken, fileContents, _incomingEtag, success, error) {
        if (typeof fileContents !== 'string' || !fileContents.startsWith('<')) {
            error('Invalid file contents');

            return;
        }

        try {
            // Last write wins on purpose. A strict etag check here surfaces
            // "Document modified by another user" while the room is already
            // showing both people's shapes. The room is the live merge.
            // This request is only the saved copy.
            success(await saveFile(fileContents));
            setStatus(`Saved ${new Date().toLocaleTimeString()}`);
        } catch (err) {
            error(err.message);
        }
    },
    getCurrentUser() {
        return { uid: document.getElementById('name').value, displayName: document.getElementById('name').value };
    },
};

function handleRemoteInvoke(msg) {
    // draw.io spells the field funtionName. Keep the typo.
    const name = msg.funtionName;
    const fn = remote[name];
    if (typeof fn !== 'function') {
        sendResponse(msg, null, `Invalid Call. Function "${name}" Not Found.`);

        return;
    }

    const args = Array.isArray(msg.functionArgs) ? msg.functionArgs.slice() : [];
    if (name === 'saveFile' && args.length === 3) {
        args.splice(1, 0, null);
    }

    const asyncNames = new Set(['getFileInfo', 'loadFile', 'saveFile', 'getFileRevisions', 'loadFileVersion']);
    if (asyncNames.has(name)) {
        args.push((...returned) => sendResponse(msg, returned));
        args.push((err) => sendResponse(msg, null, err || 'Unknown Error'));
        fn(...args);

        return;
    }

    sendResponse(msg, [fn(...args)]);
}

async function onEditorMessage(event) {
    if (editorOrigin && event.origin !== editorOrigin) {
        return;
    }

    const message = readMessage(event.data);
    if (!message) {
        return;
    }

    const kind = message.event || message.action;

    if (kind === 'configure') {
        post({
            action: 'configure',
            config: {
                autosave: 1,
                modified: true,
                shareCursorPosition: true,
                showRemoteCursors: true,
                compressXml: true,
                enableAi: false,
                lockdown: false,
            },
        });

        return;
    }

    if (kind === 'init') {
        try {
            const data = await loadFile();
            post({
                action: 'load',
                autosave: true,
                title: data.name,
                xml: data.xml,
                desc: data,
                disableAutoSave: false,
            });
            post({ action: 'remoteInvokeReady' });
            setStatus('Editor ready. Draw in the other window.');
        } catch (error) {
            setStatus(error.message, true);
        }

        return;
    }

    if (kind === 'remoteInvoke') {
        handleRemoteInvoke(message);

        return;
    }

    if (kind === 'drawioPeers' && Array.isArray(message.peers)) {
        const names = message.peers.map((peer) => peer.name || peer.sid).filter(Boolean);
        peersEl.textContent = names.length ? `In this room: ${names.join(', ')}` : '';
    }
}

document.getElementById('open').addEventListener('click', async () => {
    const name = document.getElementById('name').value.trim();
    const requestedRoom = document.getElementById('room').value.trim();
    if (!name) {
        setStatus('Enter a first name. The second window needs a different name.', true);

        return;
    }

    const response = await fetch(`/api/session?name=${encodeURIComponent(name)}&room=${encodeURIComponent(requestedRoom)}`);
    const data = await response.json();
    if (!response.ok) {
        setStatus(data.error || 'Could not open a session', true);

        return;
    }

    editorOrigin = data.origin;
    room = data.room;
    const wrap = document.getElementById('frame-wrap');
    wrap.replaceChildren();
    const iframe = document.createElement('iframe');
    iframe.id = 'diagram-frame';
    iframe.title = 'draw.io editor';
    wrap.appendChild(iframe);
    iframeWindow = iframe.contentWindow;
    iframe.src = data.iframeUrl;
    setStatus('Loading the editor…');
});

window.addEventListener('message', onEditorMessage);
