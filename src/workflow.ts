import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { LmStudioClient } from "./lm-studio.js";
import { TrackerStore } from "./tracker.js";
import { buildManifest, validateManifest, writeManifest } from "./manifest.js";
import { stageGeneratedHomepage } from "./generator.js";
import { validateGeneratedHomepage } from "./validation.js";
import { installHomepage } from "./install.js";
import { SafeLogger } from "./logger.js";
import { approvalText, IMessageRelayClient, parseApproval } from "./relay.js";
import { basicAuthorization, buildLivePreviewUrl } from "./live-link.js";
import { confirmUrl, WordPressClient } from "./wordpress.js";
import { assertSafeHomepageId } from "./paths.js";
import type { HomepageState } from "./constants.js";
import type { TrackerRow } from "./types.js";

async function verifyTheme(config: AppConfig): Promise<void> {
  const stat = await fs.stat(config.themePath);
  if (!stat.isDirectory()) throw new Error("Configured theme path is not a directory");
  const expected = path.join(config.wordpressRoot, "wp-content", "themes", "nolan-young-theme-template-02");
  const [actualReal, expectedReal] = await Promise.all([fs.realpath(config.themePath), fs.realpath(expected)]);
  if (actualReal.toLowerCase() !== expectedReal.toLowerCase()) throw new Error("Configured theme does not resolve to the designated Local theme");
}

function requireRelay(config: AppConfig): IMessageRelayClient {
  if (!config.relayUrl || !config.relayToken || !config.relayRecipient) throw new Error("macOS iMessage relay is not fully configured");
  return new IMessageRelayClient(config.relayUrl, config.relayToken, config.relayRecipient);
}

export class HomepageWorkflow {
  private readonly tracker: TrackerStore;
  private readonly lm: LmStudioClient;
  private readonly wordpress: WordPressClient;
  private readonly logger: SafeLogger;

  constructor(private readonly config: AppConfig) {
    this.tracker = new TrackerStore(config.trackerPath);
    this.lm = new LmStudioClient(config.lmStudioBaseUrl, config.lmStudioModel);
    this.wordpress = new WordPressClient(config.wordpressRoot);
    this.logger = new SafeLogger([config.liveLinkUsername, config.liveLinkPassword, config.relayToken ?? ""]);
  }

  async dryRun(): Promise<void> {
    await verifyTheme(this.config);
    await this.tracker.list();
    await this.lm.healthCheck();
    await this.wordpress.healthCheck();
    await confirmUrl(this.config.liveLinkUrl, basicAuthorization(this.config.liveLinkUsername, this.config.liveLinkPassword));
    await requireRelay(this.config).healthCheck();
    this.logger.info("Dry run passed: tracker, theme, LM Studio model, WordPress, Live Link, and iMessage relay are available");
  }

  async runOnce(): Promise<void> {
    await verifyTheme(this.config);
    const rows = await this.tracker.list();
    const reviewRow = rows.find((row) => row.homepage_status === "awaiting_review" || row.homepage_status === "blocked_review_delivery");
    if (reviewRow) { await this.processReview(reviewRow); return; }
    const resumableRow = rows.find((row) => row.homepage_status === "error" && row.manifest_path && row.template_path && !row.preview_page_id);
    if (resumableRow) { await this.resumeInstalledPreview(resumableRow); return; }
    const row = await this.tracker.claimPending();
    if (!row) { this.logger.info("No pending or reviewable homepage rows"); return; }
    await this.generateAndRequestReview(row);
  }

  private async generateAndRequestReview(row: TrackerRow): Promise<void> {
    let state: HomepageState = "planning";
    assertSafeHomepageId(row.homepage_id);
    const stagingRoot = path.resolve(".staging", `${row.homepage_id}-${crypto.randomUUID()}`);
    try {
      if (row.target_theme_path && path.resolve(row.target_theme_path).toLowerCase() !== this.config.themePath.toLowerCase()) throw new Error("Tracker target_theme_path does not match the designated theme");
      await this.lm.healthCheck();
      row = await this.tracker.patch(row.homepage_id, { homepage_status: "generating", target_theme_path: this.config.themePath, model_used: this.config.lmStudioModel }, "planning");
      state = "generating";
      const plan = await this.lm.generatePlan(row.homepage_idea);
      const manifest = buildManifest(row, plan, this.config.themePath, this.config.lmStudioModel);
      const manifestPath = path.resolve("data", "homepages", row.homepage_id, "manifest.json");
      await writeManifest(manifestPath, manifest);
      const generated = await this.lm.generatePhp(plan, manifest);
      await stageGeneratedHomepage(stagingRoot, manifest, generated);
      row = await this.tracker.patch(row.homepage_id, {
        homepage_status: "validating", homepage_slug: manifest.homepage_slug,
        template_date: manifest.template_filename.replace("page-template-home-page-", "").replace(".php", ""),
        template_path: path.join(this.config.themePath, "page-templates", manifest.template_filename), manifest_path: manifestPath
      }, "generating");
      state = "validating";
      const checkedManifest = await validateGeneratedHomepage(stagingRoot, this.config.themePath, manifest, [this.config.liveLinkUsername, this.config.liveLinkPassword, this.config.relayToken ?? ""]);
      await writeManifest(manifestPath, checkedManifest);
      await installHomepage(stagingRoot, this.config.themePath, checkedManifest);
      const preview = await this.wordpress.createOrUpdatePreview(plan, checkedManifest);
      await confirmUrl(preview.url);
      const liveUrl = buildLivePreviewUrl(this.config.liveLinkUrl, preview.url);
      await confirmUrl(liveUrl, basicAuthorization(this.config.liveLinkUsername, this.config.liveLinkPassword));
      const reviewToken = crypto.randomUUID();
      const requestedAt = new Date().toISOString();
      row = await this.tracker.patch(row.homepage_id, {
        preview_page_id: preview.id, preview_url: preview.url, live_link_url: liveUrl,
        review_status: "requested", review_token: reviewToken, review_requested_at: requestedAt
      }, "validating");
      try {
        const relay = requireRelay(this.config);
        await relay.healthCheck();
        await relay.send(approvalText(row.homepage_id, liveUrl, this.config.liveLinkUsername, this.config.liveLinkPassword), reviewToken);
        await this.tracker.patch(row.homepage_id, { homepage_status: "awaiting_review" }, "validating");
        this.logger.info(`Homepage ${row.homepage_id} is awaiting an exact iMessage approval reply`);
      } catch (error) {
        await this.tracker.patch(row.homepage_id, { homepage_status: "blocked_review_delivery", last_error: error instanceof Error ? error.message : String(error) }, "validating");
        this.logger.error(`Homepage ${row.homepage_id} is blocked because review delivery failed`, error instanceof Error ? error.message : error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try { await this.tracker.patch(row.homepage_id, { homepage_status: "error", last_error: message }, state); } catch { /* preserve original failure */ }
      this.logger.error(`Homepage ${row.homepage_id} failed`, message);
      throw error;
    } finally {
      await fs.rm(stagingRoot, { recursive: true, force: true });
    }
  }

  private async resumeInstalledPreview(row: TrackerRow): Promise<void> {
    assertSafeHomepageId(row.homepage_id);
    const stagingRoot = path.resolve(".staging", `${row.homepage_id}-resume-${crypto.randomUUID()}`);
    try {
      row = await this.tracker.patch(row.homepage_id, { homepage_status: "validating", last_error: "" }, "error");
      const manifest = validateManifest(JSON.parse(await fs.readFile(row.manifest_path, "utf8")));
      if (path.resolve(manifest.target_theme_path).toLowerCase() !== this.config.themePath.toLowerCase()) throw new Error("Resume manifest target does not match the designated theme");
      const templateDirectory = path.join(stagingRoot, "page-templates");
      const partsDirectory = path.join(stagingRoot, "template-parts", "homepage");
      await fs.mkdir(templateDirectory, { recursive: true });
      await fs.mkdir(partsDirectory, { recursive: true });
      await fs.copyFile(path.join(this.config.themePath, "page-templates", manifest.template_filename), path.join(templateDirectory, manifest.template_filename));
      for (const part of manifest.parts) {
        await fs.copyFile(path.join(this.config.themePath, "template-parts", "homepage", part.filename), path.join(partsDirectory, part.filename));
      }
      const checkedManifest = await validateGeneratedHomepage(stagingRoot, this.config.themePath, manifest, [this.config.liveLinkUsername, this.config.liveLinkPassword, this.config.relayToken ?? ""]);
      await writeManifest(row.manifest_path, checkedManifest);
      const title = checkedManifest.homepage_slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
      const plan = {
        title, pageSlug: checkedManifest.homepage_slug, audience: "Local preview reviewer", tone: "Professional",
        sections: checkedManifest.parts.map((part) => ({ key: part.key, heading: part.key, intent: part.purpose }))
      };
      const preview = await this.wordpress.createOrUpdatePreview(plan, checkedManifest);
      await confirmUrl(preview.url);
      const liveUrl = buildLivePreviewUrl(this.config.liveLinkUrl, preview.url);
      await confirmUrl(liveUrl, basicAuthorization(this.config.liveLinkUsername, this.config.liveLinkPassword));
      const reviewToken = crypto.randomUUID();
      const requestedAt = new Date().toISOString();
      row = await this.tracker.patch(row.homepage_id, {
        preview_page_id: preview.id, preview_url: preview.url, live_link_url: liveUrl,
        review_status: "requested", review_token: reviewToken, review_requested_at: requestedAt
      }, "validating");
      try {
        const relay = requireRelay(this.config);
        await relay.healthCheck();
        await relay.send(approvalText(row.homepage_id, liveUrl, this.config.liveLinkUsername, this.config.liveLinkPassword), reviewToken);
        await this.tracker.patch(row.homepage_id, { homepage_status: "awaiting_review" }, "validating");
      } catch (error) {
        await this.tracker.patch(row.homepage_id, { homepage_status: "blocked_review_delivery", last_error: error instanceof Error ? error.message : String(error) }, "validating");
        this.logger.error(`Homepage ${row.homepage_id} is blocked because review delivery failed`, error instanceof Error ? error.message : error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try { await this.tracker.patch(row.homepage_id, { homepage_status: "error", last_error: message }, "validating"); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      await fs.rm(stagingRoot, { recursive: true, force: true });
    }
  }
  private async processReview(row: TrackerRow): Promise<void> {
    const relay = requireRelay(this.config);
    if (row.homepage_status === "blocked_review_delivery") {
      try {
        await relay.healthCheck();
        const requestedAt = new Date().toISOString();
        await relay.send(approvalText(row.homepage_id, row.live_link_url, this.config.liveLinkUsername, this.config.liveLinkPassword), row.review_token);
        row = await this.tracker.patch(row.homepage_id, { homepage_status: "awaiting_review", review_requested_at: requestedAt, last_error: "" }, "blocked_review_delivery");
      } catch (error) {
        this.logger.error(`Homepage ${row.homepage_id} remains blocked on review delivery`, error instanceof Error ? error.message : error);
        return;
      }
    }
    const messages = await relay.incoming(row.review_requested_at);
    const decisionMessage = messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).find((message) => parseApproval(message, row.homepage_id, this.config.relayRecipient!, row.review_requested_at));
    if (!decisionMessage) { this.logger.info(`No valid approval reply for homepage ${row.homepage_id}`); return; }
    const decision = parseApproval(decisionMessage, row.homepage_id, this.config.relayRecipient!, row.review_requested_at)!;
    if (decision === "rejected") {
      await this.tracker.patch(row.homepage_id, { homepage_status: "rejected", review_status: "rejected", review_reply_at: decisionMessage.receivedAt }, "awaiting_review");
      this.logger.info(`Homepage ${row.homepage_id} was rejected; current Local homepage was unchanged`);
      return;
    }
    await this.tracker.patch(row.homepage_id, { homepage_status: "approved", review_status: "approved", review_reply_at: decisionMessage.receivedAt }, "awaiting_review");
    await this.tracker.patch(row.homepage_id, { homepage_status: "installing" }, "approved");
    try {
      await this.wordpress.setStaticFrontPage(row.preview_page_id);
      const homeUrl = await this.wordpress.homeUrl();
      await confirmUrl(homeUrl);
      await this.tracker.patch(row.homepage_id, { homepage_status: "installed" }, "installing");
      this.logger.info(`Homepage ${row.homepage_id} is now the verified Local static front page`);
    } catch (error) {
      await this.tracker.patch(row.homepage_id, { homepage_status: "error", last_error: error instanceof Error ? error.message : String(error) }, "installing");
      throw error;
    }
  }

}






