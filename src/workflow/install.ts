import fs from "node:fs/promises";
import path from "node:path";
import { assertPathInside } from "../validation/paths.js";
import type { HomepageManifest } from "../domain/types.js";

interface CopyPair {
  source: string;
  destination: string;
}

export async function installHomepage(
  stagingRoot: string,
  themePath: string,
  manifest: HomepageManifest
): Promise<{ installed: string[]; reused: string[] }> {
  const pairs: CopyPair[] = [
    {
      source: path.join(stagingRoot, "page-templates", manifest.template_filename),
      destination: path.join(themePath, "page-templates", manifest.template_filename)
    },
    ...manifest.parts.map((part) => ({
      source: path.join(stagingRoot, "template-parts", "homepage", part.filename),
      destination: path.join(themePath, "template-parts", "homepage", part.filename)
    }))
  ];
  const installed: string[] = [];
  const reused: string[] = [];
  try {
    for (const pair of pairs) {
      assertPathInside(stagingRoot, pair.source);
      assertPathInside(themePath, pair.destination);
      await fs.mkdir(path.dirname(pair.destination), { recursive: true });
      try {
        const [existing, incoming] = await Promise.all([
          fs.readFile(pair.destination),
          fs.readFile(pair.source)
        ]);
        if (existing.equals(incoming)) {
          reused.push(pair.destination);
          continue;
        }
        throw new Error(`Refusing to overwrite an existing generated-theme destination: ${pair.destination}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const temporary = `${pair.destination}.homepage-agent-${process.pid}.tmp`;
      try {
        await fs.copyFile(pair.source, temporary, fs.constants.COPYFILE_EXCL);
        await fs.rename(temporary, pair.destination);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      installed.push(pair.destination);
    }
    return { installed, reused };
  } catch (error) {
    for (const destination of installed.reverse()) await fs.rm(destination, { force: true });
    throw error;
  }
}
