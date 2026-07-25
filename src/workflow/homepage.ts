import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/index.js";
import { PROMPT_VERSION, type HomepageState } from "../domain/constants.js";
import { buildManifest, validateManifest, writeManifest, sha256 } from "../domain/manifest.js";
import type {
  HomepageCheckpoint,
  HomepageManifest,
  HomepagePlan,
  MessageAdapter,
  TrackerRow,
  WorkflowRunResult
} from "../domain/types.js";
import { CheckpointStore, cleanupExpiredCheckpoints } from "../generation/checkpoint.js";
import { LmStudioClient } from "../lmstudio/client.js";
import { redact, SafeRunLogger } from "../logging/logger.js";
import { approvalText, parseApproval } from "../messaging/approval.js";
import { createMessageAdapter } from "../messaging/adapters.js";
import { ReviewDeliveryStore } from "../messaging/delivery-store.js";
import { TrackerStore } from "../tracker/store.js";
import { validateGeneratedHomepage } from "../validation/homepage.js";
import { assertPathInside, assertSafeHomepageId } from "../validation/paths.js";
import { WordPressClient, type WordPressGateway } from "../wordpress/client.js";
import { basicAuthorization, buildLivePreviewUrl, confirmUrl } from "../wordpress/live-link.js";
import { installHomepage } from "./install.js";

async function verifyTheme(config: AppConfig): Promise<void> {
  const stat = await fs.stat(config.themePath);
  if (!stat.isDirectory()) throw new Error("Configured theme path is not a directory");
  const expected = path.join(config.wordpressRoot, "wp-content", "themes", "nolan-young-theme-template-02");
  const [actualReal, expectedReal] = await Promise.all([
    fs.realpath(config.themePath),
    fs.realpath(expected)
  ]);
  if (actualReal.toLowerCase() !== expectedReal.toLowerCase()) {
    throw new Error("Configured theme does not resolve to the designated Local theme");
  }
}

function nonceFromReviewToken(token: string): string {
  const nonce = token.replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
  if (nonce.length < 8) throw new Error("Review token cannot produce a safe approval nonce");
  return nonce;
}

function safeSecrets(config: AppConfig): string[] {
  return [
    config.lmStudio.apiToken ?? "",
    config.liveLink.username,
    config.liveLink.password,
    config.messaging.relayToken ?? ""
  ];
}

function safeErrorMessage(config: AppConfig, error: unknown): string {
  const original = error instanceof Error ? error.message : String(error);
  return String(redact(original, safeSecrets(config))).slice(0, 2_000);
}

export class HomepageWorkflow {
  readonly runId: string;
  private readonly tracker: TrackerStore;
  private readonly logger: SafeRunLogger;
  private readonly lm: LmStudioClient;
  private readonly wordpress: WordPressGateway;
  private readonly messages: MessageAdapter;
  private readonly deliveries: ReviewDeliveryStore;
  private fullPreflightAt = 0;

  constructor(
    private readonly config: AppConfig,
    dependencies: {
      wordpress?: WordPressGateway;
      messages?: MessageAdapter;
      runId?: string;
    } = {}
  ) {
    this.runId = dependencies.runId ?? crypto.randomUUID();
    this.tracker = new TrackerStore(config.trackerPath, config.operations.trackerLockStaleMs);
    this.logger = new SafeRunLogger(this.runId, config.operations.runLogsDir, safeSecrets(config));
    this.lm = new LmStudioClient(config.lmStudio, this.logger);
    this.wordpress = dependencies.wordpress ?? new WordPressClient(config.wordpressRoot);
    this.messages = dependencies.messages ?? createMessageAdapter(config);
    this.deliveries = new ReviewDeliveryStore(config.operations.homepageDataDir);
  }

  async preflight(options: { requireMessaging?: boolean; requireWordPress?: boolean; force?: boolean } = {}): Promise<void> {
    const requireMessaging = options.requireMessaging ?? true;
    const requireWordPress = options.requireWordPress ?? true;
    const isFullPreflight = requireMessaging && requireWordPress;
    if (
      isFullPreflight
      && !options.force
      && Date.now() - this.fullPreflightAt <= this.config.operations.preflightCacheMs
    ) return;
    await verifyTheme(this.config);
    await this.tracker.list();
    const removed = await cleanupExpiredCheckpoints(
      this.config.operations.homepageDataDir,
      this.config.operations.checkpointMaxAgeMs
    );
    await this.lm.healthCheck();
    if (requireWordPress) {
      await this.wordpress.healthCheck();
      await confirmUrl(
        this.config.liveLink.url,
        basicAuthorization(this.config.liveLink.username, this.config.liveLink.password)
      );
    }
    if (requireMessaging) await this.messages.healthCheck();
    if (isFullPreflight) this.fullPreflightAt = Date.now();
    await this.logger.write("workflow.preflight_succeeded", {
      require_messaging: requireMessaging,
      require_wordpress: requireWordPress,
      expired_checkpoints_removed: removed,
      connection_mode: this.config.lmStudio.connectionMode
    });
  }

  async runOnce(): Promise<WorkflowRunResult> {
    return this.tracker.withWorkerLease(() => this.runOnceWithLease());
  }

  private async runOnceWithLease(): Promise<WorkflowRunResult> {
    await verifyTheme(this.config);
    const rows = await this.tracker.list();

    const installing = rows.find((row) => row.homepage_status === "installing");
    if (installing) {
      await this.finishInstallation(installing);
      return { outcome: "processed", homepageId: installing.homepage_id };
    }

    const approved = rows.find((row) => row.homepage_status === "approved");
    if (approved) {
      await this.activateApproved(approved);
      return { outcome: "processed", homepageId: approved.homepage_id };
    }

    const review = rows.find((row) =>
      row.homepage_status === "awaiting_review" || row.homepage_status === "blocked_review_delivery"
    );
    if (review) {
      const processed = await this.processReview(review);
      const current = processed ? undefined : await this.tracker.find(review.homepage_id);
      return {
        outcome: processed
          ? "processed"
          : current?.homepage_status === "blocked_review_delivery"
            ? "blocked"
            : "awaiting-review",
        homepageId: review.homepage_id
      };
    }

    const resumable = rows.find((row) =>
      row.homepage_status === "planning"
      || row.homepage_status === "generating"
      || row.homepage_status === "validating"
    );
    if (resumable) {
      await this.generateAndRequestReview(resumable);
      return { outcome: "processed", homepageId: resumable.homepage_id };
    }

    await this.preflight({ requireMessaging: true, requireWordPress: true });
    const row = await this.tracker.claimPending();
    if (!row) {
      await this.logger.write("workflow.no_pending_rows");
      return { outcome: "no-work" };
    }
    await this.generateAndRequestReview(row);
    return { outcome: "processed", homepageId: row.homepage_id };
  }

  private async deliverReview(
    row: TrackerRow,
    reviewToken: string,
    liveUrl: string,
    context: Record<string, unknown> = {}
  ): Promise<{ id: string; duplicate: boolean; attempt: number }> {
    const attempt = await this.deliveries.begin(row.homepage_id, reviewToken);
    try {
      const delivery = await this.messages.send(
        approvalText(
          row.homepage_id,
          nonceFromReviewToken(reviewToken),
          liveUrl,
          this.config.liveLink.username,
          this.config.messaging.includeLiveLinkPassword ? this.config.liveLink.password : undefined
        ),
        reviewToken
      );
      await this.deliveries.succeeded(attempt, delivery);
      await this.logger.write("review.delivery_succeeded", {
        homepage_id: row.homepage_id,
        delivery_id: delivery.id,
        duplicate: delivery.duplicate,
        attempt: attempt.attempt_count,
        attempted_at: attempt.last_attempt_at,
        ...context
      });
      return { ...delivery, attempt: attempt.attempt_count };
    } catch (error) {
      const message = safeErrorMessage(this.config, error);
      await this.deliveries.failed(attempt, message);
      await this.logger.write("review.delivery_failed", {
        homepage_id: row.homepage_id,
        attempt: attempt.attempt_count,
        attempted_at: attempt.last_attempt_at,
        error: message,
        ...context
      });
      throw error;
    }
  }

  private async generateMissingParts(checkpoint: HomepageCheckpoint, store: CheckpointStore): Promise<HomepageCheckpoint> {
    let current = checkpoint;
    const completed = new Set(current.completed_parts.map((part) => part.key));
    const missing = current.manifest.parts.filter((part) => !completed.has(part.key));
    const concurrency = this.config.lmStudio.generationConcurrency;
    for (let index = 0; index < missing.length; index += concurrency) {
      const batch = missing.slice(index, index + concurrency);
      const generated = await Promise.all(batch.map(async (part) => ({
        part,
        result: await this.lm.generateSection(current.plan, part)
      })));
      for (const entry of generated) {
        current = await store.saveSection(
          current,
          entry.part,
          entry.result.html,
          entry.result.metadata
        );
        await this.logger.write("workflow.section_checkpointed", {
          homepage_id: current.homepage_id,
          section_key: entry.part.key,
          completed_parts: current.completed_parts.length,
          total_parts: current.manifest.parts.length
        });
      }
    }
    return current;
  }

  private async generateAndRequestReview(initialRow: TrackerRow): Promise<void> {
    let row = initialRow;
    let state: HomepageState = row.homepage_status;
    assertSafeHomepageId(row.homepage_id);
    if (row.target_theme_path && path.resolve(row.target_theme_path).toLowerCase() !== this.config.themePath.toLowerCase()) {
      throw new Error("Tracker target_theme_path does not match the designated theme");
    }
    await this.preflight({ requireMessaging: true, requireWordPress: true });
    const selection = this.lm.selectedModel();
    const store = new CheckpointStore(this.config.operations.homepageDataDir, row.homepage_id);
    const stagingRoot = path.resolve(".staging", `${row.homepage_id}-${this.runId}`);
    assertPathInside(path.resolve(".staging"), stagingRoot);
    try {
      let checkpoint = await store.loadCompatible(
        row,
        this.config.themePath,
        selection.key,
        selection.instanceId
      );

      if (!checkpoint && state === "validating" && row.manifest_path) {
        await this.resumeInstalledPreview(row);
        return;
      }

      if (!checkpoint) {
        if (state === "planning") {
          row = await this.tracker.patch(row.homepage_id, {
            homepage_status: "generating",
            target_theme_path: this.config.themePath,
            model_used: selection.key,
            last_error: ""
          }, "planning");
          state = "generating";
        } else if (state !== "generating") {
          throw new Error(`Cannot start generation from state ${state}`);
        }
        const generatedPlan = await this.lm.generatePlan(row.homepage_idea);
        const manifest = buildManifest(
          row,
          generatedPlan.plan,
          this.config.themePath,
          selection.key,
          selection.instanceId,
          this.runId,
          generatedPlan.metadata
        );
        checkpoint = await store.initialize(
          row,
          this.config.themePath,
          selection.key,
          selection.instanceId,
          generatedPlan.plan,
          generatedPlan.metadata,
          manifest
        );
        row = await this.tracker.patch(row.homepage_id, {
          homepage_slug: manifest.homepage_slug,
          template_date: manifest.template_filename.match(/\d{2}-\d{2}-\d{4}/)?.[0] ?? "",
          template_path: path.join(this.config.themePath, "page-templates", manifest.template_filename),
          manifest_path: store.manifestFile,
          model_used: selection.key
        }, "generating");
      } else {
        await this.logger.write("workflow.checkpoint_resumed", {
          homepage_id: row.homepage_id,
          completed_parts: checkpoint.completed_parts.length,
          total_parts: checkpoint.manifest.parts.length
        });
        if (state === "planning") {
          row = await this.tracker.patch(row.homepage_id, {
            homepage_status: "generating",
            target_theme_path: this.config.themePath,
            homepage_slug: checkpoint.manifest.homepage_slug,
            template_path: path.join(this.config.themePath, "page-templates", checkpoint.manifest.template_filename),
            manifest_path: store.manifestFile,
            model_used: selection.key,
            last_error: ""
          }, "planning");
          state = "generating";
        }
      }

      checkpoint = await this.generateMissingParts(checkpoint, store);
      if (state === "generating") {
        row = await this.tracker.patch(row.homepage_id, { homepage_status: "validating" }, "generating");
        state = "validating";
      }
      await fs.rm(stagingRoot, { recursive: true, force: true });
      await store.stage(checkpoint, stagingRoot);
      const checkedManifest = await validateGeneratedHomepage(
        stagingRoot,
        this.config.themePath,
        checkpoint.manifest,
        safeSecrets(this.config)
      );
      await writeManifest(store.manifestFile, checkedManifest);
      const installed = await installHomepage(stagingRoot, this.config.themePath, checkedManifest);
      await this.logger.write("workflow.theme_files_installed", {
        homepage_id: row.homepage_id,
        installed_count: installed.installed.length,
        reused_count: installed.reused.length
      });
      const preview = await this.wordpress.createOrUpdatePreview(
        checkpoint.plan,
        checkedManifest,
        row.preview_page_id || undefined
      );
      await confirmUrl(preview.url);
      const liveUrl = buildLivePreviewUrl(this.config.liveLink.url, preview.url);
      await confirmUrl(
        liveUrl,
        basicAuthorization(this.config.liveLink.username, this.config.liveLink.password)
      );
      const reviewToken = row.review_token || crypto.randomBytes(18).toString("base64url");
      const requestedAt = new Date().toISOString();
      row = await this.tracker.patch(row.homepage_id, {
        preview_page_id: preview.id,
        preview_url: preview.url,
        live_link_url: liveUrl,
        review_status: "requested",
        review_token: reviewToken,
        review_requested_at: requestedAt,
        manifest_path: store.manifestFile,
        last_error: ""
      }, "validating");
      try {
        await this.deliverReview(row, reviewToken, liveUrl, { requested_at: requestedAt });
        await this.tracker.patch(row.homepage_id, { homepage_status: "awaiting_review" }, "validating");
        await store.complete();
      } catch (error) {
        await this.tracker.patch(row.homepage_id, {
          homepage_status: "blocked_review_delivery",
          last_error: safeErrorMessage(this.config, error)
        }, "validating");
      }
    } catch (error) {
      const message = safeErrorMessage(this.config, error);
      const current = await this.tracker.find(row.homepage_id).catch(() => undefined);
      if (current && ["planning", "generating", "validating"].includes(current.homepage_status)) {
        await this.tracker.patch(row.homepage_id, {
          homepage_status: "error",
          last_error: message
        }, current.homepage_status).catch(() => undefined);
      }
      await this.logger.write("workflow.generation_failed", {
        homepage_id: row.homepage_id,
        state,
        error: message,
        checkpoint_preserved: true
      });
      throw error;
    } finally {
      await fs.rm(stagingRoot, { recursive: true, force: true });
    }
  }

  private async resumeInstalledPreview(row: TrackerRow): Promise<void> {
    const manifest = validateManifest(JSON.parse(await fs.readFile(row.manifest_path, "utf8")));
    if (path.resolve(manifest.target_theme_path).toLowerCase() !== this.config.themePath.toLowerCase()) {
      throw new Error("Resume manifest target does not match the designated theme");
    }
    const plan: HomepagePlan = {
      title: manifest.homepage_slug.split("-").map((word) =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(" "),
      pageSlug: manifest.homepage_slug,
      audience: "Local preview reviewer",
      tone: "Professional",
      sections: manifest.parts.map((part) => ({
        key: part.key,
        heading: part.key,
        intent: part.purpose
      }))
    };
    const stagingRoot = path.resolve(".staging", `${row.homepage_id}-legacy-${this.runId}`);
    try {
      await fs.mkdir(path.join(stagingRoot, "page-templates"), { recursive: true });
      await fs.mkdir(path.join(stagingRoot, "template-parts", "homepage"), { recursive: true });
      await fs.copyFile(
        path.join(this.config.themePath, "page-templates", manifest.template_filename),
        path.join(stagingRoot, "page-templates", manifest.template_filename)
      );
      for (const part of manifest.parts) {
        await fs.copyFile(
          path.join(this.config.themePath, "template-parts", "homepage", part.filename),
          path.join(stagingRoot, "template-parts", "homepage", part.filename)
        );
      }
      const checked = await validateGeneratedHomepage(
        stagingRoot,
        this.config.themePath,
        manifest,
        safeSecrets(this.config)
      );
      await writeManifest(row.manifest_path, checked);
      const preview = await this.wordpress.createOrUpdatePreview(plan, checked, row.preview_page_id || undefined);
      await confirmUrl(preview.url);
      const liveUrl = buildLivePreviewUrl(this.config.liveLink.url, preview.url);
      await confirmUrl(
        liveUrl,
        basicAuthorization(this.config.liveLink.username, this.config.liveLink.password)
      );
      const token = row.review_token || crypto.randomBytes(18).toString("base64url");
      const requestedAt = new Date().toISOString();
      row = await this.tracker.patch(row.homepage_id, {
        preview_page_id: preview.id,
        preview_url: preview.url,
        live_link_url: liveUrl,
        review_status: "requested",
        review_token: token,
        review_requested_at: requestedAt,
        last_error: ""
      }, "validating");
      try {
        await this.deliverReview(row, token, liveUrl, { legacy_resume: true });
        await this.tracker.patch(row.homepage_id, { homepage_status: "awaiting_review" }, "validating");
      } catch (error) {
        await this.tracker.patch(row.homepage_id, {
          homepage_status: "blocked_review_delivery",
          last_error: safeErrorMessage(this.config, error)
        }, "validating");
      }
    } finally {
      await fs.rm(stagingRoot, { recursive: true, force: true });
    }
  }

  private async processReview(initialRow: TrackerRow): Promise<boolean> {
    let row = initialRow;
    await this.messages.healthCheck();
    if (row.homepage_status === "blocked_review_delivery") {
      const attemptedAt = new Date().toISOString();
      try {
        const delivery = await this.deliverReview(row, row.review_token, row.live_link_url, {
          recovery: true
        });
        row = await this.tracker.patch(row.homepage_id, {
          homepage_status: "awaiting_review",
          review_requested_at: delivery.duplicate ? row.review_requested_at : attemptedAt,
          last_error: ""
        }, "blocked_review_delivery");
        await this.logger.write("review.delivery_recovered", {
          homepage_id: row.homepage_id,
          delivery_id: delivery.id,
          duplicate: delivery.duplicate,
          attempt: delivery.attempt
        });
      } catch (error) {
        await this.logger.write("review.delivery_still_blocked", {
          homepage_id: row.homepage_id,
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      }
    }
    const nonce = nonceFromReviewToken(row.review_token);
    const messages = await this.messages.incoming(row.review_requested_at);
    const decisionMessage = messages
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .find((message) => parseApproval(
        message,
        row.homepage_id,
        nonce,
        this.config.messaging.recipient!,
        row.review_requested_at
      ));
    if (!decisionMessage) {
      await this.logger.write("review.no_valid_reply", { homepage_id: row.homepage_id });
      return false;
    }
    const decision = parseApproval(
      decisionMessage,
      row.homepage_id,
      nonce,
      this.config.messaging.recipient!,
      row.review_requested_at
    )!;
    if (decision === "rejected") {
      await this.tracker.patch(row.homepage_id, {
        homepage_status: "rejected",
        review_status: "rejected",
        review_reply_at: decisionMessage.receivedAt
      }, "awaiting_review");
      await this.logger.write("review.rejected", { homepage_id: row.homepage_id });
      return true;
    }
    row = await this.tracker.patch(row.homepage_id, {
      homepage_status: "approved",
      review_status: "approved",
      review_reply_at: decisionMessage.receivedAt
    }, "awaiting_review");
    await this.activateApproved(row);
    return true;
  }

  private async validatePreviewOwnership(row: TrackerRow): Promise<void> {
    if (!/^\d+$/.test(row.preview_page_id)) throw new Error("Tracker preview Page ID is invalid");
    const [owner, template] = await Promise.all([
      this.wordpress.pageAgentId(row.preview_page_id),
      this.wordpress.pageTemplate(row.preview_page_id)
    ]);
    if (owner !== row.homepage_id) throw new Error("Preview Page is not owned by this homepage");
    const expectedTemplate = `page-templates/${path.basename(row.template_path)}`;
    if (template !== expectedTemplate) throw new Error("Preview Page template does not match the tracker");
  }

  private async activateApproved(row: TrackerRow): Promise<void> {
    await this.validatePreviewOwnership(row);
    row = await this.tracker.patch(row.homepage_id, { homepage_status: "installing" }, "approved");
    await this.finishInstallation(row);
  }

  private async finishInstallation(row: TrackerRow): Promise<void> {
    await this.wordpress.healthCheck();
    await this.validatePreviewOwnership(row);
    const current = await this.wordpress.frontPageSettings();
    if (current.mode === "page" && current.pageId === row.preview_page_id) {
      await confirmUrl(await this.wordpress.homeUrl());
      await this.tracker.patch(row.homepage_id, {
        homepage_status: "installed",
        last_error: ""
      }, "installing");
      await this.logger.write("wordpress.front_page_reconciled", { homepage_id: row.homepage_id });
      return;
    }
    try {
      await this.wordpress.setStaticFrontPage(row.preview_page_id);
      await confirmUrl(await this.wordpress.homeUrl());
      await this.tracker.patch(row.homepage_id, {
        homepage_status: "installed",
        last_error: ""
      }, "installing");
      await this.logger.write("wordpress.front_page_installed", {
        homepage_id: row.homepage_id,
        page_id: row.preview_page_id
      });
    } catch (error) {
      await this.wordpress.restoreFrontPage(current).catch(async (rollbackError) => {
        await this.logger.write("wordpress.front_page_rollback_failed", {
          homepage_id: row.homepage_id,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        });
      });
      await this.tracker.patch(row.homepage_id, {
        homepage_status: "error",
        last_error: safeErrorMessage(this.config, error)
      }, "installing");
      throw error;
    }
  }

  async retry(homepageId: string): Promise<TrackerRow> {
    const row = await this.tracker.prepareRetry(homepageId);
    await this.logger.write("workflow.retry_prepared", {
      homepage_id: row.homepage_id,
      state: row.homepage_status
    });
    return row;
  }

  async status(): Promise<Array<Record<string, string>>> {
    return (await this.tracker.list()).map((row) => ({
      homepage_id: row.homepage_id,
      homepage_status: row.homepage_status,
      review_status: row.review_status,
      preview_page_id: row.preview_page_id,
      model_used: row.model_used,
      last_updated_at: row.last_updated_at,
      last_error: row.last_error
    }));
  }

  async reconcile(homepageId: string): Promise<Record<string, unknown>> {
    const row = await this.tracker.find(homepageId);
    if (!row) throw new Error(`Homepage row not found: ${homepageId}`);
    let manifest: HomepageManifest | undefined;
    let manifestError: string | undefined;
    try {
      manifest = validateManifest(JSON.parse(await fs.readFile(row.manifest_path, "utf8")));
    } catch (error) {
      manifestError = error instanceof Error ? error.message : String(error);
    }
    const files: Array<Record<string, unknown>> = [];
    if (manifest) {
      const expected = [
        {
          path: path.join(this.config.themePath, "page-templates", manifest.template_filename),
          checksum: manifest.template_checksum_sha256
        },
        ...manifest.parts.map((part) => ({
          path: path.join(this.config.themePath, "template-parts", "homepage", part.filename),
          checksum: part.checksum_sha256
        }))
      ];
      for (const file of expected) {
        try {
          const checksum = await sha256(file.path);
          files.push({
            path: file.path,
            exists: true,
            checksum_matches: Boolean(file.checksum && checksum === file.checksum)
          });
        } catch {
          files.push({ path: file.path, exists: false, checksum_matches: false });
        }
      }
    }
    let wordpress: Record<string, unknown> = { available: false };
    try {
      await this.wordpress.healthCheck();
      const front = await this.wordpress.frontPageSettings();
      wordpress = {
        available: true,
        front_page_mode: front.mode,
        front_page_id: front.pageId,
        is_expected_front_page: front.mode === "page" && front.pageId === row.preview_page_id,
        ...(row.preview_page_id ? {
          preview_owner: await this.wordpress.pageAgentId(row.preview_page_id),
          preview_template: await this.wordpress.pageTemplate(row.preview_page_id),
          preview_url: await this.wordpress.pageUrl(row.preview_page_id)
        } : {})
      };
    } catch (error) {
      wordpress = {
        available: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      checked_at: new Date().toISOString(),
      prompt_version: PROMPT_VERSION,
      tracker: await this.status().then((rows) => rows.find((candidate) => candidate.homepage_id === homepageId)),
      manifest: manifest ? {
        valid: true,
        schema_version: manifest.schema_version,
        model: manifest.model,
        model_instance_id: manifest.model_instance_id,
        prompt_version: manifest.prompt_version
      } : { valid: false, error: manifestError },
      files,
      wordpress
    };
  }

  async generateDryRun(outputRoot: string): Promise<Record<string, unknown>> {
    const rows = await this.tracker.list();
    const row = rows.find((candidate) => candidate.homepage_status === "pending");
    if (!row) throw new Error("Dry-run tracker does not contain a pending homepage row");
    await verifyTheme(this.config);
    await this.lm.healthCheck();
    const selection = this.lm.selectedModel();
    const outputParent = path.resolve(outputRoot);
    const forbidden = new Set([
      path.parse(outputParent).root,
      path.resolve("."),
      path.resolve(process.env.HOME ?? path.parse(outputParent).root),
      this.config.wordpressRoot,
      this.config.themePath
    ].map((entry) => entry.toLowerCase()));
    if (forbidden.has(outputParent.toLowerCase())) {
      throw new Error("Dry-run output must be a dedicated directory outside the repository, home directory, WordPress root, and theme");
    }
    const output = path.join(outputParent, `homepage-dry-run-${this.runId}`);
    assertPathInside(outputParent, output);
    const dataRoot = path.join(output, "data", "homepages");
    const stagingRoot = path.join(output, "staging");
    assertPathInside(output, dataRoot);
    assertPathInside(output, stagingRoot);
    await fs.mkdir(output, { recursive: false });
    const generatedPlan = await this.lm.generatePlan(row.homepage_idea);
    const manifest = buildManifest(
      row,
      generatedPlan.plan,
      this.config.themePath,
      selection.key,
      selection.instanceId,
      this.runId,
      generatedPlan.metadata
    );
    const store = new CheckpointStore(dataRoot, row.homepage_id);
    let checkpoint = await store.initialize(
      row,
      this.config.themePath,
      selection.key,
      selection.instanceId,
      generatedPlan.plan,
      generatedPlan.metadata,
      manifest
    );
    checkpoint = await this.generateMissingParts(checkpoint, store);
    await store.stage(checkpoint, stagingRoot);
    const checked = await validateGeneratedHomepage(
      stagingRoot,
      this.config.themePath,
      checkpoint.manifest,
      safeSecrets(this.config)
    );
    await writeManifest(store.manifestFile, checked);
    await store.complete();
    const result = {
      homepage_id: row.homepage_id,
      output_root: output,
      manifest_path: store.manifestFile,
      staging_root: stagingRoot,
      model: selection.key,
      model_instance_id: selection.instanceId,
      prompt_version: PROMPT_VERSION,
      artifact_count: 11
    };
    await this.logger.write("workflow.real_model_dry_run_succeeded", result);
    return result;
  }
}
