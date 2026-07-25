# WP Homepage Agent

WP Homepage Agent is a local-first TypeScript worker that turns an Excel tracker
row into a reviewable WordPress homepage. It uses only LM Studio or LM Link,
installs generated files only in the designated Local theme, and changes the
static front page only after an exact approval reply.

It does not create blog posts, use cloud model providers, download models
automatically, simulate inference, or trust model output as executable code.

## Safety model

- The only writable theme is
  `<LOCAL_WORDPRESS_ROOT>/wp-content/themes/nolan-young-theme-template-02`.
- A complete preflight runs before a `pending` tracker row is claimed.
- Generated model output is parsed as HTML and checked against element,
  attribute, and URL allowlists. PHP wrappers and template calls are constructed
  deterministically.
- Eleven PHP artifacts must pass path containment, exact manifest matching,
  safety scans, `php -l`, and SHA-256 checks before installation.
- Existing destination files are reused only when byte-identical; a partial
  installation is rolled back.
- Preview Pages carry `_wp_homepage_agent_id` ownership metadata. The worker
  refuses a slug, Page ID, or page template owned by another homepage.
- Front-page settings are captured, verified after mutation, and restored if
  verification fails.
- Tokens and passwords are redacted from JSONL logs and are never written to
  generated PHP or manifests.

## Requirements

- Node.js 20 or newer
- PHP available on `PATH`
- WP-CLI and a running Local WordPress site
- LM Studio 0.4.0 or newer, or LM Link between the workflow and inference
  devices
- The approved LLM already downloaded; the default policy also requires it to
  be loaded
- A configured Local Live Link
- For approval messaging: the integrated Mac relay or direct macOS Messages
  adapter

LM Studio's native v1 API and API-token support began in 0.4.0. The worker
requires `/api/v1/models`, so older installations fail preflight instead of
silently using another API. The documented API does not expose the desktop app
version; confirm the installed version in LM Studio and keep
`LMSTUDIO_MIN_VERSION=0.4.0` or higher.

## First run

1. Copy `.env.example` to `.env` and replace every placeholder. `.env` and all
   private `.env.*` variants are ignored.
2. Install dependencies and create a tracker if needed:

   ```powershell
   npm ci
   npm run tracker:create
   ```

3. Add a safe `homepage_id`, a homepage idea of at most 4,000 characters, and
   `pending` status to the tracker. Close Excel before starting the worker.
4. Validate deterministic code and the real configured model:

   ```powershell
   npm run validate
   npm run audit:dependencies
   npm run lmstudio:check
   npm run lmstudio:smoke
   ```

5. Run once or start the continuous worker:

   ```powershell
   npm run homepage:once
   npm run homepage:worker
   ```

The worker claims one pending row, plans ten sections, checkpoints each
completed section, validates and installs the artifacts, creates or adopts its
owned preview Page, checks the Local and Live Link URLs, and sends a review
request. Run-once mode exits; worker mode polls until `SIGINT` or `SIGTERM`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript. |
| `npm run lint` | Run ESLint. |
| `npm run test` | Run deterministic tests; no fake model is used. |
| `npm run validate` | Build, lint, test, and validate repository consistency. |
| `npm run audit:dependencies` | Enforce the documented production-advisory policy. |
| `npm run tracker:create -- path/to/tracker.xlsx` | Create the versioned tracker schema. |
| `npm run homepage:once -- --tracker path/to/tracker.xlsx` | Process at most one workflow item. |
| `npm run homepage:worker -- --tracker path/to/tracker.xlsx` | Poll continuously with graceful shutdown and idle backoff. |
| `npm run homepage:status -- --tracker path/to/tracker.xlsx` | Print read-only tracker status as JSON. |
| `npm run homepage:reconcile -- --id ID` | Compare tracker, manifest, installed checksums, preview ownership, and WordPress front-page state. |
| `npm run homepage:retry -- --id ID` | Move an eligible `error` row to its evidence-based recovery state. |
| `npm run lmstudio:check` | Check LM Link when configured, native v1 API access, approved model type/capabilities, and loaded-model policy. |
| `npm run lmstudio:smoke` | Wait for a real model completion and require the exact smoke response. |
| `npm run homepage:dry-run -- --output DIRECTORY --tracker COPY.xlsx` | Use the real model with a copied tracker and a new isolated run directory; do not install or message. |
| `npm run relay` | Run the authenticated TypeScript Messages relay on macOS. |

`homepage:retry` removes the need to edit recovery states manually. It never
approves a homepage and never bypasses ownership, validation, or URL checks.

## Tracker states and recovery

Normal generation uses:

`pending → planning → generating → validating → awaiting_review → approved → installing → installed`

Other terminal or recovery states are `rejected`, `error`, and
`blocked_review_delivery`.

- Plan and section checkpoints live under
  `data/homepages/<homepage_id>/.checkpoint/`.
- Every checkpoint binds the homepage idea, model key and instance, theme,
  prompt version, plan checksum, manifest, and completed section checksums.
- Compatible sections are reused after interruption. Changed inputs invalidate
  the checkpoint; expired checkpoint directories are removed during preflight.
- If WordPress preview creation succeeded before tracker persistence failed,
  ownership metadata lets the next validation recovery adopt the same Page.
- If delivery succeeded before tracker persistence failed, the persistent
  idempotency key prevents a duplicate message.
- If WordPress settings changed but final verification failed, the previous
  settings are restored and the row becomes retryable `error`.

Use `homepage:status`, then `homepage:reconcile`, and finally `homepage:retry`
when the evidence supports recovery.

## Approval behavior

The message contains a short nonce derived from the private review token. Only
an exact reply from `IMESSAGE_RECIPIENT`, received after the request timestamp,
is accepted:

```text
YES <homepage_id> <nonce> — make this preview the Local site's homepage
NO <homepage_id> <nonce> — reject it and leave the current Local homepage unchanged
```

A send failure becomes `blocked_review_delivery`; subsequent runs retry the
same idempotency key and record attempt count, timestamp, delivery ID, and
duplicate status in local state and JSONL logs. Set
`IMESSAGE_INCLUDE_LIVE_LINK_PASSWORD=false` to keep the password out of the
message. `IMESSAGE_ADAPTER=dry-run` never sends or supplies an approval.

## LM Studio and LM Link

The worker sends API tokens on every LM Studio request when
`LMSTUDIO_API_TOKEN` is set. It uses:

- `GET /api/v1/models` for the approved model, LLM type, loaded instance, and
  reasoning capability
- `POST /api/v1/models/load` only when
  `LMSTUDIO_MODEL_POLICY=load-installed`
- `POST /v1/chat/completions` for one bounded plan request and ten independently
  bounded HTML-section requests

Fallbacks are considered only in the explicit ordered
`LMSTUDIO_FALLBACK_MODELS` allowlist. There is no arbitrary selection, download
endpoint, cloud fallback, or LM Link fallback to direct LAN. Structured plan
output is opt-in; Zod validation and one targeted repair attempt always remain.

See:

- [Direct-LAN runbook](docs/runbooks/direct-lan.md)
- [LM Link runbook](docs/runbooks/lm-link.md)
- [Windows workflow and Mac relay runbook](docs/runbooks/windows-mac-relay.md)

## Real-model validation

Deterministic tests do not simulate LM Studio. Live validation is separate:

1. Run `npm run lmstudio:check`.
2. In another terminal, correlate the JSONL timestamps in `data/runs/` with:

   ```sh
   lms log stream --source server --json
   lms log stream --source model --filter input,output --stats
   ```

   Model logs contain prompt/output content; do not paste them into tickets.
3. Run `npm run lmstudio:smoke` and wait for completion.
4. Copy the tracker, leave one copied row pending, then run the isolated
   `homepage:dry-run` command.
5. Open the reported staging directory. Confirm one page template and ten
   section files, inspect all content, and compare the manifest checksums and
   inference metadata.

A passing build or unit suite does not prove a live model, LM Link, Messages,
Live Link, or WordPress integration.

## Repository policy

The repository is intentionally public and licensed under MIT. Do not commit
trackers containing private business data, generated run state, credentials,
machine names, personal paths, IP addresses, model logs, or screenshots with
Live Link credentials. See [SECURITY.md](SECURITY.md),
[dependency risk](docs/DEPENDENCY-RISK.md), and
[release guidance](docs/RELEASES.md).

Official references: [LM Studio API](https://lmstudio.ai/docs/developer/rest),
[authentication](https://lmstudio.ai/docs/developer/core/authentication),
[Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions),
[LM Link](https://lmstudio.ai/docs/developer/core/lmlink), and
[`lms` CLI](https://lmstudio.ai/docs/cli).
