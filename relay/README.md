# macOS iMessage relay contract

The relay is a user-owned bridge. Run it only on a Mac signed into Messages. It never belongs on GRASS10 and is not a fake delivery service.

## Authentication

Every endpoint requires `Authorization: Bearer <IMESSAGE_RELAY_TOKEN>`. Use a random token of at least 24 characters and expose the relay only over a trusted LAN, VPN, or a user-managed TLS reverse proxy. The server does not provide TLS.

## Endpoints

- `GET /health` returns `200 {"ok":true,"platform":"darwin"}` when reachable.
- `POST /v1/messages` accepts `{"recipient":"...","body":"...","reviewToken":"..."}` and returns `201 {"id":"..."}`. `reviewToken` is accepted as request metadata but is not persisted by the minimal relay.
- `GET /v1/messages?sender=<address>&since=<ISO-8601>` returns `200 {"messages":[{"id":"...","sender":"...","body":"...","receivedAt":"..."}]}`.

The worker treats non-2xx responses as delivery/read failures and never approves from a reply with the wrong sender, old timestamp, malformed text, or wrong homepage ID.

## macOS setup

1. Install Node.js 20+ and ensure `/usr/bin/osascript` and `/usr/bin/sqlite3` are available.
2. Sign into Messages and send one manual iMessage to the intended reviewer.
3. Give the terminal/runtime Automation permission for Messages and Full Disk Access for reading `~/Library/Messages/chat.db`.
4. In `relay/`, run:

   ```bash
   export IMESSAGE_RELAY_TOKEN="$(openssl rand -hex 32)"
   export RELAY_HOST="0.0.0.0"
   export RELAY_PORT="8787"
   npm start
   ```

5. From GRASS10, confirm `curl -H "Authorization: Bearer $TOKEN" http://MAC-IP:8787/health` works. Put that URL, token, and the exact recipient phone/email in the repository `.env`.

macOS privacy controls or Messages schema changes can block reading. Fix those on the Mac; do not bypass the approval gate.
