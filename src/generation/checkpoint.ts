import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PROMPT_VERSION } from "../domain/constants.js";
import {
  checksumBuffer,
  generationInputChecksum,
  planChecksum,
  validateManifest,
  writeJsonAtomic
} from "../domain/manifest.js";
import { planSchema } from "../lmstudio/client.js";
import { wrapHtmlPart, buildPageTemplate } from "./html.js";
import type {
  HomepageCheckpoint,
  HomepageManifest,
  HomepagePlan,
  InferenceMetadata,
  TrackerRow
} from "../domain/types.js";
import { assertPathInside, assertSafeHomepageId } from "../validation/paths.js";

const inferenceSchema = z.object({
  request_kind: z.enum(["plan", "plan-repair", "section", "smoke"]),
  model_key: z.string(),
  model_instance_id: z.string(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  retry_count: z.number().int().nonnegative(),
  finish_reason: z.string(),
  prompt_tokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional()
});

const checkpointSchema = z.object({
  schema_version: z.literal(1),
  homepage_id: z.string(),
  homepage_idea: z.string(),
  target_theme_path: z.string(),
  model_key: z.string(),
  model_instance_id: z.string(),
  prompt_version: z.literal(PROMPT_VERSION),
  input_checksum_sha256: z.string().length(64),
  plan: planSchema,
  plan_checksum_sha256: z.string().length(64),
  plan_inference: inferenceSchema,
  manifest: z.unknown(),
  completed_parts: z.array(z.object({
    key: z.string(),
    filename: z.string(),
    checksum_sha256: z.string().length(64),
    inference: inferenceSchema
  })),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export class CheckpointStore {
  readonly homepageRoot: string;
  readonly checkpointRoot: string;
  readonly checkpointFile: string;
  readonly partsRoot: string;
  readonly manifestFile: string;

  constructor(
    homepageDataRoot: string,
    readonly homepageId: string
  ) {
    assertSafeHomepageId(homepageId);
    this.homepageRoot = path.resolve(homepageDataRoot, homepageId);
    assertPathInside(homepageDataRoot, this.homepageRoot);
    this.checkpointRoot = path.join(this.homepageRoot, ".checkpoint");
    this.checkpointFile = path.join(this.checkpointRoot, "checkpoint.json");
    this.partsRoot = path.join(this.checkpointRoot, "parts");
    this.manifestFile = path.join(this.homepageRoot, "manifest.json");
  }

  static inputChecksum(row: TrackerRow, themePath: string, modelKey: string, modelInstanceId: string): string {
    return generationInputChecksum({
      homepageId: row.homepage_id,
      homepageIdea: row.homepage_idea,
      themePath,
      modelKey,
      modelInstanceId,
      promptVersion: PROMPT_VERSION
    });
  }

  async load(): Promise<HomepageCheckpoint | undefined> {
    try {
      const parsed = checkpointSchema.parse(JSON.parse(await fs.readFile(this.checkpointFile, "utf8")));
      const manifest = validateManifest(parsed.manifest);
      if (planChecksum(parsed.plan) !== parsed.plan_checksum_sha256) throw new Error("Checkpoint plan checksum does not match");
      if (
        manifest.homepage_id !== parsed.homepage_id
        || manifest.target_theme_path !== parsed.target_theme_path
        || manifest.model !== parsed.model_key
        || manifest.model_instance_id !== parsed.model_instance_id
        || manifest.prompt_version !== parsed.prompt_version
        || manifest.plan_checksum_sha256 !== parsed.plan_checksum_sha256
      ) {
        throw new Error("Checkpoint manifest provenance does not match the checkpoint");
      }
      return { ...parsed, manifest } as HomepageCheckpoint;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async loadCompatible(
    row: TrackerRow,
    themePath: string,
    modelKey: string,
    modelInstanceId: string
  ): Promise<HomepageCheckpoint | undefined> {
    let checkpoint: HomepageCheckpoint | undefined;
    try {
      checkpoint = await this.load();
    } catch (error) {
      await this.invalidate(`checkpoint validation failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    if (!checkpoint) return undefined;
    const expected = CheckpointStore.inputChecksum(row, themePath, modelKey, modelInstanceId);
    if (checkpoint.input_checksum_sha256 !== expected) {
      await this.invalidate("generation inputs changed");
      return undefined;
    }
    const invalidKeys = new Set<string>();
    for (const completed of checkpoint.completed_parts) {
      const filePath = path.join(this.partsRoot, completed.filename);
      assertPathInside(this.partsRoot, filePath);
      try {
        const actual = checksumBuffer(await fs.readFile(filePath));
        if (actual !== completed.checksum_sha256) invalidKeys.add(completed.key);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        invalidKeys.add(completed.key);
      }
    }
    if (invalidKeys.size) {
      for (const completed of checkpoint.completed_parts) {
        if (invalidKeys.has(completed.key)) {
          await fs.rm(path.join(this.partsRoot, completed.filename), { force: true });
        }
      }
      checkpoint = {
        ...checkpoint,
        completed_parts: checkpoint.completed_parts.filter((entry) => !invalidKeys.has(entry.key)),
        manifest: {
          ...checkpoint.manifest,
          parts: checkpoint.manifest.parts.map((part) => {
            if (!invalidKeys.has(part.key)) return part;
            const withoutGeneratedEvidence = { ...part };
            delete withoutGeneratedEvidence.checksum_sha256;
            delete withoutGeneratedEvidence.inference;
            return withoutGeneratedEvidence;
          })
        },
        updated_at: new Date().toISOString()
      };
      await writeJsonAtomic(this.checkpointFile, checkpoint);
    }
    return checkpoint;
  }

  async initialize(
    row: TrackerRow,
    themePath: string,
    modelKey: string,
    modelInstanceId: string,
    plan: HomepagePlan,
    planInference: InferenceMetadata,
    manifest: HomepageManifest
  ): Promise<HomepageCheckpoint> {
    const now = new Date().toISOString();
    const checkpoint: HomepageCheckpoint = {
      schema_version: 1,
      homepage_id: row.homepage_id,
      homepage_idea: row.homepage_idea,
      target_theme_path: themePath,
      model_key: modelKey,
      model_instance_id: modelInstanceId,
      prompt_version: PROMPT_VERSION,
      input_checksum_sha256: CheckpointStore.inputChecksum(row, themePath, modelKey, modelInstanceId),
      plan,
      plan_checksum_sha256: planChecksum(plan),
      plan_inference: planInference,
      manifest,
      completed_parts: [],
      created_at: now,
      updated_at: now
    };
    await fs.mkdir(this.partsRoot, { recursive: true });
    await writeJsonAtomic(this.checkpointFile, checkpoint);
    return checkpoint;
  }

  async saveSection(
    checkpoint: HomepageCheckpoint,
    part: HomepageManifest["parts"][number],
    rawHtml: string,
    inference: InferenceMetadata
  ): Promise<HomepageCheckpoint> {
    const content = wrapHtmlPart(rawHtml);
    const destination = path.join(this.partsRoot, part.filename);
    assertPathInside(this.partsRoot, destination);
    await fs.mkdir(this.partsRoot, { recursive: true });
    try {
      await fs.writeFile(destination, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await fs.readFile(destination, "utf8");
      if (existing !== content) throw new Error(`Checkpoint part already exists with different content: ${part.filename}`);
    }
    const checksum = checksumBuffer(content);
    const remaining = checkpoint.completed_parts.filter((entry) => entry.key !== part.key);
    const updated: HomepageCheckpoint = {
      ...checkpoint,
      completed_parts: [...remaining, {
        key: part.key,
        filename: part.filename,
        checksum_sha256: checksum,
        inference
      }].sort((a, b) => a.key.localeCompare(b.key)),
      manifest: {
        ...checkpoint.manifest,
        parts: checkpoint.manifest.parts.map((entry) =>
          entry.key === part.key ? { ...entry, checksum_sha256: checksum, inference } : entry
        )
      },
      updated_at: new Date().toISOString()
    };
    await writeJsonAtomic(this.checkpointFile, updated);
    return updated;
  }

  async stage(checkpoint: HomepageCheckpoint, stagingRoot: string): Promise<void> {
    if (checkpoint.completed_parts.length !== checkpoint.manifest.parts.length) {
      throw new Error(`Checkpoint is incomplete: ${checkpoint.completed_parts.length}/${checkpoint.manifest.parts.length} parts`);
    }
    const templateDirectory = path.join(stagingRoot, "page-templates");
    const partsDirectory = path.join(stagingRoot, "template-parts", "homepage");
    await fs.mkdir(templateDirectory, { recursive: true });
    await fs.mkdir(partsDirectory, { recursive: true });
    await fs.writeFile(
      path.join(templateDirectory, checkpoint.manifest.template_filename),
      buildPageTemplate(checkpoint.manifest),
      { encoding: "utf8", flag: "wx" }
    );
    for (const part of checkpoint.manifest.parts) {
      const source = path.join(this.partsRoot, part.filename);
      const destination = path.join(partsDirectory, part.filename);
      assertPathInside(this.partsRoot, source);
      assertPathInside(partsDirectory, destination);
      await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    }
  }

  async invalidate(reason: string): Promise<void> {
    const marker = path.join(this.homepageRoot, `invalid-checkpoint-${Date.now()}.json`);
    await writeJsonAtomic(marker, { invalidated_at: new Date().toISOString(), reason });
    await fs.rm(this.checkpointRoot, { recursive: true, force: true });
  }

  async complete(): Promise<void> {
    await fs.rm(this.checkpointRoot, { recursive: true, force: true });
  }
}

export async function cleanupExpiredCheckpoints(homepageDataRoot: string, maximumAgeMs: number): Promise<number> {
  let removed = 0;
  let entries: Dirent[];
  try { entries = await fs.readdir(homepageDataRoot, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const checkpointRoot = path.join(homepageDataRoot, entry.name, ".checkpoint");
    try {
      const details = await fs.stat(checkpointRoot);
      if (Date.now() - details.mtimeMs > maximumAgeMs) {
        await fs.rm(checkpointRoot, { recursive: true, force: true });
        removed += 1;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return removed;
}

export async function cleanupExpiredStaging(stagingRoot: string, maximumAgeMs: number): Promise<number> {
  let removed = 0;
  let entries: Dirent[];
  try {
    const rootDetails = await fs.lstat(stagingRoot);
    if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) {
      throw new Error("Staging root must be a real directory");
    }
    entries = await fs.readdir(stagingRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(stagingRoot, entry.name);
    assertPathInside(stagingRoot, directory);
    const details = await fs.stat(directory);
    if (Date.now() - details.mtimeMs > maximumAgeMs) {
      await fs.rm(directory, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}
