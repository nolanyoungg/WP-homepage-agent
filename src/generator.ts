import fs from "node:fs/promises";
import path from "node:path";
import type { GeneratedHomepage, HomepageManifest } from "./types.js";

export async function stageGeneratedHomepage(stagingRoot: string, manifest: HomepageManifest, generated: GeneratedHomepage): Promise<void> {
  const templateDir = path.join(stagingRoot, "page-templates");
  const partsDir = path.join(stagingRoot, "template-parts", "homepage");
  await fs.mkdir(templateDir, { recursive: true });
  await fs.mkdir(partsDir, { recursive: true });
  await fs.writeFile(path.join(templateDir, manifest.template_filename), generated.template, { encoding: "utf8", flag: "wx" });
  for (const part of generated.parts) {
    if (path.basename(part.filename) !== part.filename) throw new Error(`Unsafe generated filename: ${part.filename}`);
    await fs.writeFile(path.join(partsDir, part.filename), part.content, { encoding: "utf8", flag: "wx" });
  }
}
