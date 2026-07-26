# Windows workflow, Mac Messages relay, and scheduling runbook

This deployment runs the homepage workflow on Windows and the integrated
Messages relay on a private Mac signed into Messages. The relay has no model
provider and cannot approve a homepage; it only delivers messages and returns
replies.

## Mac relay setup

1. Install Node.js 20+, clone this repository, and run `npm ci`.
2. Create a relay-only `.env` containing:

   ```dotenv
   IMESSAGE_RELAY_TOKEN=replace-with-at-least-24-random-characters
   IMESSAGE_RECIPIENT=+15551234567
   IMESSAGE_RELAY_TIMEOUT_MS=30000
   IMESSAGE_RELAY_LISTEN_HOST=0.0.0.0
   IMESSAGE_RELAY_LISTEN_PORT=8787
   IMESSAGE_RELAY_DATA_DIR=relay-data
   IMESSAGE_CHAT_DB=~/Library/Messages/chat.db
   ```

   Generate a token with `openssl rand -hex 32`. Keep the listener on a trusted
   LAN/VPN or behind an authenticated TLS reverse proxy. Never expose plain HTTP
   to the public internet.
3. Give the terminal/runtime Automation access to Messages and Full Disk Access
   for `~/Library/Messages/chat.db`.
4. Start and verify locally:

   ```sh
   npm run relay
   curl -H "Authorization: Bearer $IMESSAGE_RELAY_TOKEN" \
     http://127.0.0.1:8787/health
   ```

5. Restrict inbound port 8787 to the workflow device or private VPN subnet.

The server enforces constant-time bearer-token comparison, body/message/
attachment limits, bounded reply retrieval, timeouts, generic errors, and
persistent delivery idempotency.

## launchd

Copy `docs/examples/com.wp-homepage-agent.relay.plist`, replace every
`REPLACE_*` value with an absolute path or private value, and install it:

```sh
mkdir -p ~/Library/LaunchAgents
cp docs/examples/com.wp-homepage-agent.relay.plist \
  ~/Library/LaunchAgents/com.wp-homepage-agent.relay.plist
plutil -lint ~/Library/LaunchAgents/com.wp-homepage-agent.relay.plist
launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.wp-homepage-agent.relay.plist
launchctl kickstart -k gui/$(id -u)/com.wp-homepage-agent.relay
```

Inspect status and the configured log files:

```sh
launchctl print gui/$(id -u)/com.wp-homepage-agent.relay
```

Avoid putting tokens in a committed plist. The example contains placeholders
only; a local installed copy is private.

## Windows workflow configuration

```dotenv
IMESSAGE_ADAPTER=relay
IMESSAGE_RELAY_URL=http://mac-relay.internal:8787
IMESSAGE_RELAY_TOKEN=the-same-private-token
IMESSAGE_RECIPIENT=+15551234567
IMESSAGE_RELAY_TIMEOUT_MS=30000
IMESSAGE_INCLUDE_LIVE_LINK_PASSWORD=false
```

Run `npm run homepage:once` once interactively before scheduling. Verify the
relay health, Live Link access, tracker lock cleanup, preview message, and exact
nonce reply end to end.

## Windows Task Scheduler

For continuous operation, create a task that starts `npm run homepage:worker`
at system startup or user logon:

1. Use a dedicated local account with access only to the repository, tracker,
   Local site, and required network hosts.
2. Set **Start in** to the absolute repository directory.
3. Program: `C:\Program Files\nodejs\npm.cmd`
4. Arguments: `run homepage:worker`
5. Enable **Run whether user is logged on or not**, **Restart on failure**, and
   **Do not start a new instance**.
6. Do not configure a hard stop shorter than the longest section timeout.
7. Stop the task normally so the worker receives a termination signal; stale
   worker/tracker locks are recovered only after their configured age.

For periodic one-item processing, schedule `npm run homepage:once` instead and
also select **Do not start a new instance**.

## Other messaging modes

- `IMESSAGE_ADAPTER=macos` runs the client directly on a Mac and needs the same
  Messages permissions; no HTTP relay URL/token is used.
- `IMESSAGE_ADAPTER=dry-run` is a true no-send mode. It returns no approval
  replies, so it cannot install an approved front page.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Windows cannot reach `/health` | Mac listener address, firewall/VPN, port, launchd status, and matching token. |
| HTTP 401 | Exact token match and no whitespace added by the environment. |
| HTTP 500 without detail | Inspect private Mac logs; server responses intentionally hide database/Automation paths. |
| Messages send fails | Messages sign-in and Automation permission. |
| Replies are empty | Full Disk Access, exact recipient formatting, chat database path, and request timestamp. |
| Duplicate scheduler starts | Task Scheduler's no-new-instance policy and adjacent `.worker.lock`. |
| `blocked_review_delivery` | Restore relay health and rerun; the same idempotency key is retried safely. |
| Reply ignored | Sender, timestamp, homepage ID, nonce, punctuation, and exact text must all match. |
