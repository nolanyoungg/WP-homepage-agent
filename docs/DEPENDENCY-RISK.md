# Production dependency risk policy

## Policy

`npm run audit:dependencies` fails on:

- any critical production advisory;
- any production package outside the reviewed allowlist in
  `scripts/audit-dependencies.mjs`.
- any advisory source other than the two explicitly reviewed npm advisory
  sources `1119441` and `1124334`.

Run this policy before a release and after lockfile changes. An allowlisted
advisory is not considered fixed; it is a time-bounded, documented mitigation
that must be re-reviewed whenever the lockfile or advisory data changes.

## Current accepted chain

As of 2026-07-25, npm reports one moderate and nine high aggregate production
findings rooted in `exceljs@4.4.0`:

- `archiver`, `archiver-utils`, `brace-expansion`, `glob`, `minimatch`,
  `readdir-glob`, `rimraf`, and `zip-stream`;
- `uuid` advisory GHSA-w5hq-g745-h8pq;
- `brace-expansion` advisory GHSA-mh99-v99m-4gvg.

Npm's offered direct fix is a major downgrade to `exceljs@3.4.0`, not a
maintained upgrade. It does not provide an acceptable long-term security
improvement for this project.

## Exposure and controls

- Tracker workbooks are local operator-controlled files, not network uploads.
- The tracker rejects files larger than 10 MiB, more than 1,000 data rows,
  duplicate IDs, oversized ideas, and an unexpected workbook schema.
- The vulnerable glob/archive chain is reached through ExcelJS workbook
  serialization with library-defined entry names, not user-provided glob
  expressions.
- The UUID advisory affects namespace UUID calls with caller-supplied buffers;
  this application does not call that API.
- Atomic writes use a new local file followed by rename and validate the
  temporary workbook before replacement.
- The operator command rejects any new advisory package or any critical
  severity.

These controls reduce reachable risk but do not remove the vulnerable
transitive packages. Track an ExcelJS upgrade or a maintained workbook-library
replacement. Re-review at least quarterly, before each release, and immediately
after `npm audit` changes.
