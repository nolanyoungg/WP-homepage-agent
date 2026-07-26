# WP Homepage Agent

A local-first TypeScript worker that turns one Excel tracker row into one WordPress homepage preview. It generates with an already-installed LM Studio model, writes only to the designated Local theme, requests approval through a user-owned macOS iMessage relay, and changes the Local static front page only after an exact matching approval.

It does **not** create blog posts, articles, categories, tags, production content, plugins, or unrelated automation.

## Safety boundary

The only permitted theme is:

`C:\Users\NolanYoung\Local Sites\7-20-wp-playground\app\public\wp-content\themes\nolan-young-theme-template-02`

The worker resolves and compares that path before work, validates every destination, and refuses any other theme. Generated PHP cannot perform HTTP, filesystem, shell, database, or WordPress-option writes. The worker does not enable Local Live Links. Existing homepage files are not deleted.

## GRASS10 first run

Requirements: Windows GRASS10, Node.js 20+, PHP on `PATH`, WP-CLI available as `wp` (or Local installed in its standard Windows location; the worker discovers the active site PHP/php.ini, suppresses broken optional-extension startup display, and accepts only numeric Page IDs), the configured Local site running, Local Live Link already enabled, and LM Studio serving the selected already-downloaded model through its OpenAI-compatible local API.

1. Copy `.env.example` to `.env`. Keep `.env` untracked.
2. Replace the Live Link placeholder credentials. Never put those credentials in Excel, source, logs, manifests, screenshots, or commits.
3. Configure `IMESSAGE_RELAY_URL`, `IMESSAGE_RELAY_TOKEN`, and `IMESSAGE_RECIPIENT` after setting up the Mac relay in `relay/README.md`.
4. Install and verify:

   ```powershell
   npm install
   npm run build
   npm run lint
   npm run homepage:dry-run
   ```

5. Open `manual-files/wordpress-homepage-tracker.xlsx`, fill one row's `homepage_id` and `homepage_idea`, keep `homepage_status` as `pending`, and optionally set `target_theme_path` to the exact designated theme.
6. Close Excel before running the worker, then run `npm run homepage:once`.

The first invocation claims one row, generates and validates eleven PHP files, installs them into the designated theme, creates/updates a published Local preview Page, verifies its direct Local and Live Link URLs, sends the approval request, and exits in `awaiting_review`. Run the command again to read a reply. A scheduler may invoke it periodically, but concurrent workers are prevented by an adjacent tracker lock file.

This repository does not contain a fixture-based or simulated test suite.
Validation uses compilation, linting, and the real operator workflow with LM
Studio or LM Link, a copied tracker, a disposable Local WordPress site, Live
Link, and the configured Messages transport. Private validation notes and
runtime credentials stay outside this repository.

## Approval behavior

Only these exact messages from the configured sender, received after `review_requested_at`, are accepted:

```text
YES <homepage_id> — make this preview the Local site's homepage
NO <homepage_id> — reject it and leave the current Local homepage unchanged
```

`NO` marks the row rejected without changing the homepage. `YES` sets `show_on_front=page` and `page_on_front` to that exact preview Page ID, verifies the Local homepage response, and only then marks `installed`. Wrong senders, stale messages, whitespace/content changes, and mismatched IDs are ignored. If relay delivery fails, the row becomes `blocked_review_delivery`; a later run retries delivery but never changes the homepage.

## Tracker and generated data

The versioned workbook uses the `Homepage tracker` worksheet and the required 18-column schema. The canonical manifest is stored at `data/homepages/<homepage_id>/manifest.json`. Generated files are staged under ignored `.staging/` and installed as:

- `page-templates/page-template-home-page-MM-DD-YYYY.php`
- ten unique `template-parts/homepage/content-template-<homepage-slug>-NN-<purpose>.php` files

The manifest records ordering, purposes, model, generation time, and SHA-256 checksums. Live Link credentials are never persisted by the worker.

## LM Studio and failure recovery

`homepage:dry-run` is read-only and checks configuration, workbook schema, the exact theme directory, LM Studio/model availability, WP-CLI, the Live Link with in-memory credentials, and the required relay. The real worker never downloads a model and has no mock or cloud provider. The concise plan and each of the ten unique section fragments use separate bounded requests through LM Studio's official [OpenAI-compatible Chat Completions endpoint](https://lmstudio.ai/docs/developer/openai-compat/chat-completions). Only the small plan uses a JSON envelope and is validated with Zod. LM Studio returns static semantic HTML—not executable PHP—for each section; the worker rejects PHP tags, scripts, styles, forms, remote URLs, JavaScript URLs, and inline event handlers, then adds a deterministic ABSPATH-guarded PHP wrapper. The page template and its ten manifest-ordered `get_template_part()` calls are constructed deterministically. Generic model slugs such as `home` fall back to the validated plan title. Non-`stop` finish reasons are rejected, safe LM Studio error messages and named PHP safety-rule violations are retained for diagnosis, a fixed inference seed improves reproducibility, and every PHP result still passes manifest matching, exact-file-count checks, safety scans, path containment, `php -l`, and checksum generation before installation. The worker requests low reasoning effort using current documented [GPT-OSS chat-completions support](https://lmstudio.ai/changelog/lmstudio-v0.4.8). Errors are redacted and recorded in `last_error`. If all eleven validated files were already installed but preview creation failed, the next run automatically copies those exact installed files into temporary staging, revalidates PHP/safety/checksums, and resumes preview creation without calling the model or overwriting the theme. Earlier generation errors still require deliberate reset to `pending`. Do not edit a workbook while the worker is running.

## macOS relay

See `relay/README.md` for the authenticated HTTP contract and setup. The minimal relay sends using Messages automation and reads incoming replies from the local Messages database. The Mac process needs Messages Automation and Full Disk Access. Use a trusted LAN/VPN or TLS reverse proxy; never expose the plain HTTP relay directly to the internet.

## Environment variable reference

The private `.env` file is required at runtime and is ignored by Git. Create it from `.env.example`, then replace every placeholder. Do not paste real Live Link credentials or relay tokens into the workbook, manifests, generated PHP, screenshots, issue reports, or committed documentation.

- `LMSTUDIO_BASE_URL` is the LAN URL for LM Studio's local OpenAI-compatible API. The worker calls `GET /v1/models` and `POST /v1/chat/completions` only at this local endpoint.
- `LMSTUDIO_PRIMARY_MODEL` is the exact model ID that must already be present in LM Studio. A missing model blocks work; the worker does not download one.
- `TRACKER_PATH` points to the `.xlsx` work queue. Relative paths resolve from the repository root.
- `LOCAL_WORDPRESS_ROOT` is the `app/public` directory of the designated Local site. It scopes every WP-CLI command.
- `THEME_PATH` is the only writable theme target. This project deliberately requires `nolan-young-theme-template-02` under the configured WordPress root.
- `LIVE_LINK_URL` is the Live Link origin shown by Local, without a preview Page suffix. The worker combines it with the generated Page path.
- `LIVE_LINK_USERNAME` and `LIVE_LINK_PASSWORD` are Local Live Link access credentials. They stay in process memory and are redacted from worker logs.
- `IMESSAGE_RELAY_URL` is the Mac relay origin, normally `http://<mac-lan-ip>:8787` on a trusted network.
- `IMESSAGE_RELAY_TOKEN` is the shared bearer token configured identically on GRASS10 and the Mac. Use a random value of at least 24 characters.
- `IMESSAGE_RECIPIENT` is the exact phone number or Apple ID address used by Messages. E.164 formatting such as `+15551234567` is recommended because reply sender matching is exact.

Leaving any relay field blank prevents iMessage delivery. The worker then records `blocked_review_delivery` and will never change the static homepage until the relay is configured and an exact, fresh approval reply is received.
