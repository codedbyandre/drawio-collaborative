#!/usr/bin/env python3
"""Same token as examples/token/mint.mjs. Usage:

    python3 mint.py d-demo 4 4102444800 "$DRAWIO_RT_SECRET" Ada
    python3 mint.py --vector
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys


def token_body(room_id: str, user_id: str, expires_at: int, who: str = "") -> str:
    payload: dict[str, object] = {"r": room_id, "u": user_id, "e": expires_at}
    if who:
        payload["n"] = who
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def mint_token(room_id: str, user_id: str, expires_at: int, secret: str, who: str = "") -> str:
    if secret == "":
        return ""
    body = token_body(room_id, user_id, expires_at, who)
    sig = hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--vector":
        token = mint_token("d-1", "9", 4102444800, "test-secret-for-rt")
        expected = (
            "eyJyIjoiZC0xIiwidSI6IjkiLCJlIjo0MTAyNDQ0ODAwfQ."
            "d12a76594d6a3be8a103f7cfc0619b96fcf32adcbc38ced512b7ea97db6d4991"
        )
        if token != expected:
            print(token, file=sys.stderr)
            raise SystemExit(1)
        print("ok")
        return

    if len(sys.argv) < 5:
        print("usage: mint.py <room> <user-id> <expires-unix> <secret> [who]", file=sys.stderr)
        raise SystemExit(1)

    who = sys.argv[5] if len(sys.argv) > 5 else ""
    print(mint_token(sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], who))


if __name__ == "__main__":
    main()
