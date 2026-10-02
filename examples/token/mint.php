<?php

declare(strict_types=1);

// Same bytes as examples/token/mint.mjs. The room server accepts either.
// php examples/token/mint.php d-demo 4 4102444800 "$DRAWIO_RT_SECRET" Ada
// php examples/token/mint.php --vector

function drawio_token_body(string $roomId, string $userId, int $expiresAt, string $who = ''): string
{
    $payload = ['r' => $roomId, 'u' => $userId, 'e' => $expiresAt];
    if ($who !== '') {
        $payload['n'] = $who;
    }

    $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

    return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
}

function drawio_mint_token(string $roomId, string $userId, int $expiresAt, string $secret, string $who = ''): string
{
    if ($secret === '') {
        return '';
    }

    $body = drawio_token_body($roomId, $userId, $expiresAt, $who);

    return $body.'.'.hash_hmac('sha256', $body, $secret);
}

if (PHP_SAPI === 'cli' && realpath($argv[0] ?? '') === realpath(__FILE__)) {
    if (($argv[1] ?? '') === '--vector') {
        $token = drawio_mint_token('d-1', '9', 4102444800, 'test-secret-for-rt');
        $expected = 'eyJyIjoiZC0xIiwidSI6IjkiLCJlIjo0MTAyNDQ0ODAwfQ.d12a76594d6a3be8a103f7cfc0619b96fcf32adcbc38ced512b7ea97db6d4991';
        if ($token !== $expected) {
            fwrite(STDERR, "vector mismatch\n{$token}\n");
            exit(1);
        }

        fwrite(STDOUT, "ok\n");
        exit(0);
    }

    $room = $argv[1] ?? '';
    $user = $argv[2] ?? '';
    $exp = isset($argv[3]) ? (int) $argv[3] : 0;
    $secret = $argv[4] ?? '';
    $who = $argv[5] ?? '';

    if ($room === '' || $user === '' || $exp === 0 || $secret === '') {
        fwrite(STDERR, "usage: php mint.php <room> <user-id> <expires-unix> <secret> [who]\n");
        exit(1);
    }

    fwrite(STDOUT, drawio_mint_token($room, $user, $exp, $secret, $who)."\n");
}
