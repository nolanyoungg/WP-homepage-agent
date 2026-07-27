# WP Homepage Agent hardening implementation tasks

Branch: `z/homepage-agent-lm-link-resilience-relay-ci-hardening`

This ledger maps every requested improvement to an independently verifiable task.
An item is checked only after its code or operational artifact exists and its
relevant validation has passed.

## Safety and correctness

- [x] SAFE-001 Reject duplicate `homepage_id` values before tracker selection or mutation.
- [x] SAFE-002 Include the homepage ID or slug in generated page-template filenames.
- [x] SAFE-003 Verify an existing WordPress preview Page belongs to the same homepage before updating it.
- [x] SAFE-004 Recover safely after partial WordPress front-page mutations.
- [x] SAFE-005 Reconcile tracker, manifest, installed files, preview Page, and WordPress settings.
- [x] SAFE-006 Validate generated HTML with a parsed element-and-attribute allowlist.
- [x] SAFE-007 Reject unsafe URL schemes, protocol-relative URLs, SVG, and embedded active content.
- [x] SAFE-008 Add bounded timeouts and termination handling to PHP and WP-CLI child processes.
- [x] SAFE-009 Detect and recover stale tracker locks without permitting concurrent workers.
- [x] SAFE-010 Ignore private `.env.*` files while explicitly retaining `.env.example`.
- [x] SAFE-011 Remove personal infrastructure details from public examples and runbooks.
- [x] SAFE-012 Resolve or formally mitigate current production dependency advisories.

## LM Studio authentication and transport

- [x] LM-001 Support `LMSTUDIO_API_TOKEN` on every LM Studio request.
- [x] LM-002 Redact the LM Studio token from logs, errors, tracker fields, and artifacts.
- [x] LM-003 Configure separate health, model-load, plan, and section timeouts.
- [x] LM-004 Retry only classified transient connection, timeout, HTTP 429, and selected 5xx failures.
- [x] LM-005 Add bounded exponential retry delays.
- [x] LM-006 Attach a correlation/run ID to LM Studio requests and safe log entries.
- [x] LM-007 Require an explicitly approved primary model.
- [x] LM-008 Prohibit automatic model downloads in code and documentation.
- [x] LM-009 Prohibit arbitrary model fallback selection.
- [x] LM-010 Support an optional explicit ordered fallback allowlist.
- [x] LM-011 Verify the selected model is an LLM.
- [x] LM-012 Verify loaded-model requirements before generation.
- [x] LM-013 Verify requested reasoning support against model capabilities.
- [x] LM-014 Record the actual model instance used.
- [x] LM-015 Detect incompatible Just-in-Time loading behavior or configuration.
- [x] LM-016 Support explicit `required-loaded` and `load-installed` model policies.
- [x] LM-017 Document and enforce the minimum supported LM Studio version.

## LM Link

- [x] LINK-001 Document LM Link as a first-class deployment mode.
- [x] LINK-002 Use the local LM Studio API at `127.0.0.1:1234` in LM Link mode.
- [x] LINK-003 Document linking the workflow and inference devices.
- [x] LINK-004 Document preferred-device selection and verification.
- [x] LINK-005 Verify the remote model through the local LM Studio API.
- [x] LINK-006 Report linked-device disconnection distinctly.
- [x] LINK-007 Distinguish server, link, model, loading, capability, and authentication failures.
- [x] LINK-008 Never fall back from LM Link to a public endpoint or unsupported provider.
- [x] LINK-009 Add LM Link troubleshooting instructions.
- [x] LINK-010 Keep direct-LAN and LM Link instructions separate.

## Model generation

- [x] GEN-001 Keep the plan and each homepage section as independently bounded requests.
- [x] GEN-002 Make plan and section token limits configurable.
- [x] GEN-003 Keep deterministic inference seeds configurable and enabled by default.
- [x] GEN-004 Record prompt-version identifiers in the manifest.
- [x] GEN-005 Record safe token, timing, retry, model-instance, and completion metadata.
- [x] GEN-006 Reject truncated, interrupted, or otherwise incomplete completions.
- [x] GEN-007 Add one targeted repair attempt for malformed plan JSON.
- [x] GEN-008 Keep Zod validation for every generated plan.
- [x] GEN-009 Keep structured-output mode opt-in until verified with the real configured model.
- [x] GEN-010 Delimit the homepage idea as untrusted data rather than instructions.
- [x] GEN-011 Enforce maximum lengths for tracker and prompt fields.
- [x] GEN-012 Keep model output constrained to static content.
- [x] GEN-013 Default to one generation request at a time.
- [x] GEN-014 Make generation concurrency an explicit bounded setting.

## Checkpointing and recovery

- [x] CHECK-001 Save the validated homepage plan as a resumable artifact.
- [x] CHECK-002 Save each completed section independently.
- [x] CHECK-003 Store checksums for every completed section.
- [x] CHECK-004 Resume at the first missing or invalid section.
- [x] CHECK-005 Avoid regenerating already validated sections.
- [x] CHECK-006 Verify model, prompt version, plan, manifest, and theme before resuming.
- [x] CHECK-007 Invalidate checkpoints when generation inputs change.
- [x] CHECK-008 Preserve recoverable staging evidence after failures.
- [x] CHECK-009 Clean expired or invalid checkpoints automatically.
- [x] CHECK-010 Represent interrupted planning, generation, validation, and installation states.
- [x] CHECK-011 Recover when a preview exists but tracker persistence failed.
- [x] CHECK-012 Recover when approval delivery succeeded but tracker persistence failed.
- [x] CHECK-013 Recover when WordPress changed but final verification failed.

## Logging and live validation

- [x] LOG-001 Add structured JSONL run logging.
- [x] LOG-002 Exclude complete prompts, responses, passwords, and tokens from normal logs.
- [x] LOG-003 Log safe LM Studio error categories.
- [x] LOG-004 Correlate workflow timestamps with LM Studio logs.
- [x] LOG-005 Document `lms log stream` server and model commands.
- [x] LOG-006 Add `npm run lmstudio:check`.
- [x] LOG-007 Add `npm run lmstudio:smoke`.
- [x] LOG-008 Add a real-model dry-run using a copied tracker and isolated artifacts.
- [x] LOG-009 Require generated-artifact inspection after model tests.
- [x] LOG-010 Separate deterministic validation from live-model validation in reports and docs.

## iMessage relay and approval

- [x] MSG-001 Move the relay into the main TypeScript project.
- [x] MSG-002 Add deterministic relay-server tests.
- [x] MSG-003 Use a relay protocol compatible with the blog agent.
- [x] MSG-004 Require a strong minimum relay-token length.
- [x] MSG-005 Use constant-time relay-token comparison.
- [x] MSG-006 Enforce request, message, attachment, and response-size limits.
- [x] MSG-007 Add configurable relay client and server timeouts.
- [x] MSG-008 Bound or paginate retrieved replies.
- [x] MSG-009 Prevent relay errors from exposing system or Messages database details.
- [x] MSG-010 Add launchd setup and example configuration.
- [x] MSG-011 Add Windows-to-Mac relay troubleshooting instructions.
- [x] MSG-012 Preserve retryable `blocked_review_delivery` behavior.
- [x] MSG-013 Make approval delivery idempotent.
- [x] MSG-014 Record delivery IDs, attempts, and timestamps.
- [x] MSG-015 Include a short review nonce in approval decisions.
- [x] MSG-016 Add an optional direct-macOS messaging adapter.
- [x] MSG-017 Add a true no-send messaging adapter.
- [x] MSG-018 Avoid sending the Live Link password in approval messages when configured.

## Worker and operations

- [x] OPS-001 Add a continuous worker command.
- [x] OPS-002 Make the polling interval configurable.
- [x] OPS-003 Handle `SIGINT` and `SIGTERM` gracefully.
- [x] OPS-004 Add Windows Task Scheduler instructions.
- [x] OPS-005 Add a Windows workflow, Mac relay, and LM Studio runbook.
- [x] OPS-006 Add a separate LM Link runbook.
- [x] OPS-007 Add a separate direct-LAN runbook.
- [x] OPS-008 Complete all preflight checks before claiming a tracker row.
- [x] OPS-009 Back off safely when no work is available.
- [x] OPS-010 Avoid excessive health-check requests.
- [x] OPS-011 Add a read-only workflow-status command.
- [x] OPS-012 Add a homepage reconciliation command.
- [x] OPS-013 Add safe retry and recovery commands.
- [x] OPS-014 Remove the need for manual Excel edits during normal recovery.

## Architecture and tests

- [x] ARCH-001 Organize source files by CLI, config, generation, LM Studio, messaging, tracker, WordPress, validation, workflow, and logging domains.
- [x] ARCH-002 Define narrow interfaces around external systems.
- [x] ARCH-003 Keep all model-based testing on real LM Studio or LM Link.
- [x] ARCH-004 Do not introduce mock or fake model clients.
- [x] ARCH-005 Split deterministic coverage into focused suites.
- [x] ARCH-006 Share compatible relay and LM Studio conventions with the blog agent.
- [x] TEST-001 Test duplicate homepage IDs.
- [x] TEST-002 Test multiple homepages generated on the same date.
- [x] TEST-003 Test unsafe HTML, URLs, SVG, and attributes.
- [x] TEST-004 Test interrupted and resumed generation.
- [x] TEST-005 Test partial installation and rollback.
- [x] TEST-006 Test relay-delivery failures and retries.
- [x] TEST-007 Test tracker persistence failures.
- [x] TEST-008 Test approval recovery and nonces.
- [x] TEST-009 Test WordPress mutation and verification failures.
- [x] TEST-010 Test every workflow transition and recovery state.
- [x] TEST-011 Test configuration, environment-template, and documentation consistency.
- [x] TEST-012 Add shared relay-contract coverage.

## CI, security, and releases

- [x] CI-001 Add GitHub Actions for build, lint, deterministic tests, and repository validation.
- [x] CI-002 Report dependency vulnerabilities with a documented severity policy.
- [x] CI-003 Protect `main` after required checks exist.
- [x] CI-004 Require pull requests and passing checks.
- [x] CI-005 Add controlled automated dependency updates.
- [x] RELEASE-001 Align `package.json` and changelog versions.
- [x] RELEASE-002 Use release entries and Git tags consistently.
- [x] RELEASE-003 Add GitHub release guidance.
- [x] RELEASE-004 Add `SECURITY.md`.
- [x] RELEASE-005 Confirm and document the repository visibility decision.
- [x] RELEASE-006 Add an explicit license appropriate to that visibility decision.
- [x] RELEASE-007 Keep README, environment examples, commands, validation, and changelog synchronized.
