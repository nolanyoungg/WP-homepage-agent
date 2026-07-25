import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertPathInside } from "./paths.js";
import { sha256, validateManifest } from "./manifest.js";
import type { HomepageManifest } from "./types.js";

const forbiddenPhp = [
  { label: "filesystem or remote-call function", pattern: /\b(?:curl_exec|file_get_contents|file_put_contents|fopen|fwrite|unlink|rename|copy|mkdir|rmdir|wp_remote_(?:get|post)|fsockopen)\b/i },
  { label: "WordPress database or option mutation", pattern: /\b(?:update_option|add_option|delete_option|wp_insert_post|wp_update_post|\$wpdb)\b/i },
  { label: "shell or process execution", pattern: /\b(?:exec|shell_exec|system|passthru|proc_open|popen)\s*\(/i },
  { label: "dynamic code decoding or evaluation", pattern: /\b(?:eval|base64_decode)\s*\(/i },
  { label: "literal remote URL", pattern: /https?:\/\//i },
  { label: "short echo tag", pattern: /<\?=/i },
  { label: "direct include or require", pattern: /\b(?:include|include_once|require|require_once)\b/i },
  { label: "request or environment superglobal", pattern: /\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER|ENV)\b/i },
  { label: "unescaped echo", pattern: /\becho\s+(?!esc_(?:html|attr|url|js)\s*\(|wp_kses_post\s*\()/i }
] as const;

async function listPhp(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && entry.name.endsWith(".php")) files.push(full);
    }
  }
  await visit(root);
  return files;
}

async function phpLint(filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("php", ["-l", filePath], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let error = "";
    child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`PHP syntax failed for ${path.basename(filePath)}: ${error.trim()}`)));
  });
}

export async function validateGeneratedHomepage(stagingRoot: string, themePath: string, manifestInput: HomepageManifest, secrets: string[]): Promise<HomepageManifest> {
  const manifest = validateManifest(manifestInput);
  const phpFiles = await listPhp(stagingRoot);
  if (phpFiles.length !== 11) throw new Error(`Expected exactly 11 PHP files, found ${phpFiles.length}`);
  const templatePath = path.join(stagingRoot, "page-templates", manifest.template_filename);
  const expectedPaths = [templatePath, ...manifest.parts.map((part) => path.join(stagingRoot, "template-parts", "homepage", part.filename))];
  const actual = new Set(phpFiles.map((file) => path.resolve(file).toLowerCase()));
  for (const expected of expectedPaths) {
    assertPathInside(stagingRoot, expected);
    if (!actual.has(path.resolve(expected).toLowerCase())) throw new Error(`Manifest file is missing: ${path.basename(expected)}`);
  }
  const template = await fs.readFile(templatePath, "utf8");
  if (!/Template Name:\s*.+/i.test(template) || !/\bget_header\s*\(/.test(template) || !/\bget_footer\s*\(/.test(template)) throw new Error("Page template is missing required WordPress template calls/header");
  const calls = [...template.matchAll(/get_template_part\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
  const expectedCalls = manifest.parts.map((part) => `template-parts/homepage/${part.filename.replace(/\.php$/, "")}`);
  if (calls.length !== 10 || calls.some((call, index) => call !== expectedCalls[index])) throw new Error("Page template must call exactly the 10 manifest parts in order");
  for (const file of expectedPaths) {
    const content = await fs.readFile(file, "utf8");
    if (!/defined\s*\(\s*['"]ABSPATH['"]\s*\)/.test(content)) throw new Error(`Missing ABSPATH guard: ${path.basename(file)}`);
    const violation = forbiddenPhp.find(({ pattern }) => pattern.test(content));
    if (violation) throw new Error(`Unsafe executable behavior (${violation.label}): ${path.basename(file)}`);
    for (const secret of secrets.filter((value) => value.length >= 4)) if (content.includes(secret)) throw new Error(`Secret detected in generated output: ${path.basename(file)}`);
    await phpLint(file);
  }
  for (const file of expectedPaths) {
    const destination = file === templatePath
      ? path.join(themePath, "page-templates", manifest.template_filename)
      : path.join(themePath, "template-parts", "homepage", path.basename(file));
    assertPathInside(themePath, destination);
  }
  manifest.template_checksum_sha256 = await sha256(templatePath);
  for (let index = 0; index < manifest.parts.length; index += 1) manifest.parts[index]!.checksum_sha256 = await sha256(expectedPaths[index + 1]!);
  return validateManifest(manifest);
}



