import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mintToken, tokenBody } from './mint.mjs';

const SECRET = 'test-secret-for-rt';

test('matches the known PHP and Node vector', () => {
    const body = tokenBody('d-1', '9', 4102444800);
    const token = mintToken('d-1', '9', 4102444800, SECRET);

    assert.equal(body, 'eyJyIjoiZC0xIiwidSI6IjkiLCJlIjo0MTAyNDQ0ODAwfQ');
    assert.equal(
        token,
        'eyJyIjoiZC0xIiwidSI6IjkiLCJlIjo0MTAyNDQ0ODAwfQ.d12a76594d6a3be8a103f7cfc0619b96fcf32adcbc38ced512b7ea97db6d4991',
    );
});

test('mints nothing when the secret is empty', () => {
    assert.equal(mintToken('d-1', '9', 4102444800, ''), '');
});

test('embeds the first name', () => {
    const token = mintToken('d-12', '4', 4102444800, SECRET, 'Ada');
    const body = token.split('.')[0];
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));

    assert.equal(json.n, 'Ada');
    assert.equal(json.r, 'd-12');
    assert.equal(json.u, '4');
});
