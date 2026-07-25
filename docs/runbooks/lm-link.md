# LM Link runbook

LM Link lets the workflow device call its own `127.0.0.1:1234` LM Studio API
while a linked inference device serves the model. Requests remain local to the
workflow device; LM Studio performs linked-device model resolution.

## Link the devices

1. Install and open LM Studio 0.4.8 or newer on both devices and confirm the
   installed version in each app.
2. On the inference device, download and load the explicitly approved LLM.
3. Use LM Studio's LM Link page to create a link and add the workflow device.
4. On the workflow device, confirm connection state and connected peers:

   ```sh
   lms link status
   lms link status --json
   ```

5. If the same model exists on multiple peers, select the intended inference
   device in the LM Link UI or run:

   ```sh
   lms link set-preferred-device
   ```

   Preferred-device selection is per machine. Set and verify it on the workflow
   device.

## Workflow device configuration

```dotenv
LMSTUDIO_CONNECTION_MODE=lmlink
LMSTUDIO_BASE_URL=http://127.0.0.1:1234
LMSTUDIO_API_TOKEN=replace-with-the-local-server-api-token
LMSTUDIO_PRIMARY_MODEL=openai/gpt-oss-20b
LMSTUDIO_FALLBACK_MODELS=
LMSTUDIO_MODEL_POLICY=required-loaded
LMSTUDIO_REASONING=low
LMSTUDIO_MIN_VERSION=0.4.8
LMSTUDIO_CONFIRMED_VERSION=0.4.8
```

LM Link mode rejects non-loopback `LMSTUDIO_BASE_URL` values. It does not fall
back to a LAN host, a public endpoint, or another provider.

## Verify model resolution

First inspect the official link status:

```sh
lms link status --json
```

Then verify that the linked model is visible through the workflow device's
local native API:

```sh
curl -H "Authorization: Bearer $LMSTUDIO_API_TOKEN" \
  http://127.0.0.1:1234/api/v1/models
```

Finally run:

```sh
npm run lmstudio:check
npm run lmstudio:smoke
```

`lmstudio:check` runs `lms link status --json`, checks the local native v1 API,
and records the actual model instance selected. The smoke check waits for a real
completion through that same instance.

## Troubleshooting

| Symptom/category | Resolution |
| --- | --- |
| `lms` missing | Start LM Studio once and install/repair its CLI integration. |
| `lmlink-unavailable` | Confirm LM Link is enabled, the peer is connected, and the approved LLM is loaded on the peer. |
| Link status succeeds but model is missing | Verify the exact key, preferred device, and the inference device's loaded models. |
| Authentication failure | Check the workflow device's local server token; do not copy tokens into logs. |
| Local API connection failure | Start the workflow device's LM Studio server and keep the base URL at `127.0.0.1`. |
| Model loading mismatch | Use `required-loaded`, or explicitly permit `load-installed`; never rely on undocumented JIT behavior. |
| Capability failure | The remote model must advertise the configured reasoning option through the local model list. |
| Link drops during generation | Preserve the checkpoint, restore the link, rerun `lmstudio:check`, then use `homepage:retry`. |

Use `lms log stream` on the relevant device and match timestamps/run IDs with
`data/runs/*.jsonl`. A local health check alone is not proof that the remote
model completed inference.

Official references:

- <https://lmstudio.ai/docs/developer/core/lmlink>
- <https://lmstudio.ai/docs/cli/link/link-status>
- <https://lmstudio.ai/docs/cli/link/link-set-preferred-device>
- <https://lmstudio.ai/docs/lmlink/basics/add-device>
