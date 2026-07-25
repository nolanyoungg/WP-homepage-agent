import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { AppConfig } from "../src/config/index.js";
import { PART_SPECS, TRACKER_COLUMNS, TRACKER_SHEET } from "../src/domain/constants.js";
import type {
  HomepagePlan,
  InferenceMetadata,
  TrackerRow
} from "../src/domain/types.js";

export function baseRow(overrides: Partial<TrackerRow> = {}): TrackerRow {
  return {
    homepage_id: "homepage-001",
    homepage_idea: "A careful local landscaping service for homeowners.",
    homepage_status: "pending",
    target_theme_path: "",
    homepage_slug: "",
    template_date: "",
    template_path: "",
    manifest_path: "",
    preview_page_id: "",
    preview_url: "",
    live_link_url: "",
    review_status: "",
    review_token: "",
    review_requested_at: "",
    review_reply_at: "",
    model_used: "",
    last_error: "",
    last_updated_at: "",
    ...overrides
  };
}

export function homepagePlan(overrides: Partial<HomepagePlan> = {}): HomepagePlan {
  return {
    title: "Careful Landscaping",
    pageSlug: "careful-landscaping",
    audience: "Homeowners",
    tone: "Grounded",
    sections: PART_SPECS.map(([key, purpose]) => ({
      key,
      heading: key,
      intent: purpose
    })),
    ...overrides
  };
}

export function inference(
  requestKind: InferenceMetadata["request_kind"] = "plan"
): InferenceMetadata {
  return {
    request_kind: requestKind,
    model_key: "approved/model",
    model_instance_id: "instance-001",
    started_at: "2026-07-25T12:00:00.000Z",
    completed_at: "2026-07-25T12:00:01.000Z",
    duration_ms: 1_000,
    retry_count: 0,
    finish_reason: "stop",
    prompt_tokens: 10,
    completion_tokens: 20,
    total_tokens: 30
  };
}

export async function writeTracker(filePath: string, rows: TrackerRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(TRACKER_SHEET);
  sheet.addRow([...TRACKER_COLUMNS]);
  for (const row of rows) sheet.addRow(TRACKER_COLUMNS.map((key) => row[key]));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await workbook.xlsx.writeFile(filePath);
}

export function appConfig(
  root: string,
  trackerPath: string,
  overrides: {
    adapter?: AppConfig["messaging"]["adapter"];
    recipient?: string;
  } = {}
): AppConfig {
  const wordpressRoot = path.join(root, "wordpress");
  const themePath = path.join(
    wordpressRoot,
    "wp-content",
    "themes",
    "nolan-young-theme-template-02"
  );
  return {
    lmStudio: {
      baseUrl: "http://127.0.0.1:1234",
      primaryModel: "approved/model",
      fallbackModels: [],
      connectionMode: "direct-lan",
      modelPolicy: "required-loaded",
      reasoning: "low",
      minimumVersion: "0.4.8",
      confirmedVersion: "0.4.8",
      healthTimeoutMs: 1_000,
      modelLoadTimeoutMs: 5_000,
      planTimeoutMs: 5_000,
      sectionTimeoutMs: 5_000,
      retryLimit: 0,
      retryBaseDelayMs: 50,
      seed: 42,
      planMaxTokens: 1_000,
      sectionMaxTokens: 1_000,
      structuredPlan: false,
      generationConcurrency: 1
    },
    trackerPath,
    wordpressRoot,
    themePath,
    liveLink: {
      url: "https://preview.example.test",
      username: "preview-user",
      password: "preview-password"
    },
    messaging: {
      adapter: overrides.adapter ?? "dry-run",
      ...(overrides.recipient ? { recipient: overrides.recipient } : {}),
      relayTimeoutMs: 1_000,
      relayListenHost: "127.0.0.1",
      relayListenPort: 0,
      relayDataDir: path.join(root, "relay"),
      chatDb: path.join(root, "chat.db"),
      includeLiveLinkPassword: false
    },
    operations: {
      pollIntervalMs: 10,
      idleBackoffMs: 10,
      preflightCacheMs: 1_000,
      trackerLockStaleMs: 10,
      checkpointMaxAgeMs: 60_000,
      runLogsDir: path.join(root, "runs"),
      homepageDataDir: path.join(root, "homepages")
    }
  };
}

export async function createTheme(config: AppConfig): Promise<void> {
  await fs.mkdir(config.themePath, { recursive: true });
}
