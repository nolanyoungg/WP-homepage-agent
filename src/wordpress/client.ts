import fs from "node:fs";
import path from "node:path";
import { runProcess } from "../runtime/process.js";
import type { HomepageManifest, HomepagePlan } from "../domain/types.js";

export interface PreviewPage {
  id: string;
  url: string;
  slug: string;
}

export interface FrontPageSettings {
  mode: string;
  pageId: string;
}

interface WpRuntime {
  command: string;
  prefix: string[];
}

export interface WordPressGateway {
  healthCheck(): Promise<void>;
  homeUrl(): Promise<string>;
  createOrUpdatePreview(plan: HomepagePlan, manifest: HomepageManifest, expectedPreviewId?: string): Promise<PreviewPage>;
  frontPageSettings(): Promise<FrontPageSettings>;
  setStaticFrontPage(pageId: string): Promise<void>;
  restoreFrontPage(settings: FrontPageSettings): Promise<void>;
  pageAgentId(pageId: string): Promise<string>;
  pageTemplate(pageId: string): Promise<string>;
  pageUrl(pageId: string): Promise<string>;
}

function resolveWpRuntime(wordpressRoot: string): WpRuntime {
  const localPhar = path.join(
    process.env.LOCALAPPDATA ?? "",
    "Programs",
    "Local",
    "resources",
    "extraResources",
    "bin",
    "wp-cli",
    "wp-cli.phar"
  );
  if (process.platform !== "win32" || !fs.existsSync(localPhar)) {
    return { command: "wp", prefix: [] };
  }
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
      if (fs.existsSync(php)) {
        return {
          command: php,
          prefix: ["-c", ini, "-d", "display_startup_errors=0", localPhar]
        };
      }
    }
  }
  return { command: "php", prefix: [localPhar] };
}

export function firstNumericWpId(output: string): string | undefined {
  return output.split(/\s+/).find((value) => /^\d+$/.test(value));
}

export class WordPressClient implements WordPressGateway {
  private readonly runtime: WpRuntime;

  constructor(
    private readonly root: string,
    private readonly timeoutMs = 60_000
  ) {
    this.runtime = resolveWpRuntime(root);
  }

  private async run(args: string[]): Promise<string> {
    const commandArgs = [
      ...this.runtime.prefix,
      `--path=${this.root}`,
      "--skip-plugins",
      ...args
    ];
    try {
      return (await runProcess(this.runtime.command, commandArgs, {
        timeoutMs: this.timeoutMs,
        maxOutputBytes: 2_000_000
      })).stdout;
    } catch (error) {
      throw new Error(`WP-CLI failed (${args.slice(0, 2).join(" ")}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async healthCheck(): Promise<void> {
    await this.run(["core", "is-installed"]);
  }

  async homeUrl(): Promise<string> {
    return this.run(["option", "get", "home"]);
  }

  async pageAgentId(pageId: string): Promise<string> {
    return this.run(["post", "meta", "get", pageId, "_wp_homepage_agent_id"]).catch(() => "");
  }

  async pageTemplate(pageId: string): Promise<string> {
    return this.run(["post", "meta", "get", pageId, "_wp_page_template"]).catch(() => "");
  }

  async pageUrl(pageId: string): Promise<string> {
    return this.run(["post", "url", pageId]);
  }

  private async ownedPageId(homepageId: string): Promise<string | undefined> {
    const output = await this.run([
      "post", "list",
      "--post_type=page",
      "--post_status=any",
      "--meta_key=_wp_homepage_agent_id",
      `--meta_value=${homepageId}`,
      "--field=ID"
    ]);
    return firstNumericWpId(output);
  }

  private async slugPageId(slug: string): Promise<string | undefined> {
    const output = await this.run([
      "post", "list",
      "--post_type=page",
      "--post_status=any",
      `--name=${slug}`,
      "--field=ID"
    ]);
    return firstNumericWpId(output);
  }

  async createOrUpdatePreview(
    plan: HomepagePlan,
    manifest: HomepageManifest,
    expectedPreviewId?: string
  ): Promise<PreviewPage> {
    let id = await this.ownedPageId(manifest.homepage_id);
    const slugMatch = await this.slugPageId(manifest.homepage_slug);
    if (id && slugMatch && id !== slugMatch) {
      throw new Error(`Homepage ${manifest.homepage_id} ownership and slug resolve to different Pages`);
    }
    if (!id && slugMatch) {
      const owner = await this.pageAgentId(slugMatch);
      if (owner === manifest.homepage_id) id = slugMatch;
      else if (!owner && expectedPreviewId === slugMatch) id = slugMatch;
      else throw new Error(`Refusing to update Page ${slugMatch}; slug is not owned by homepage ${manifest.homepage_id}`);
    }
    if (id && expectedPreviewId && id !== expectedPreviewId) {
      throw new Error(`Tracker preview Page ${expectedPreviewId} does not match owned Page ${id}`);
    }
    id = id
      ? (await this.run([
          "post", "update", id,
          `--post_title=${plan.title}`,
          `--post_name=${manifest.homepage_slug}`,
          "--post_status=publish",
          "--porcelain"
        ])) || id
      : await this.run([
          "post", "create",
          "--post_type=page",
          "--post_status=publish",
          `--post_title=${plan.title}`,
          `--post_name=${manifest.homepage_slug}`,
          "--porcelain"
        ]);
    if (!/^\d+$/.test(id)) throw new Error("WP-CLI did not return a valid preview Page ID");
    await this.run(["post", "meta", "update", id, "_wp_homepage_agent_id", manifest.homepage_id]);
    await this.run(["post", "meta", "update", id, "_wp_page_template", `page-templates/${manifest.template_filename}`]);
    const [owner, template, url] = await Promise.all([
      this.pageAgentId(id),
      this.pageTemplate(id),
      this.pageUrl(id)
    ]);
    if (owner !== manifest.homepage_id) throw new Error("WordPress preview Page ownership metadata did not persist");
    if (template !== `page-templates/${manifest.template_filename}`) {
      throw new Error("WordPress preview Page template metadata did not persist");
    }
    if (!url) throw new Error("WP-CLI did not return a preview Page URL");
    return { id, url, slug: manifest.homepage_slug };
  }

  async frontPageSettings(): Promise<FrontPageSettings> {
    const [mode, pageId] = await Promise.all([
      this.run(["option", "get", "show_on_front"]),
      this.run(["option", "get", "page_on_front"])
    ]);
    return { mode, pageId };
  }

  async setStaticFrontPage(pageId: string): Promise<void> {
    if (!/^\d+$/.test(pageId)) throw new Error("Refusing invalid WordPress Page ID");
    await this.run(["option", "update", "show_on_front", "page"]);
    await this.run(["option", "update", "page_on_front", pageId]);
    const actual = await this.frontPageSettings();
    if (actual.mode !== "page" || actual.pageId !== pageId) {
      throw new Error("WordPress did not retain the expected static front Page settings");
    }
  }

  async restoreFrontPage(settings: FrontPageSettings): Promise<void> {
    await this.run(["option", "update", "show_on_front", settings.mode]);
    await this.run(["option", "update", "page_on_front", settings.pageId]);
    const actual = await this.frontPageSettings();
    if (actual.mode !== settings.mode || actual.pageId !== settings.pageId) {
      throw new Error("WordPress front-page rollback did not retain the previous settings");
    }
  }
}
