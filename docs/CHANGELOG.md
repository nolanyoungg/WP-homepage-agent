# Changelog

## 0.1.12 - 2026-07-26

### Added

- Add an explicit repository policy that fixture-based and simulated validation
  belongs outside this repository.

### Changed

- Use compilation, linting, and the real LM Studio/LM Link, WordPress, Live
  Link, and Messages operator path as the supported validation approach.

### Fixed

- Align the package version with the latest recorded maintenance release before
  beginning further runtime work.

### Removed

- Remove the committed `tests/` directory, Vitest dependency, `npm test`
  command, and test-only TypeScript configuration.

### Tested

- 2026-07-26 02:06 America/New_York: Confirmed the cleanup starts from
  unchanged `main`, with draft PR #2 closed and its branch retained only as a
  recovery reference.
- 2026-07-26 02:09 America/New_York: Passed strict TypeScript compilation,
  ESLint, and Git whitespace validation after removing the test harness and
  pruning Vitest from the npm lockfile.

## 0.1.0 - 2026-07-24

- Add the local-only TypeScript homepage workflow and Excel tracker.
- Add LM Studio planning/PHP generation with model availability checks.
- Add manifest, exact-eleven-file PHP validation, path containment, checksums, and transactional theme installation.
- Add WP-CLI preview Page management, Live Link checks, exact iMessage approval gating, and static-front-page verification.
- Add the authenticated macOS Messages relay contract and minimal implementation.
- Add first-run documentation.

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
