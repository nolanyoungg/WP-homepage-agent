import type { HomepageState, TrackerColumn } from "./constants.js";

export type TrackerRow = Record<TrackerColumn, string> & { homepage_status: HomepageState };

export interface ManifestPart {
  order: number;
  key: string;
  filename: string;
  purpose: string;
  checksum_sha256?: string;
}
export interface HomepageManifest {
  schema_version: 1;
  homepage_id: string;
  homepage_idea: string;
  homepage_slug: string;
  target_theme_path: string;
  template_filename: string;
  template_checksum_sha256?: string;
  parts: ManifestPart[];
  generated_at: string;
  model: string;
}
export interface HomepagePlan {
  title: string;
  pageSlug: string;
  audience: string;
  tone: string;
  sections: Array<{ key: string; heading: string; intent: string }>;
}
export interface GeneratedHomepage {
  template: string;
  parts: Array<{ filename: string; content: string }>;
}
export interface RelayMessage {
  id: string;
  sender: string;
  body: string;
  receivedAt: string;
}
