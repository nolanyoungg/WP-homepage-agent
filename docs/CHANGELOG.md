# Changelog

## [0.2.0] - 2026-07-25

### Added

- Add LM Studio API-token authentication, explicit transport/model policies,
  approved fallback allowlists, model-instance/capability checks, separate
  timeouts, classified retries, real smoke checks, and first-class LM Link
  validation.
- Add prompt/inference provenance, JSONL run logs, safe error categories,
  bounded configurable tokens/concurrency, one plan-repair attempt, parsed HTML
  allowlists, and unique homepage-aware filenames.
- Add resumable plan/section checkpoints with checksums, invalidation, expiry,
  isolated real-model dry runs, persistent approval-delivery attempts, and
  evidence-based retry/reconciliation commands.
- Add the integrated TypeScript Messages relay, direct-macOS and no-send
  adapters, attachment/reply limits, request/response timeouts, idempotency,
  nonce-bound approvals, and optional Live Link password omission.
- Add a continuous graceful worker, stale tracker/worker lease recovery,
  pre-claim preflight, safe idle backoff, read-only status, and Windows Task
  Scheduler instructions.
- Add focused deterministic suites, GitHub Actions, Dependabot, dependency-risk
  policy, Security policy, MIT license, release guidance, launchd example, and
  separate direct-LAN, LM Link, and Windows-to-Mac runbooks.

### Changed

- Reorganize the TypeScript source into CLI, config, domain, generation, LM
  Studio, logging, messaging, runtime, tracker, validation, WordPress, and
  workflow modules with narrow external-system interfaces.
- Use LM Studio's native `/api/v1/models` response as the authoritative model
  inventory and use the actual loaded instance for Chat Completions.
- Require WordPress preview ownership metadata and validate/reconcile the Page,
  template, manifest, files, checksums, and front-page settings before recovery.
- Version the application as `0.2.0` and align package, environment, README,
  validation, release, and changelog surfaces.
- Use the Node 24 runtime releases of GitHub's official checkout and setup-node
  actions while continuing to test the application itself on supported Node 20.

### Fixed

- Correct the minimum LM Studio policy from 0.4.0 to 0.4.8, the release that
  added the `reasoning_effort` and native reasoning-capability behavior used by
  the default configuration, and require an explicit installed-version
  attestation.
- Accept both documented native load-response instance field names, verify the
  model identifier returned by each completion, retry HTTP 408 as a classified
  timeout, and attach the workflow run ID to every LM Studio request.
- Preserve failed validation/preview staging evidence until expiry, retain
  valid checkpoint sections when one section is missing or corrupt, verify all
  checkpoint/manifest provenance, and restrict recovery to canonical manifest
  paths.
- Reject symlink escapes during theme installation, strip credentials from
  child-process environments, constrain service configuration to credential-
  free HTTP(S) origins, and prevent authenticated render checks from following
  redirects outside their configured origin.
- Require byte-exact approval replies, cap relay response bodies, interrupt
  worker backoff immediately on shutdown signals, and fail dependency policy on
  new advisory sources even when they affect an already reviewed package.
- Avoid persisting raw LM Link device/status data, ignore numeric fragments in
  WP-CLI warnings when resolving Page IDs, and fail on ambiguous Page ownership
  or slug results.
- Reject duplicate homepage IDs, same-day filename collisions, unsafe SVG/
  active HTML, mixed unsafe `srcset` values, protocol-relative URLs, stale
  locks, and unbounded subprocess execution.
- Roll back partial theme copies and partially changed WordPress front-page
  settings, and safely recover preview creation, approval persistence, and
  final-verification failures without model regeneration.
- Redact LM Studio/relay/Live Link secrets from run logs and tracker errors and
  remove personal machine paths, IP addresses, and runtime artifacts from
  public examples.

### Removed

- Remove the duplicate flat source implementation and standalone JavaScript
  relay package.
- Remove the committed generated homepage manifest and replace runtime data with
  ignored per-homepage/checkpoint/run directories.
- Remove documentation that implied deterministic checks proved live LM Studio,
  LM Link, WordPress, Live Link, or Messages behavior.

### Tested

- 2026-07-25 13:35 America/New_York: Compiled the reorganized strict TypeScript
  project after adding the new command, workflow, checkpoint, relay, and
  reconciliation surfaces.
- 2026-07-25 13:44 America/New_York: Exercised configuration, duplicate IDs,
  stale locks, atomic tracker failure, generated HTML safety, filename
  collisions, checkpoints, partial install rollback, relay compatibility, and
  exact approval decisions.
- 2026-07-25 13:48 America/New_York: Passed all 27 deterministic Vitest checks
  after adding persistent delivery-attempt evidence and the workflow lease.
- 2026-07-25 13:49 America/New_York: Passed strict TypeScript compilation and
  ESLint after removal of the superseded flat modules.
- 2026-07-25 13:56 America/New_York: Enabled GitHub private vulnerability
  reporting and protected `main` with required pull requests, the strict
  `deterministic-validation` check, resolved conversations, administrator
  enforcement, and force-push/deletion prevention.
- 2026-07-25 13:58 America/New_York: Passed the complete local validation gate
  with strict compilation, ESLint, all 30 deterministic tests (including
  `php -l` over all eleven staged artifacts), repository consistency, the
  reviewed production-dependency policy, and `git diff --check`.
- 2026-07-25 13:59 America/New_York: Live LM Studio, LM Link, real-model dry
  run, WordPress, Live Link, and Messages validation remained unexecuted on
  this development host because no private `.env`/runtime variables or `lms`
  CLI were available; no live-integration success is claimed.
- 2026-07-25 14:01 America/New_York: The first pull-request
  `deterministic-validation` run passed; upgraded the two official GitHub
  Actions to their Node 24 runtime releases to remove the runner's Node 20
  action-deprecation annotation before final CI validation.
- 2026-07-25 14:15 America/New_York: Passed strict compilation, ESLint, and 43
  deterministic tests after adding official LM Studio 0.4.8 contract
  corrections, checkpoint/staging evidence recovery, symlink-safe
  installation, bounded relay responses, redirect and subprocess credential
  controls, exact WP-CLI ID parsing, and regression coverage for each.
- 2026-07-25 14:16 America/New_York: Reattempted the live LM Studio preflight;
  the development host still had no private `.env`, required runtime
  configuration, or `lms` CLI, so LM Studio, LM Link, WordPress, Live Link,
  Messages, and real-model artifact validation remain explicitly unclaimed.

## 0.1.0 - 2026-07-24

- Add the local-only TypeScript homepage workflow and Excel tracker.
- Add LM Studio planning/PHP generation with model availability checks.
- Add manifest, exact-eleven-file PHP validation, path containment, checksums, and transactional theme installation.
- Add WP-CLI preview Page management, Live Link checks, exact iMessage approval gating, and static-front-page verification.
- Add the authenticated macOS Messages relay contract and minimal implementation.
- Add safety tests and first-run documentation.

## 0.1.1 - 2026-07-24 15:08 America/New_York

### Added

- Add strict JSON schemas for the homepage plan and the complete generated PHP bundle.
- Add an official LM Studio structured-output documentation link to the operator guide.

### Changed

- Send both generation requests through `/v1/chat/completions` with `response_format.type=json_schema`, a named schema, strict mode, explicit non-streaming behavior, and bounded output tokens.
- Continue validating the schema-constrained response locally with Zod before any file is staged.

### Fixed

- Prevent malformed JSON caused by unescaped PHP content from reaching staging or theme installation.

### Removed

- Remove reliance on prompt-only "Return JSON" instructions as the generation envelope guarantee.

### Tested

- 2026-07-24 15:04 America/New_York: Confirmed the failed row had no installed theme targets and no WordPress Page assigned to its template.
- 2026-07-24 15:06 America/New_York: Verified a real strict JSON-schema response with `openai/gpt-oss-20b` through the configured LM Studio `/v1/chat/completions` endpoint.

## 0.1.2 - 2026-07-24 15:13 America/New_York

### Added

- Add explicit `finish_reason` validation for every LM Studio completion.
- Add schema-enforced filename identity for every generated template part.

### Changed

- Generate the page template and each of the ten PHP parts with separate bounded structured-output requests instead of one large PHP bundle response.
- Bound plan text fields and raise the plan completion allowance so reasoning plus the ten required sections can complete safely.

### Fixed

- Fix plan truncation caused by the initial 2,000-token structured-output allowance.
- Avoid the original malformed large PHP JSON envelope by assembling eleven independently validated local model results.

### Removed

- Remove the single-response PHP bundle generation path.

### Tested

- 2026-07-24 15:10 America/New_York: Confirmed the first structured retry stopped during planning before replacing the canonical manifest.
- 2026-07-24 15:12 America/New_York: Reconfirmed that no generated theme target or preview Page field existed after either failed attempt.

## 0.1.3 - 2026-07-24 15:24 America/New_York

### Added

- Add `reasoning_effort=low` to deterministic LM Studio chat-completion requests, matching current official OpenAI-compatible support for GPT-OSS.

### Changed

- Keep plan length limits in local Zod validation while simplifying the inference-time JSON schema.

### Fixed

- Avoid expensive prompt processing caused by compiling large schema-level finite string-length constraints.

### Removed

- Remove `maxLength` keywords from the LM Studio inference schema; local validation still enforces the same limits.

### Tested

- 2026-07-24 15:20 America/New_York: Confirmed build, lint, and all nine deterministic tests pass.
- 2026-07-24 15:22 America/New_York: Observed the constrained probe remained in LM Studio `processingPrompt` with the tracker unchanged.

## 0.1.4 - 2026-07-24 15:31 America/New_York

### Added

- Add raw-PHP normalization for independently generated page-template and content-template responses.

### Changed

- Use the official LM Studio Chat Completions text response for each PHP file, because filenames and ordering are already canonical in the manifest.
- Keep JSON limited to the concise homepage plan and validate that plan locally with Zod.

### Fixed

- Avoid schema-constrained GPT-OSS plan generations that exhausted both 2,000- and 8,000-token allowances with `finish_reason=length`.
- Eliminate JSON escaping as a failure mode for generated PHP bodies.

### Removed

- Remove `response_format` schemas from production generation requests after real-model tests showed repeated plan truncation.

### Tested

- 2026-07-24 15:27 America/New_York: Captured an explicit `finish_reason=length` from the 8,000-token structured plan request.
- 2026-07-24 15:29 America/New_York: Confirmed the tracker returned to `error` without a new manifest, theme target, or preview Page.

## 0.1.5 - 2026-07-24 15:39 America/New_York

### Added

- Add bounded extraction of LM Studio's structured error message to tracker diagnostics without persisting request prompts or response bodies.

### Changed

- Preserve the HTTP status plus at most 500 characters from the server-provided error message.

### Fixed

- Replace opaque `HTTP 400` generation errors with actionable local-runtime diagnostics.

### Removed

- Remove reliance on status codes alone for LM Studio generation failures.

### Tested

- 2026-07-24 15:36 America/New_York: Confirmed LM Studio had unloaded after the prior runtime failure while the tracker safely recorded `error`.
- 2026-07-24 15:38 America/New_York: Verified JIT model visibility and a real minimal Chat Completions request with low reasoning, HTTP 200, and `finish_reason=stop`.

## 0.1.6 - 2026-07-24 15:46 America/New_York

### Added

- Add a stable inference seed for reproducible Local LM Studio retries.
- Add named diagnostics for each generated-PHP safety prohibition.

### Changed

- Report the exact rejected rule and filename instead of a generic unsafe-executable message.

### Fixed

- Make validation failures actionable after temporary staging cleanup.

### Removed

- Remove anonymous regex-only safety failure reporting.

### Tested

- 2026-07-24 15:43 America/New_York: Completed the real plan plus all eleven independent PHP calls.
- 2026-07-24 15:44 America/New_York: Confirmed validation rejected the hero before theme installation or preview Page creation.

## 0.1.7 - 2026-07-24 15:53 America/New_York

### Added

- Add a generic-slug fallback that derives the canonical homepage slug from the validated plan title when the model returns `home`, `homepage`, or `home-page`.

### Changed

- Require generated content parts to use literal static HTML and prohibit `echo`, `printf`, variables, theme options, and other dynamic output.

### Fixed

- Prevent unescaped model-generated `echo` statements from recurring in static content-template parts.
- Prevent collision-prone generic homepage slugs from naming generated part families.

### Removed

- Remove permission for model-generated dynamic copy expressions in static homepage parts.

### Tested

- 2026-07-24 15:49 America/New_York: Deterministically reproduced and identified the exact `unescaped echo` hero rejection before installation.
- 2026-07-24 15:51 America/New_York: Added deterministic coverage for generic-slug fallback.

## 0.1.8 - 2026-07-24 15:57 America/New_York

### Added

- Add strict HTML-fragment normalization that rejects PHP tags, scripts, styles, forms, embedded objects, remote URLs, JavaScript URLs, and inline event handlers.
- Add deterministic ABSPATH-guarded PHP wrappers for all ten model-generated HTML sections.
- Add deterministic page-template construction from the canonical manifest.

### Changed

- Ask LM Studio to generate creative semantic HTML content instead of executable PHP.
- Keep filenames, PHP guards, template headers, and all ten `get_template_part()` calls under worker control.

### Fixed

- Eliminate model-authored unescaped `echo` and other executable-PHP violations by construction.

### Removed

- Remove model-authored PHP from the content-template and page-template workflow.

### Tested

- 2026-07-24 15:52 America/New_York: Reproduced a second model-authored `unescaped echo` violation in Features with no installation or preview Page mutation.
- 2026-07-24 15:58 America/New_York: Added deterministic wrapper, unsafe-HTML rejection, and exact-ten-template-call coverage.

## 0.1.9 - 2026-07-24 16:02 America/New_York

### Added

- Add numeric-only parsing for WP-CLI Page IDs.
- Add regression coverage for PHP startup warnings mixed into WP-CLI output.

### Changed

- Launch Local's PHP runtime with startup-error display disabled while retaining nonzero WP-CLI failures.

### Fixed

- Prevent a missing optional Imagick extension warning from being interpreted as the Page ID `Warning:`.

### Removed

- Remove truthy-token parsing from WP-CLI Page lookup output.

### Tested

- 2026-07-24 15:58 America/New_York: Verified warning-suppressed WP-CLI returned no existing generated preview Page.
- 2026-07-24 15:59 America/New_York: Confirmed `show_on_front=posts` and `page_on_front=0` remained unchanged.
- 2026-07-24 16:00 America/New_York: Verified the manifest contains one template checksum, ten part checksums, and all eleven exact installed targets.

## 0.1.10 - 2026-07-24 16:08 America/New_York

### Added

- Add automatic recovery for post-install preview failures.
- Add revalidation of exact installed files through temporary staging before any resumed WordPress mutation.
- Add the safe tracker transition `error -> validating` only for rows with manifest/template evidence and no preview Page ID.

### Changed

- Resume preview creation from the installed source-of-truth files instead of regenerating or overwriting them.

### Fixed

- Avoid nondeterministic model regeneration collisions after a validated install succeeds but WP-CLI preview work fails.

### Removed

- Remove the need to reset post-install failures to `pending` and repeat model generation.

### Tested

- 2026-07-24 16:04 America/New_York: Confirmed byte-difference protection refused a nondeterministic hero overwrite.
- 2026-07-24 16:06 America/New_York: Added deterministic transition coverage for validated post-install resume.
- 2026-07-24 16:00 America/New_York: Revalidated all eleven installed files, created preview Page ID 22, assigned the generated page template, and confirmed Local plus authenticated Live Link HTTP 200 at `/nolan-young-web-design/`.
- 2026-07-24 16:01 America/New_York: Confirmed the tracker stopped at `blocked_review_delivery` solely for the unconfigured macOS relay and that the static front-page settings remained `posts` / Page ID `0`.

## 0.1.11 - 2026-07-24 22:41 America/New_York

### Added

- Add repository-scoped `AGENTS.md` instructions that establish LM Studio and LM Link as the only supported model providers.

### Changed

- Make official LM Studio documentation, repository validation, README review, and timestamped changelog maintenance explicit workflow requirements.

### Fixed

- Remove ambiguity about which model providers and documentation sources are authoritative for future repository work.

### Removed

- Remove reliance on instruction context that exists only outside the repository.

### Tested

- 2026-07-24 22:41 America/New_York: Reviewed `README.md` against the current scripts, environment reference, LM Studio integration, failure recovery, and first-run behavior; no README correction was required.
- 2026-07-24 22:42 America/New_York: Passed TypeScript build, ESLint, all 14 Vitest checks, JSON parsing, environment-template validation, and Git whitespace validation.
