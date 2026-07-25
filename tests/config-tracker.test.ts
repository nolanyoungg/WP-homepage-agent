import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ENVIRONMENT_VARIABLES, loadConfig } from "../src/config/index.js";
import { TrackerStore } from "../src/tracker/store.js";
import { baseRow, writeTracker } from "./helpers.js";

const roots: string[] = [];
async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wp-homepage-agent-config-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function environment(root: string): NodeJS.ProcessEnv {
  const wordpressRoot = path.join(root, "wordpress");
  return {
    LMSTUDIO_BASE_URL: "http://127.0.0.1:1234",
    LMSTUDIO_PRIMARY_MODEL: "approved/model",
    LMSTUDIO_CONFIRMED_VERSION: "0.4.8",
    TRACKER_PATH: path.join(root, "tracker.xlsx"),
    LOCAL_WORDPRESS_ROOT: wordpressRoot,
    THEME_PATH: path.join(wordpressRoot, "wp-content", "themes", "nolan-young-theme-template-02"),
    LIVE_LINK_URL: "https://preview.example.test",
    LIVE_LINK_USERNAME: "preview-user",
    LIVE_LINK_PASSWORD: "preview-password",
    IMESSAGE_ADAPTER: "dry-run"
  };
}

describe("configuration", () => {
  test("uses bounded deterministic defaults and an exact theme boundary", async () => {
    const root = await temporaryRoot();
    const config = loadConfig(environment(root));
    expect(config.lmStudio.seed).toBe(42);
    expect(config.lmStudio.generationConcurrency).toBe(1);
    expect(config.lmStudio.minimumVersion).toBe("0.4.8");
    expect(config.lmStudio.confirmedVersion).toBe("0.4.8");
    expect(config.themePath.endsWith("nolan-young-theme-template-02")).toBe(true);
  });

  test("requires loopback transport in LM Link mode", async () => {
    const root = await temporaryRoot();
    expect(() => loadConfig({
      ...environment(root),
      LMSTUDIO_CONNECTION_MODE: "lmlink",
      LMSTUDIO_BASE_URL: "http://192.0.2.10:1234"
    })).toThrow(/requires LMSTUDIO_BASE_URL to use localhost/);
  });

  test("rejects implicit or duplicate model fallbacks", async () => {
    const root = await temporaryRoot();
    expect(() => loadConfig({
      ...environment(root),
      LMSTUDIO_FALLBACK_MODELS: "approved/fallback,approved/fallback"
    })).toThrow(/duplicate model identifiers/);
    expect(() => loadConfig({
      ...environment(root),
      LMSTUDIO_FALLBACK_MODELS: "approved/model"
    })).toThrow(/must not repeat/);
  });

  test("rejects an unsupported minimum-version policy", async () => {
    const root = await temporaryRoot();
    expect(() => loadConfig({
      ...environment(root),
      LMSTUDIO_MIN_VERSION: "0.4.7"
    })).toThrow(/cannot be lower than 0.4.8/);
    expect(() => loadConfig({
      ...environment(root),
      LMSTUDIO_MIN_VERSION: "0.4.9",
      LMSTUDIO_CONFIRMED_VERSION: "0.4.8"
    })).toThrow(/LMSTUDIO_CONFIRMED_VERSION must be at least 0.4.9/);
  });

  test("rejects committed credential placeholders", async () => {
    const root = await temporaryRoot();
    expect(() => loadConfig({
      ...environment(root),
      LIVE_LINK_PASSWORD: "replace-with-live-link-password"
    })).toThrow(/Replace the Local Live Link placeholders/);
  });

  test("rejects credentials and paths embedded in service origins", async () => {
    const root = await temporaryRoot();
    expect(() => loadConfig({
      ...environment(root),
      LMSTUDIO_BASE_URL: "http://user:password@127.0.0.1:1234"
    })).toThrow(/LMSTUDIO_BASE_URL must be an origin/);
    expect(() => loadConfig({
      ...environment(root),
      LIVE_LINK_URL: "https://preview.example.test/private-path"
    })).toThrow(/LIVE_LINK_URL must be an origin/);
  });

  test("documents every supported environment variable", async () => {
    const example = await fs.readFile(path.resolve(".env.example"), "utf8");
    const documented = new Set(
      [...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1])
    );
    expect([...ENVIRONMENT_VARIABLES].filter((key) => !documented.has(key))).toEqual([]);
  });
});

describe("tracker persistence and locking", () => {
  test("rejects duplicate homepage IDs before selection", async () => {
    const root = await temporaryRoot();
    const tracker = path.join(root, "tracker.xlsx");
    await writeTracker(tracker, [
      baseRow({ homepage_id: "duplicate" }),
      baseRow({ homepage_id: "duplicate", homepage_idea: "A second idea" })
    ]);
    await expect(new TrackerStore(tracker).list()).rejects.toThrow(/duplicate homepage_id/);
  });

  test("recovers a stale lock and claims exactly one row", async () => {
    const root = await temporaryRoot();
    const tracker = path.join(root, "tracker.xlsx");
    await writeTracker(tracker, [baseRow()]);
    const lock = `${tracker}.lock`;
    await fs.writeFile(lock, crypto.randomUUID());
    const old = new Date(Date.now() - 10_000);
    await fs.utimes(lock, old, old);
    const store = new TrackerStore(tracker, 10);
    expect((await store.claimPending())?.homepage_status).toBe("planning");
    expect(await fs.stat(lock).catch(() => undefined)).toBeUndefined();
    expect(await store.claimPending()).toBeUndefined();
  });

  test("leaves the canonical workbook unchanged when atomic persistence fails", async () => {
    const root = await temporaryRoot();
    const tracker = path.join(root, "tracker.xlsx");
    await writeTracker(tracker, [baseRow()]);
    const store = new TrackerStore(tracker);
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("simulated persistence failure"));
    await expect(store.claimPending()).rejects.toThrow(/simulated persistence failure/);
    expect((await store.find("homepage-001"))?.homepage_status).toBe("pending");
  });
});
