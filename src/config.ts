import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { EXPECTED_THEME_DIRECTORY } from "./constants.js";
import { isPathInside } from "./paths.js";

loadDotenv();
const schema = z.object({
  LMSTUDIO_BASE_URL: z.string().url(),
  LMSTUDIO_PRIMARY_MODEL: z.string().min(1),
  TRACKER_PATH: z.string().min(1),
  LOCAL_WORDPRESS_ROOT: z.string().min(1),
  THEME_PATH: z.string().min(1),
  LIVE_LINK_URL: z.string().url(),
  LIVE_LINK_USERNAME: z.string().min(1),
  LIVE_LINK_PASSWORD: z.string().min(1),
  IMESSAGE_RELAY_URL: z.string().url().optional(),
  IMESSAGE_RELAY_TOKEN: z.string().min(1).optional(),
  IMESSAGE_RECIPIENT: z.string().min(1).optional()
});
export interface AppConfig {
  lmStudioBaseUrl: string; lmStudioModel: string; trackerPath: string;
  wordpressRoot: string; themePath: string; liveLinkUrl: string;
  liveLinkUsername: string; liveLinkPassword: string; relayUrl?: string;
  relayToken?: string; relayRecipient?: string;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const normalized = {
    ...env,
    IMESSAGE_RELAY_URL: env.IMESSAGE_RELAY_URL || undefined,
    IMESSAGE_RELAY_TOKEN: env.IMESSAGE_RELAY_TOKEN || undefined,
    IMESSAGE_RECIPIENT: env.IMESSAGE_RECIPIENT || undefined
  };
  const value = schema.parse(normalized);
  const wordpressRoot = path.resolve(value.LOCAL_WORDPRESS_ROOT);
  const themePath = path.resolve(value.THEME_PATH);
  const expectedPath = path.join(wordpressRoot, "wp-content", "themes", EXPECTED_THEME_DIRECTORY);
  if (themePath.toLowerCase() !== expectedPath.toLowerCase()) {
    throw new Error(`THEME_PATH must exactly match the designated theme: ${expectedPath}`);
  }
  if (!isPathInside(path.join(wordpressRoot, "wp-content", "themes"), themePath)) {
    throw new Error("THEME_PATH is outside the Local WordPress themes directory");
  }
  const relayTransportConfigured = Boolean(value.IMESSAGE_RELAY_URL || value.IMESSAGE_RELAY_TOKEN);
  if (relayTransportConfigured && !(value.IMESSAGE_RELAY_URL && value.IMESSAGE_RELAY_TOKEN && value.IMESSAGE_RECIPIENT)) {
    throw new Error("Relay URL and token require an iMessage recipient, and all relay transport settings must be configured together");
  }
  return {
    lmStudioBaseUrl: value.LMSTUDIO_BASE_URL.replace(/\/$/, ""),
    lmStudioModel: value.LMSTUDIO_PRIMARY_MODEL,
    trackerPath: path.resolve(value.TRACKER_PATH), wordpressRoot, themePath,
    liveLinkUrl: value.LIVE_LINK_URL.replace(/\/$/, ""),
    liveLinkUsername: value.LIVE_LINK_USERNAME, liveLinkPassword: value.LIVE_LINK_PASSWORD,
    ...(value.IMESSAGE_RELAY_URL ? { relayUrl: value.IMESSAGE_RELAY_URL.replace(/\/$/, "") } : {}),
    ...(value.IMESSAGE_RELAY_TOKEN ? { relayToken: value.IMESSAGE_RELAY_TOKEN } : {}),
    ...(value.IMESSAGE_RECIPIENT ? { relayRecipient: value.IMESSAGE_RECIPIENT } : {})
  };
}

