# Release process

This public repository uses SemVer, matching package/changelog versions,
annotated Git tags, and GitHub Releases.

1. Create a focused branch and keep `docs/IMPLEMENTATION-TASKS.md` synchronized.
2. Update `package.json` and `package-lock.json` to the same version.
3. Add a `docs/CHANGELOG.md` entry with Added, Changed, Fixed, Removed, and
   Tested sections. Keep test timestamps sequential.
4. Run deterministic validation:

   ```sh
   npm ci
   npm run validate
   npm run audit:dependencies
   git diff --check
   ```

5. Run live checks in the intended environment:

   ```sh
   npm run lmstudio:check
   npm run lmstudio:smoke
   npm run homepage:dry-run -- --output /dedicated/validation --tracker /copied/tracker.xlsx
   ```

   Wait for the model, inspect all eleven artifacts and manifest metadata, and
   record exactly what was and was not verified. Unit tests are never evidence
   of a live LM Studio, LM Link, WordPress, Live Link, or Messages path.
6. Open a pull request. Required CI must pass and review feedback must be
   resolved before merge.
7. Merge to `main`, then create an annotated tag matching the package version:

   ```sh
   git tag -a v0.2.0 -m "WP Homepage Agent 0.2.0"
   git push origin v0.2.0
   ```

8. Create a GitHub Release from that tag using the matching changelog entry.
   Include migration/configuration notes, dependency-risk status, deterministic
   results, live-validation scope, and any environment-dependent validation
   still outstanding.

Never tag or publish a release with stale README/environment examples, failing
required checks, unchecked implementation tasks, or undocumented live-test
gaps.
