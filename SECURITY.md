# Security

`DRAWIO_RT_SECRET` is the only thing that decides who may join a room.
Use a long random value (`openssl rand -hex 32`). Put the same value in
the draw.io compose environment and in the app that mints tokens. Do not
put the secret in browser JavaScript, in a diagram, or in git.

An empty secret is a closed door. The room server rejects every join.
Do not "fix" that by disabling the check.

A token is an HMAC of room id, user id, expiry, and first name. Anyone
who can read the iframe URL can use that token until it expires. Mint it
only after your own login check, and keep the lifetime short. The example
uses 8 hours. The example server has no login and binds to localhost for
that reason. Do not publish it on the internet.

The room server stores the latest diagram XML in memory and drops it 30
minutes after the last client leaves. That copy is not access control.
Your app still decides who may open the file.

`/health` and `/cache?alive=1` are open on purpose. The editor will not
finish starting if `/cache?alive=1` is blocked. Do not put the diagram
bytes on those URLs.

Report vulnerabilities privately to the maintainers of the repository
you cloned. This file does not list a disclosure address until one is
published with the repository.
