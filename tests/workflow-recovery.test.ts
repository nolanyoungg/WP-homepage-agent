import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  MessageAdapter,
  MessageDelivery,
  RelayMessage
} from "../src/domain/types.js";
import { HOMEPAGE_STATES } from "../src/domain/constants.js";
import { ReviewDeliveryStore } from "../src/messaging/delivery-store.js";
import { TRANSITIONS, assertTransition, TrackerStore } from "../src/tracker/store.js";
import type {
  FrontPageSettings,
  PreviewPage,
  WordPressGateway
} from "../src/wordpress/client.js";
import { HomepageWorkflow } from "../src/workflow/homepage.js";
import { afterEach, describe, expect, test } from "vitest";
import { appConfig, baseRow, createTheme, writeTracker } from "./helpers.js";

const roots: string[] = [];
async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wp-homepage-agent-workflow-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

class RecoveryMessages implements MessageAdapter {
  attempts = 0;

  async healthCheck(): Promise<void> {}
  async send(text: string, key: string): Promise<MessageDelivery> {
    void text;
    void key;
    this.attempts += 1;
    if (this.attempts === 1) throw new Error("relay unavailable");
    return { id: "delivery-1", duplicate: false };
  }
  async incoming(since: string): Promise<RelayMessage[]> {
    void since;
    return [];
  }
}

class MutatingWordPress implements WordPressGateway {
  settings: FrontPageSettings = { mode: "posts", pageId: "0" };
  restored = false;

  async healthCheck(): Promise<void> {}
  async homeUrl(): Promise<string> {
    throw new Error("homepage verification failed");
  }
  async createOrUpdatePreview(): Promise<PreviewPage> {
    throw new Error("not used");
  }
  async frontPageSettings(): Promise<FrontPageSettings> {
    return { ...this.settings };
  }
  async setStaticFrontPage(pageId: string): Promise<void> {
    this.settings = { mode: "page", pageId };
  }
  async restoreFrontPage(settings: FrontPageSettings): Promise<void> {
    this.settings = { ...settings };
    this.restored = true;
  }
  async pageAgentId(): Promise<string> {
    return "homepage-001";
  }
  async pageTemplate(): Promise<string> {
    return "page-templates/page-template-home-page-07-25-2026-homepage-001.php";
  }
  async pageUrl(): Promise<string> {
    return "http://127.0.0.1/preview";
  }
}

describe("workflow state machine", () => {
  test("defines and enforces every allowed and rejected state transition", () => {
    for (const from of HOMEPAGE_STATES) {
      for (const to of HOMEPAGE_STATES) {
        const allowed = TRANSITIONS[from].includes(to);
        if (allowed) expect(() => assertTransition(from, to)).not.toThrow();
        else expect(() => assertTransition(from, to)).toThrow(/Invalid tracker transition/);
      }
    }
  });

  test("retries blocked review delivery without regenerating or changing WordPress", async () => {
    const root = await temporaryRoot();
    const trackerPath = path.join(root, "tracker.xlsx");
    const config = appConfig(root, trackerPath, {
      adapter: "dry-run",
      recipient: "+15551234567"
    });
    await createTheme(config);
    await writeTracker(trackerPath, [baseRow({
      homepage_status: "blocked_review_delivery",
      homepage_slug: "careful-landscaping",
      live_link_url: "https://preview.example.test/careful-landscaping/",
      review_status: "requested",
      review_token: "review_token_123456789",
      review_requested_at: "2026-07-25T12:00:00.000Z",
      last_error: "relay unavailable"
    })]);
    const messages = new RecoveryMessages();
    const workflow = new HomepageWorkflow(config, { messages });
    expect((await workflow.runOnce()).outcome).toBe("blocked");
    expect((await workflow.runOnce()).outcome).toBe("awaiting-review");
    expect(messages.attempts).toBe(2);
    expect((await new ReviewDeliveryStore(config.operations.homepageDataDir).read("homepage-001"))?.attempt_count).toBe(2);
    expect((await new TrackerStore(trackerPath).find("homepage-001"))?.homepage_status).toBe("awaiting_review");
  });

  test("rolls WordPress back and records a retryable error when verification fails", async () => {
    const root = await temporaryRoot();
    const trackerPath = path.join(root, "tracker.xlsx");
    const config = appConfig(root, trackerPath);
    await createTheme(config);
    const templatePath = path.join(
      config.themePath,
      "page-templates",
      "page-template-home-page-07-25-2026-homepage-001.php"
    );
    await writeTracker(trackerPath, [baseRow({
      homepage_status: "installing",
      preview_page_id: "42",
      template_path: templatePath,
      review_status: "approved"
    })]);
    const wordpress = new MutatingWordPress();
    const workflow = new HomepageWorkflow(config, { wordpress });
    await expect(workflow.runOnce()).rejects.toThrow(/homepage verification failed/);
    expect(wordpress.restored).toBe(true);
    expect(wordpress.settings).toEqual({ mode: "posts", pageId: "0" });
    const row = await new TrackerStore(trackerPath).find("homepage-001");
    expect(row?.homepage_status).toBe("error");
    expect(row?.last_error).toContain("homepage verification failed");
    expect((await workflow.retry("homepage-001")).homepage_status).toBe("installing");
  });
});
