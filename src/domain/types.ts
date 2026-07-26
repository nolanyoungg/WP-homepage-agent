import type { HomepageState, TrackerColumn } from "./constants.js";

export type TrackerRow = Record<TrackerColumn, string> & { homepage_status: HomepageState };

export interface InferenceMetadata {
  request_kind: "plan" | "plan-repair" | "section" | "smoke";
  model_key: string;
  model_instance_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  retry_count: number;
  finish_reason: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ManifestPart {
  order: number;
  key: string;
  filename: string;
  purpose: string;
  checksum_sha256?: string;
  inference?: InferenceMetadata;
}

export interface HomepageManifest {
  schema_version: 1 | 2;
  homepage_id: string;
  homepage_idea: string;
  homepage_slug: string;
  target_theme_path: string;
  template_filename: string;
  template_checksum_sha256?: string;
  parts: ManifestPart[];
  generated_at: string;
  model: string;
  model_instance_id?: string;
  prompt_version?: string;
  run_id?: string;
  plan_checksum_sha256?: string;
  plan_inference?: InferenceMetadata;
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
  text: string;
  receivedAt: string;
}

export interface MessageDelivery {
  id: string;
  duplicate: boolean;
}

export interface MessageAdapter {
  healthCheck(): Promise<void>;
  send(text: string, idempotencyKey: string, attachmentPath?: string): Promise<MessageDelivery>;
  incoming(since: string): Promise<RelayMessage[]>;
}

export interface HomepageCheckpoint {
  schema_version: 1;
  homepage_id: string;
  homepage_idea: string;
  target_theme_path: string;
  model_key: string;
  model_instance_id: string;
  prompt_version: string;
  input_checksum_sha256: string;
  plan: HomepagePlan;
  plan_checksum_sha256: string;
  plan_inference: InferenceMetadata;
  manifest: HomepageManifest;
  completed_parts: Array<{
    key: string;
    filename: string;
    checksum_sha256: string;
    inference: InferenceMetadata;
  }>;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunResult {
  outcome: "processed" | "no-work" | "awaiting-review" | "blocked";
  homepageId?: string;
}
