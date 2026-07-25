import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { EXPECTED_THEME_DIRECTORY } from "../domain/constants.js";
import { isPathInside } from "../validation/paths.js";

loadDotenv();

const optionalString = z.preprocess((value) => value === "" || value === undefined ? undefined : value, z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => value === "" || value === undefined ? undefined : value, z.string().url().optional());
const integer = (fallback: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
  z.preprocess((value) => value === "" || value === undefined ? fallback : value, z.coerce.number().int().min(minimum).max(maximum));
const bool = (fallback: boolean) => z.preprocess((value) => {
  if (value === "" || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}, z.boolean());

const schema = z.object({
  LMSTUDIO_BASE_URL: z.string().url(),
  LMSTUDIO_API_TOKEN: optionalString,
  LMSTUDIO_PRIMARY_MODEL: z.string().min(1),
  LMSTUDIO_FALLBACK_MODELS: z.string().optional().default(""),
  LMSTUDIO_CONNECTION_MODE: z.enum(["direct-lan", "lmlink"]).default("direct-lan"),
  LMSTUDIO_MODEL_POLICY: z.enum(["required-loaded", "load-installed"]).default("required-loaded"),
  LMSTUDIO_REASONING: z.enum(["off", "low", "medium", "high", "on"]).default("low"),
  LMSTUDIO_MIN_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).default("0.4.8"),
  LMSTUDIO_CONFIRMED_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
  LMSTUDIO_HEALTH_TIMEOUT_MS: integer(10_000, 1_000, 120_000),
  LMSTUDIO_MODEL_LOAD_TIMEOUT_MS: integer(180_000, 5_000, 900_000),
  LMSTUDIO_PLAN_TIMEOUT_MS: integer(180_000, 5_000, 900_000),
  LMSTUDIO_SECTION_TIMEOUT_MS: integer(300_000, 5_000, 900_000),
  LMSTUDIO_RETRY_LIMIT: integer(1, 0, 5),
  LMSTUDIO_RETRY_BASE_DELAY_MS: integer(500, 50, 30_000),
  LMSTUDIO_SEED: integer(42, 0, 2_147_483_647),
  LMSTUDIO_PLAN_MAX_TOKENS: integer(4_000, 256, 32_768),
  LMSTUDIO_SECTION_MAX_TOKENS: integer(4_000, 256, 32_768),
  LMSTUDIO_STRUCTURED_PLAN: bool(false),
  LMSTUDIO_GENERATION_CONCURRENCY: integer(1, 1, 4),

  TRACKER_PATH: z.string().min(1),
  LOCAL_WORDPRESS_ROOT: z.string().min(1),
  THEME_PATH: z.string().min(1),
  LIVE_LINK_URL: z.string().url(),
  LIVE_LINK_USERNAME: z.string().min(1),
  LIVE_LINK_PASSWORD: z.string().min(1),

  IMESSAGE_ADAPTER: z.enum(["relay", "macos", "dry-run"]).default("relay"),
  IMESSAGE_RELAY_URL: optionalUrl,
  IMESSAGE_RELAY_TOKEN: optionalString,
  IMESSAGE_RECIPIENT: optionalString,
  IMESSAGE_RELAY_TIMEOUT_MS: integer(30_000, 1_000, 120_000),
  IMESSAGE_RELAY_LISTEN_HOST: z.string().min(1).default("127.0.0.1"),
  IMESSAGE_RELAY_LISTEN_PORT: integer(8_787, 0, 65_535),
  IMESSAGE_RELAY_DATA_DIR: z.string().min(1).default("relay/data"),
  IMESSAGE_CHAT_DB: z.string().min(1).default("~/Library/Messages/chat.db"),
  IMESSAGE_INCLUDE_LIVE_LINK_PASSWORD: bool(true),

  POLL_INTERVAL_MS: integer(60_000, 1_000, 86_400_000),
  IDLE_BACKOFF_MS: integer(60_000, 1_000, 86_400_000),
  PREFLIGHT_CACHE_MS: integer(30_000, 0, 600_000),
  TRACKER_LOCK_STALE_MS: integer(900_000, 10_000, 86_400_000),
  CHECKPOINT_MAX_AGE_MS: integer(604_800_000, 60_000, 31_536_000_000),
  RUN_LOGS_DIR: z.string().min(1).default("data/runs"),
  HOMEPAGE_DATA_DIR: z.string().min(1).default("data/homepages")
});

export const ENVIRONMENT_VARIABLES = Object.freeze(Object.keys(schema.shape));

export type LmStudioReasoning = z.infer<typeof schema>["LMSTUDIO_REASONING"];
export type LmStudioConnectionMode = z.infer<typeof schema>["LMSTUDIO_CONNECTION_MODE"];
export type LmStudioModelPolicy = z.infer<typeof schema>["LMSTUDIO_MODEL_POLICY"];
export type MessageAdapterName = z.infer<typeof schema>["IMESSAGE_ADAPTER"];

export interface AppConfig {
  lmStudio: {
    baseUrl: string;
    apiToken?: string;
    primaryModel: string;
    fallbackModels: string[];
    connectionMode: LmStudioConnectionMode;
    modelPolicy: LmStudioModelPolicy;
    reasoning: LmStudioReasoning;
    minimumVersion: string;
    confirmedVersion: string;
    healthTimeoutMs: number;
    modelLoadTimeoutMs: number;
    planTimeoutMs: number;
    sectionTimeoutMs: number;
    retryLimit: number;
    retryBaseDelayMs: number;
    seed: number;
    planMaxTokens: number;
    sectionMaxTokens: number;
    structuredPlan: boolean;
    generationConcurrency: number;
  };
  trackerPath: string;
  wordpressRoot: string;
  themePath: string;
  liveLink: { url: string; username: string; password: string };
  messaging: {
    adapter: MessageAdapterName;
    relayUrl?: string;
    relayToken?: string;
    recipient?: string;
    relayTimeoutMs: number;
    relayListenHost: string;
    relayListenPort: number;
    relayDataDir: string;
    chatDb: string;
    includeLiveLinkPassword: boolean;
  };
  operations: {
    pollIntervalMs: number;
    idleBackoffMs: number;
    preflightCacheMs: number;
    trackerLockStaleMs: number;
    checkpointMaxAgeMs: number;
    runLogsDir: string;
    homepageDataDir: string;
  };
}

export interface RelayServerConfig {
  token: string;
  recipient: string;
  timeoutMs: number;
  host: string;
  port: number;
  dataDir: string;
  chatDb: string;
}

function loopbackHost(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function versionAtLeast(value: string, minimum: string): boolean {
  const parts = value.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const actual = parts[index] ?? 0;
    const required = minimumParts[index] ?? 0;
    if (actual > required) return true;
    if (actual < required) return false;
  }
  return true;
}

function isPlaceholder(value: string): boolean {
  return /replace-with|put-[a-z-]+-here/i.test(value);
}

function requireHttpOrigin(name: string, value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error(`${name} must be an origin without credentials, path, query, or fragment`);
  }
  return url;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const value = schema.parse(env);
  if (!versionAtLeast(value.LMSTUDIO_MIN_VERSION, "0.4.8")) {
    throw new Error("LMSTUDIO_MIN_VERSION cannot be lower than 0.4.8 because this worker uses reasoning_effort and native reasoning capabilities");
  }
  if (!versionAtLeast(value.LMSTUDIO_CONFIRMED_VERSION, value.LMSTUDIO_MIN_VERSION)) {
    throw new Error(`LMSTUDIO_CONFIRMED_VERSION must be at least ${value.LMSTUDIO_MIN_VERSION}`);
  }
  const liveLinkUrl = requireHttpOrigin("LIVE_LINK_URL", value.LIVE_LINK_URL);
  if (
    isPlaceholder(value.LIVE_LINK_USERNAME)
    || isPlaceholder(value.LIVE_LINK_PASSWORD)
    || liveLinkUrl.hostname.startsWith("example-")
  ) {
    throw new Error("Replace the Local Live Link placeholders before running the workflow");
  }
  const wordpressRoot = path.resolve(value.LOCAL_WORDPRESS_ROOT);
  const themePath = path.resolve(value.THEME_PATH);
  const expectedPath = path.join(wordpressRoot, "wp-content", "themes", EXPECTED_THEME_DIRECTORY);
  if (themePath.toLowerCase() !== expectedPath.toLowerCase()) {
    throw new Error(`THEME_PATH must exactly match the designated theme: ${expectedPath}`);
  }
  if (!isPathInside(path.join(wordpressRoot, "wp-content", "themes"), themePath)) {
    throw new Error("THEME_PATH is outside the Local WordPress themes directory");
  }

  const baseUrl = requireHttpOrigin("LMSTUDIO_BASE_URL", value.LMSTUDIO_BASE_URL).origin;
  if (value.LMSTUDIO_CONNECTION_MODE === "lmlink" && !loopbackHost(baseUrl)) {
    throw new Error("LM Link mode requires LMSTUDIO_BASE_URL to use localhost or 127.0.0.1; LM Studio routes the request to the linked device");
  }

  const fallbackModels = value.LMSTUDIO_FALLBACK_MODELS.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (fallbackModels.includes(value.LMSTUDIO_PRIMARY_MODEL)) {
    throw new Error("LMSTUDIO_FALLBACK_MODELS must not repeat LMSTUDIO_PRIMARY_MODEL");
  }
  if (new Set(fallbackModels).size !== fallbackModels.length) {
    throw new Error("LMSTUDIO_FALLBACK_MODELS contains duplicate model identifiers");
  }

  if (value.IMESSAGE_ADAPTER !== "dry-run" && !value.IMESSAGE_RECIPIENT) {
    throw new Error("IMESSAGE_RECIPIENT is required unless IMESSAGE_ADAPTER=dry-run");
  }
  if (value.IMESSAGE_ADAPTER === "relay") {
    if (!value.IMESSAGE_RELAY_URL || !value.IMESSAGE_RELAY_TOKEN) {
      throw new Error("IMESSAGE_RELAY_URL and IMESSAGE_RELAY_TOKEN are required when IMESSAGE_ADAPTER=relay");
    }
    if (value.IMESSAGE_RELAY_TOKEN.length < 24) {
      throw new Error("IMESSAGE_RELAY_TOKEN must contain at least 24 characters");
    }
    if (isPlaceholder(value.IMESSAGE_RELAY_TOKEN)) {
      throw new Error("Replace the relay-token placeholder before running the workflow");
    }
    requireHttpOrigin("IMESSAGE_RELAY_URL", value.IMESSAGE_RELAY_URL);
  }

  return {
    lmStudio: {
      baseUrl,
      ...(value.LMSTUDIO_API_TOKEN ? { apiToken: value.LMSTUDIO_API_TOKEN } : {}),
      primaryModel: value.LMSTUDIO_PRIMARY_MODEL,
      fallbackModels,
      connectionMode: value.LMSTUDIO_CONNECTION_MODE,
      modelPolicy: value.LMSTUDIO_MODEL_POLICY,
      reasoning: value.LMSTUDIO_REASONING,
      minimumVersion: value.LMSTUDIO_MIN_VERSION,
      confirmedVersion: value.LMSTUDIO_CONFIRMED_VERSION,
      healthTimeoutMs: value.LMSTUDIO_HEALTH_TIMEOUT_MS,
      modelLoadTimeoutMs: value.LMSTUDIO_MODEL_LOAD_TIMEOUT_MS,
      planTimeoutMs: value.LMSTUDIO_PLAN_TIMEOUT_MS,
      sectionTimeoutMs: value.LMSTUDIO_SECTION_TIMEOUT_MS,
      retryLimit: value.LMSTUDIO_RETRY_LIMIT,
      retryBaseDelayMs: value.LMSTUDIO_RETRY_BASE_DELAY_MS,
      seed: value.LMSTUDIO_SEED,
      planMaxTokens: value.LMSTUDIO_PLAN_MAX_TOKENS,
      sectionMaxTokens: value.LMSTUDIO_SECTION_MAX_TOKENS,
      structuredPlan: value.LMSTUDIO_STRUCTURED_PLAN,
      generationConcurrency: value.LMSTUDIO_GENERATION_CONCURRENCY
    },
    trackerPath: path.resolve(value.TRACKER_PATH),
    wordpressRoot,
    themePath,
    liveLink: {
      url: liveLinkUrl.origin,
      username: value.LIVE_LINK_USERNAME,
      password: value.LIVE_LINK_PASSWORD
    },
    messaging: {
      adapter: value.IMESSAGE_ADAPTER,
      ...(value.IMESSAGE_RELAY_URL ? { relayUrl: requireHttpOrigin("IMESSAGE_RELAY_URL", value.IMESSAGE_RELAY_URL).origin } : {}),
      ...(value.IMESSAGE_RELAY_TOKEN ? { relayToken: value.IMESSAGE_RELAY_TOKEN } : {}),
      ...(value.IMESSAGE_RECIPIENT ? { recipient: value.IMESSAGE_RECIPIENT } : {}),
      relayTimeoutMs: value.IMESSAGE_RELAY_TIMEOUT_MS,
      relayListenHost: value.IMESSAGE_RELAY_LISTEN_HOST,
      relayListenPort: value.IMESSAGE_RELAY_LISTEN_PORT,
      relayDataDir: path.resolve(value.IMESSAGE_RELAY_DATA_DIR),
      chatDb: value.IMESSAGE_CHAT_DB.replace(/^~/, env.HOME ?? process.env.HOME ?? ""),
      includeLiveLinkPassword: value.IMESSAGE_INCLUDE_LIVE_LINK_PASSWORD
    },
    operations: {
      pollIntervalMs: value.POLL_INTERVAL_MS,
      idleBackoffMs: value.IDLE_BACKOFF_MS,
      preflightCacheMs: value.PREFLIGHT_CACHE_MS,
      trackerLockStaleMs: value.TRACKER_LOCK_STALE_MS,
      checkpointMaxAgeMs: value.CHECKPOINT_MAX_AGE_MS,
      runLogsDir: path.resolve(value.RUN_LOGS_DIR),
      homepageDataDir: path.resolve(value.HOMEPAGE_DATA_DIR)
    }
  };
}

export function loadRelayServerConfig(env: NodeJS.ProcessEnv = process.env): RelayServerConfig {
  const value = schema.pick({
    IMESSAGE_RELAY_TOKEN: true,
    IMESSAGE_RECIPIENT: true,
    IMESSAGE_RELAY_TIMEOUT_MS: true,
    IMESSAGE_RELAY_LISTEN_HOST: true,
    IMESSAGE_RELAY_LISTEN_PORT: true,
    IMESSAGE_RELAY_DATA_DIR: true,
    IMESSAGE_CHAT_DB: true
  }).parse(env);
  if (!value.IMESSAGE_RELAY_TOKEN || value.IMESSAGE_RELAY_TOKEN.length < 24) {
    throw new Error("IMESSAGE_RELAY_TOKEN must contain at least 24 characters");
  }
  if (isPlaceholder(value.IMESSAGE_RELAY_TOKEN)) {
    throw new Error("Replace the relay-token placeholder before starting the relay server");
  }
  if (!value.IMESSAGE_RECIPIENT) throw new Error("IMESSAGE_RECIPIENT is required");
  return {
    token: value.IMESSAGE_RELAY_TOKEN,
    recipient: value.IMESSAGE_RECIPIENT,
    timeoutMs: value.IMESSAGE_RELAY_TIMEOUT_MS,
    host: value.IMESSAGE_RELAY_LISTEN_HOST,
    port: value.IMESSAGE_RELAY_LISTEN_PORT,
    dataDir: path.resolve(value.IMESSAGE_RELAY_DATA_DIR),
    chatDb: value.IMESSAGE_CHAT_DB.replace(/^~/, env.HOME ?? process.env.HOME ?? "")
  };
}
