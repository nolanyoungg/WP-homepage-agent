# Direct-LAN LM Studio runbook

Use this mode when LM Studio serves the model directly to the workflow device
over a trusted private network. This mode is separate from LM Link.

## Inference device

1. Install LM Studio 0.4.8 or newer and confirm that version in the app.
2. Download the approved LLM manually. The agent never downloads models.
3. In the Developer page, start the local server and enable serving on the
   private network.
4. Enable **Require Authentication**, create a least-purpose API token, and
   store it only in the workflow device's `.env`.
5. Load the approved model. Prefer `required-loaded`; use `load-installed` only
   when deliberate API-driven loading is acceptable.
6. Restrict the server port with the host firewall. Do not expose it to the
   public internet and do not enable CORS for this worker.

LM Studio warns that binding outside `127.0.0.1` exposes the server beyond the
local machine. Authentication and a trusted LAN/VPN are required controls.

## Workflow device configuration

```dotenv
LMSTUDIO_CONNECTION_MODE=direct-lan
LMSTUDIO_BASE_URL=http://lm-studio-host.internal:1234
LMSTUDIO_API_TOKEN=replace-with-the-private-api-token
LMSTUDIO_PRIMARY_MODEL=openai/gpt-oss-20b
LMSTUDIO_FALLBACK_MODELS=
LMSTUDIO_MODEL_POLICY=required-loaded
LMSTUDIO_REASONING=low
LMSTUDIO_MIN_VERSION=0.4.8
LMSTUDIO_CONFIRMED_VERSION=0.4.8
```

Use the exact model key returned by the native model API. Fallbacks must be an
explicit comma-separated allowlist; leave the value empty when no fallback is
approved.

## Validation

```sh
npm run lmstudio:check
npm run lmstudio:smoke
```

The first command must identify an approved loaded LLM instance and its
reasoning support. The second waits for an actual completion. Then follow the
real-model dry-run and artifact inspection checklist in the README.

For correlated diagnostics:

```sh
lms log stream --source server --json
lms log stream --source model --filter input,output --stats
```

Do not publish model logs; the model stream includes inputs and outputs.

## Failure guide

| Category | Check |
| --- | --- |
| `connection` or timeout | Server running, private DNS/address, firewall, port, and configured timeout. |
| `authentication` | Token belongs to this server and authentication is consistently enabled. |
| `api-version` | LM Studio is 0.4.8+, the confirmed version matches `.env`, and `/api/v1/models` is available. |
| `model-missing` | Exact primary/fallback key is downloaded on this device. |
| `model-not-loaded` | Load it or explicitly select `load-installed`. |
| `model-type` | The selected resource must be `llm`, not embedding. |
| `reasoning-unsupported` | Choose an advertised reasoning option or another explicitly approved model. |
| server/429 | Inspect LM Studio logs and retry after capacity recovers; retries are bounded. |

The worker never changes providers or routes to a public endpoint after a
failure.
