import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PART_SPECS } from "./constants.js";
import { safeSlug } from "./paths.js";
import type { HomepageManifest, HomepagePlan, TrackerRow } from "./types.js";

const manifestSchema = z.object({
  schema_version: z.literal(1), homepage_id: z.string().min(1), homepage_idea: z.string().min(1),
  homepage_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), target_theme_path: z.string().min(1),
  template_filename: z.string().regex(/^page-template-home-page-\d{2}-\d{2}-\d{4}\.php$/),
  template_checksum_sha256: z.string().length(64).optional(),
  parts: z.array(z.object({ order: z.number().int().min(1).max(10), key: z.string(), filename: z.string(), purpose: z.string(), checksum_sha256: z.string().length(64).optional() })).length(10),
  generated_at: z.string().datetime(), model: z.string().min(1)
});

export function buildManifest(row: TrackerRow, plan: HomepagePlan, themePath: string, model: string, now = new Date()): HomepageManifest {
  const proposedSlug = safeSlug(plan.pageSlug || row.homepage_slug || row.homepage_idea);
  const slug = ["home", "homepage", "home-page"].includes(proposedSlug) ? safeSlug(plan.title || row.homepage_idea) : proposedSlug;
  const date = [String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"), now.getFullYear()].join("-");
  return {
    schema_version: 1, homepage_id: row.homepage_id, homepage_idea: row.homepage_idea,
    homepage_slug: slug, target_theme_path: themePath,
    template_filename: `page-template-home-page-${date}.php`,
    parts: PART_SPECS.map(([key, purpose], index) => ({ order: index + 1, key, filename: `content-template-${slug}-${key}.php`, purpose })),
    generated_at: now.toISOString(), model
  };
}

export function validateManifest(value: unknown): HomepageManifest {
  const manifest = manifestSchema.parse(value) as HomepageManifest;
  const names = new Set(manifest.parts.map((part) => part.filename));
  if (names.size !== 10) throw new Error("Manifest contains duplicate template-part filenames");
  manifest.parts.forEach((part, index) => {
    if (part.order !== index + 1) throw new Error("Manifest parts are not in canonical order");
    const expected = `content-template-${manifest.homepage_slug}-${PART_SPECS[index]?.[0]}.php`;
    if (part.filename !== expected) throw new Error(`Unexpected manifest filename: ${part.filename}`);
  });
  return manifest;
}

export async function writeManifest(filePath: string, manifest: HomepageManifest): Promise<void> {
  validateManifest(manifest);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, filePath);
}

export async function sha256(filePath: string): Promise<string> {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

