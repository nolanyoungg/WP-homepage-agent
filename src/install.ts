import fs from "node:fs/promises";
import path from "node:path";
import { assertPathInside } from "./paths.js";
import type { HomepageManifest } from "./types.js";

interface CopyPair { source: string; destination: string }

export async function installHomepage(stagingRoot: string, themePath: string, manifest: HomepageManifest): Promise<void> {
  const pairs: CopyPair[] = [
    { source: path.join(stagingRoot, "page-templates", manifest.template_filename), destination: path.join(themePath, "page-templates", manifest.template_filename) },
    ...manifest.parts.map((part) => ({ source: path.join(stagingRoot, "template-parts", "homepage", part.filename), destination: path.join(themePath, "template-parts", "homepage", part.filename) }))
  ];
  const installed: string[] = [];
  try {
    for (const pair of pairs) {
      assertPathInside(themePath, pair.destination);
      await fs.mkdir(path.dirname(pair.destination), { recursive: true });
      try {
        const [existing, incoming] = await Promise.all([fs.readFile(pair.destination), fs.readFile(pair.source)]);
        if (existing.equals(incoming)) continue;
        throw new Error(`Refusing to overwrite an existing generated-theme destination: ${pair.destination}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const temporary = `${pair.destination}.homepage-agent-${process.pid}.tmp`;
      await fs.copyFile(pair.source, temporary);
      await fs.rename(temporary, pair.destination);
      installed.push(pair.destination);
    }
  } catch (error) {
    for (const destination of installed.reverse()) await fs.rm(destination, { force: true });
    throw error;
  }
}
