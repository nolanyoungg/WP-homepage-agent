import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { HomepageManifest, HomepagePlan } from "./types.js";

export interface PreviewPage { id: string; url: string; slug: string }
interface WpRuntime { command: string; prefix: string[] }

function resolveWpRuntime(wordpressRoot: string): WpRuntime {
  const localPhar = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Local", "resources", "extraResources", "bin", "wp-cli", "wp-cli.phar");
  if (process.platform !== "win32" || !fs.existsSync(localPhar)) return { command: "wp", prefix: [] };
  const runRoot = path.join(process.env.APPDATA ?? "", "Local", "run");
  if (fs.existsSync(runRoot)) {
    for (const entry of fs.readdirSync(runRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "router") continue;
      const ini = path.join(runRoot, entry.name, "conf", "php", "php.ini");
      if (!fs.existsSync(ini)) continue;
      const content = fs.readFileSync(ini, "utf8");
      if (!content.toLowerCase().includes(wordpressRoot.toLowerCase())) continue;
      const extensionDirectory = content.match(/^extension_dir\s*=\s*["']([^"']+)["']/mi)?.[1];
      if (!extensionDirectory) continue;
      const php = path.join(path.dirname(extensionDirectory), "php.exe");
      if (fs.existsSync(php)) return { command: php, prefix: ["-c", ini, "-d", "display_startup_errors=0", localPhar] };
    }
  }
  return { command: "php", prefix: [localPhar] };
}

export function firstNumericWpId(output: string): string | undefined {
  return output.split(/\s+/).find((value) => /^\d+$/.test(value));
}
export class WordPressClient {
  private readonly runtime: WpRuntime;
  constructor(private readonly root: string) { this.runtime = resolveWpRuntime(root); }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const commandArgs = [...this.runtime.prefix, `--path=${this.root}`, "--skip-plugins", ...args];
      const child = spawn(this.runtime.command, commandArgs, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`WP-CLI failed (${args.slice(0, 2).join(" ")}): ${stderr.trim()}`)));
    });
  }

  async healthCheck(): Promise<void> { await this.run(["core", "is-installed"]); }
  async homeUrl(): Promise<string> { return this.run(["option", "get", "home"]); }

  async createOrUpdatePreview(plan: HomepagePlan, manifest: HomepageManifest): Promise<PreviewPage> {
    const ids = await this.run(["post", "list", "--post_type=page", `--name=${manifest.homepage_slug}`, "--field=ID"]);
    const existing = firstNumericWpId(ids);
    const id = existing
      ? (await this.run(["post", "update", existing, `--post_title=${plan.title}`, `--post_name=${manifest.homepage_slug}`, "--post_status=publish", "--porcelain"])) || existing
      : await this.run(["post", "create", "--post_type=page", "--post_status=publish", `--post_title=${plan.title}`, `--post_name=${manifest.homepage_slug}`, "--porcelain"]);
    await this.run(["post", "meta", "update", id, "_wp_page_template", `page-templates/${manifest.template_filename}`]);
    const url = await this.run(["post", "url", id]);
    if (!url) throw new Error("WP-CLI did not return a preview Page URL");
    return { id, url, slug: manifest.homepage_slug };
  }

  async setStaticFrontPage(pageId: string): Promise<void> {
    if (!/^\d+$/.test(pageId)) throw new Error("Refusing invalid WordPress Page ID");
    const [previousMode, previousPage] = await Promise.all([this.run(["option", "get", "show_on_front"]), this.run(["option", "get", "page_on_front"])]);
    try {
      await this.run(["option", "update", "show_on_front", "page"]);
      await this.run(["option", "update", "page_on_front", pageId]);
      const actual = await this.run(["option", "get", "page_on_front"]);
      if (actual !== pageId) throw new Error("WordPress did not retain the expected static front Page ID");
    } catch (error) {
      await this.run(["option", "update", "show_on_front", previousMode]).catch(() => undefined);
      await this.run(["option", "update", "page_on_front", previousPage]).catch(() => undefined);
      throw error;
    }
  }
}

export async function confirmUrl(url: string, authorization?: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), ...(authorization ? { headers: { Authorization: authorization } } : {}) });
  if (!response.ok) throw new Error(`Page render check failed with HTTP ${response.status}`);
}

