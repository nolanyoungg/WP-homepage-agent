import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PART_SPECS, PROMPT_VERSION } from "./constants.js";
import { assertSafeHomepageId, safeSlug } from "../validation/paths.js";
import type { HomepageManifest, HomepagePlan, InferenceMetadata, TrackerRow } from "./types.js";

const inferenceSchema = z.object({
  request_kind: z.enum(["plan", "plan-repair", "section", "smoke"]),
  model_key: z.string().min(1),
  model_instance_id: z.string().min(1),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  retry_count: z.number().int().nonnegative(),
  finish_reason: z.string().min(1),
  prompt_tokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional()
});

const manifestSchema = z.object({
  schema_version: z.union([z.literal(1), z.literal(2)]),
  homepage_id: z.string().min(1),
  homepage_idea: z.string().min(1).max(4_000),
  homepage_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  target_theme_path: z.string().min(1),
  template_filename: z.string().regex(/^page-template-home-page-\d{2}-\d{2}-\d{4}(?:-[A-Za-z0-9][A-Za-z0-9_-]{0,63})?\.php$/),
  template_checksum_sha256: z.string().length(64).optional(),
  parts: z.array(z.object({
    order: z.number().int().min(1).max(10),
    key: z.string(),
    filename: z.string(),
    purpose: z.string(),
    checksum_sha256: z.string().length(64).optional(),
    inference: inferenceSchema.optional()
  })).length(10),
  generated_at: z.string().datetime(),
  model: z.string().min(1),
  model_instance_id: z.string().min(1).optional(),
  prompt_version: z.string().min(1).optional(),
  run_id: z.string().min(1).optional(),
  plan_checksum_sha256: z.string().length(64).optional(),
  plan_inference: inferenceSchema.optional()
});

export function checksumBuffer(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function planChecksum(plan: HomepagePlan): string {
  return checksumBuffer(JSON.stringify(plan));
}

export function generationInputChecksum(input: {
  homepageId: string;
  homepageIdea: string;
  themePath: string;
  modelKey: string;
  modelInstanceId: string;
  promptVersion: string;
}): string {
  return checksumBuffer(JSON.stringify(input));
}

export function buildManifest(
  row: TrackerRow,
  plan: HomepagePlan,
  themePath: string,
  model: string,
  modelInstanceId: string,
  runId: string,
  planInference: InferenceMetadata,
  now = new Date()
): HomepageManifest {
  assertSafeHomepageId(row.homepage_id);
  const proposedSlug = safeSlug(plan.pageSlug || row.homepage_slug || row.homepage_idea);
  const slug = ["home", "homepage", "home-page"].includes(proposedSlug) ? safeSlug(plan.title || row.homepage_idea) : proposedSlug;
  const date = [String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"), now.getFullYear()].join("-");
  const safeId = row.homepage_id;
  return {
    schema_version: 2,
    homepage_id: safeId,
    homepage_idea: row.homepage_idea,
    homepage_slug: slug,
    target_theme_path: themePath,
    template_filename: `page-template-home-page-${date}-${safeId}.php`,
    parts: PART_SPECS.map(([key, purpose], index) => ({
      order: index + 1,
      key,
      filename: `content-template-${slug}-${safeId}-${key}.php`,
      purpose
    })),
    generated_at: now.toISOString(),
    model,
    model_instance_id: modelInstanceId,
    prompt_version: PROMPT_VERSION,
    run_id: runId,
    plan_checksum_sha256: planChecksum(plan),
    plan_inference: planInference
  };
}

export function validateManifest(value: unknown): HomepageManifest {
  const manifest = manifestSchema.parse(value) as HomepageManifest;
  assertSafeHomepageId(manifest.homepage_id);
  const names = new Set(manifest.parts.map((part) => part.filename));
  if (names.size !== 10) throw new Error("Manifest contains duplicate template-part filenames");
  manifest.parts.forEach((part, index) => {
    if (part.order !== index + 1) throw new Error("Manifest parts are not in canonical order");
    const legacy = `content-template-${manifest.homepage_slug}-${PART_SPECS[index]?.[0]}.php`;
    const current = `content-template-${manifest.homepage_slug}-${manifest.homepage_id}-${PART_SPECS[index]?.[0]}.php`;
    if (part.filename !== legacy && part.filename !== current) {
      throw new Error(`Unexpected manifest filename: ${part.filename}`);
    }
  });
  if (manifest.schema_version === 2) {
    if (manifest.prompt_version !== PROMPT_VERSION) throw new Error(`Unsupported prompt version: ${manifest.prompt_version ?? "missing"}`);
    if (!manifest.model_instance_id || !manifest.run_id || !manifest.plan_checksum_sha256 || !manifest.plan_inference) {
      throw new Error("Schema 2 manifest is missing generation provenance");
    }
    const expectedTemplate = new RegExp(`^page-template-home-page-\\d{2}-\\d{2}-\\d{4}-${manifest.homepage_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.php$`);
    if (!expectedTemplate.test(manifest.template_filename)) throw new Error("Schema 2 template filename must include homepage_id");
  }
  return manifest;
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await fs.rename(temporary, filePath);
}

export async function writeManifest(filePath: string, manifest: HomepageManifest): Promise<void> {
  validateManifest(manifest);
  await writeJsonAtomic(filePath, manifest);
}

export async function sha256(filePath: string): Promise<string> {
  return checksumBuffer(await fs.readFile(filePath));
}
