import { createHmac } from 'node:crypto';

// Room token shared by the editor host and the app that embeds it.
// The room server checks this string. It does not call back into the app.
// Body bytes are HMAC-SHA256 with DRAWIO_RT_SECRET. Key order is r, u, e, n.

export function tokenBody(roomId, userId, expiresAt, who = '') {
    const payload = {
        r: roomId,
        u: String(userId),
        e: expiresAt,
    };

    if (who !== '') {
        payload.n = who;
    }

    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function mintToken(roomId, userId, expiresAt, secret, who = '') {
    if (!secret) {
        return '';
    }

    const body = tokenBody(roomId, userId, expiresAt, who);
    const sig = createHmac('sha256', secret).update(body).digest('hex');

    return `${body}.${sig}`;
}
