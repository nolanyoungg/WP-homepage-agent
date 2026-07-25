import fs from "node:fs/promises";
import path from "node:path";
import { assertPathInside, isPathInside } from "../validation/paths.js";
import type { HomepageManifest } from "../domain/types.js";

interface CopyPair {
  source: string;
  destination: string;
}

async function ensureThemeDirectory(
  themePath: string,
  realThemePath: string,
  directory: string
): Promise<void> {
  assertPathInside(themePath, directory);
  const relative = path.relative(themePath, directory);
  let current = themePath;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const details = await fs.lstat(current);
      if (details.isSymbolicLink() || !details.isDirectory()) {
        throw new Error(`Refusing a non-directory theme path component: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(current);
    }
    const realCurrent = await fs.realpath(current);
    if (!isPathInside(realThemePath, realCurrent)) {
      throw new Error(`Refusing a destination directory outside the real theme path: ${directory}`);
    }
  }
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
  const realThemePath = await fs.realpath(themePath);
  try {
    for (const pair of pairs) {
      assertPathInside(stagingRoot, pair.source);
      assertPathInside(themePath, pair.destination);
      const sourceDetails = await fs.lstat(pair.source);
      if (!sourceDetails.isFile() || sourceDetails.isSymbolicLink()) {
        throw new Error(`Refusing a non-regular staging source: ${pair.source}`);
      }
      await ensureThemeDirectory(
        themePath,
        realThemePath,
        path.dirname(pair.destination)
      );
      try {
        const destinationDetails = await fs.lstat(pair.destination);
        if (destinationDetails.isSymbolicLink() || !destinationDetails.isFile()) {
          throw new Error(`Refusing a non-regular generated-theme destination: ${pair.destination}`);
        }
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
