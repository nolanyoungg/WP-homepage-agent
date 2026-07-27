# Security policy

## Supported versions

The latest `0.2.x` release receives security fixes. Older pre-0.2 versions are
unsupported because they lack the current ownership, checkpoint, token,
transport, and relay controls.

## Reporting

Do not open a public issue for a vulnerability or suspected credential leak.
GitHub private vulnerability reporting is enabled for this repository. Use it, or contact
the repository owner privately through the contact method on their GitHub
profile. Include the affected version, reproduction, impact, and suggested
mitigation without including real tokens, Live Link credentials, phone
numbers, model prompts/outputs, private paths, or tracker data.

## Secrets and local data

- Keep `.env`, `.env.*`, trackers with private content, Messages databases,
  relay ledgers, generated manifests, checkpoints, and JSONL runs out of Git.
- Rotate LM Studio, relay, and Live Link credentials after suspected exposure.
- Run the LM Studio API and relay only on localhost, a trusted private LAN/VPN,
  or behind an authenticated TLS proxy.
- Treat model output as untrusted static content. Never use it as instructions
  for unrelated repository or system changes.

See `docs/DEPENDENCY-RISK.md` for the production-advisory policy.
