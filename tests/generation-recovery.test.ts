import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { CheckpointStore } from "../src/generation/checkpoint.js";
import { buildPageTemplate, normalizeGeneratedHtml } from "../src/generation/html.js";
import { buildManifest, validateManifest } from "../src/domain/manifest.js";
import { validateGeneratedHomepage } from "../src/validation/homepage.js";
import { installHomepage } from "../src/workflow/install.js";
import { baseRow, homepagePlan, inference } from "./helpers.js";

const roots: string[] = [];
async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wp-homepage-agent-generation-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("manifest and output safety", () => {
  test("creates collision-resistant filenames for multiple homepages on one date", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const first = buildManifest(baseRow({ homepage_id: "one" }), homepagePlan(), "/theme", "approved/model", "instance-001", "run-one", inference(), now);
    const second = buildManifest(baseRow({ homepage_id: "two" }), homepagePlan(), "/theme", "approved/model", "instance-001", "run-two", inference(), now);
    expect(first.template_filename).not.toBe(second.template_filename);
    expect(new Set([...first.parts, ...second.parts].map((part) => part.filename)).size).toBe(20);
    expect(validateManifest(first).prompt_version).toMatch(/^homepage-v2-/);
  });

  test("builds exactly ten manifest-ordered template calls", () => {
    const manifest = buildManifest(baseRow(), homepagePlan(), "/theme", "approved/model", "instance-001", "run-one", inference());
    const template = buildPageTemplate(manifest);
    expect([...template.matchAll(/get_template_part\s*\(/g)]).toHaveLength(10);
    manifest.parts.forEach((part) => expect(template).toContain(part.filename.replace(/\.php$/, "")));
  });

  test.each([
    ["PHP", "<?php echo 'unsafe'; ?>"],
    ["script", "<script>alert(1)</script>"],
    ["remote URL", "<a href=\"https://example.com\">Remote</a>"],
    ["protocol-relative URL", "<img src=\"//example.com/a.png\" alt=\"x\">"],
    ["SVG", "<svg><use href=\"/sprite.svg#x\"></use></svg>"],
    ["event handler", "<button onclick=\"alert(1)\">Run</button>"],
    ["inline style", "<div style=\"color:red\">Styled</div>"],
    ["mixed srcset", "<img src=\"/safe.png\" srcset=\"/safe.png 1x, https://example.com/a.png 2x\" alt=\"x\">"]
  ])("rejects unsafe %s model output", (_label, html) => {
    expect(() => normalizeGeneratedHtml(html)).toThrow(/prohibited|invalid|must use|unsupported|protocol-relative/);
  });

  test("normalizes a static semantic fragment", () => {
    expect(normalizeGeneratedHtml("<section><h2>Safe</h2><a href=\"#contact\">Contact</a></section>"))
      .toBe("<section><h2>Safe</h2><a href=\"#contact\">Contact</a></section>");
  });
});

describe("checkpoint and installation recovery", () => {
  test("stages and validates exactly eleven deterministic PHP artifacts", async () => {
    const root = await temporaryRoot();
    const theme = path.join(root, "theme");
    const row = baseRow({ homepage_status: "generating" });
    const plan = homepagePlan();
    const manifest = buildManifest(row, plan, theme, "approved/model", "instance-001", "run-one", inference());
    const store = new CheckpointStore(path.join(root, "homepages"), row.homepage_id);
    let checkpoint = await store.initialize(row, theme, "approved/model", "instance-001", plan, inference(), manifest);
    for (const part of manifest.parts) {
      checkpoint = await store.saveSection(
        checkpoint,
        part,
        `<section id="${part.key}"><h2>${part.key}</h2><p>Static local content.</p></section>`,
        inference("section")
      );
    }
    const staging = path.join(root, "staging");
    await store.stage(checkpoint, staging);
    const checked = await validateGeneratedHomepage(staging, theme, checkpoint.manifest, []);
    expect(checked.template_checksum_sha256).toHaveLength(64);
    expect(checked.parts.every((part) => part.checksum_sha256?.length === 64)).toBe(true);
    const phpFiles = await fs.readdir(path.join(staging, "template-parts", "homepage"));
    expect(phpFiles).toHaveLength(10);
  });

  test("resumes completed sections and invalidates changed generation inputs", async () => {
    const root = await temporaryRoot();
    const row = baseRow({ homepage_status: "generating" });
    const plan = homepagePlan();
    const manifest = buildManifest(row, plan, "/theme", "approved/model", "instance-001", "run-one", inference());
    const store = new CheckpointStore(path.join(root, "homepages"), row.homepage_id);
    const checkpoint = await store.initialize(row, "/theme", "approved/model", "instance-001", plan, inference(), manifest);
    await store.saveSection(
      checkpoint,
      manifest.parts[0]!,
      "<section><h2>Completed once</h2></section>",
      inference("section")
    );
    const resumed = await new CheckpointStore(path.join(root, "homepages"), row.homepage_id)
      .loadCompatible(row, "/theme", "approved/model", "instance-001");
    expect(resumed?.completed_parts).toHaveLength(1);
    expect(resumed?.completed_parts[0]?.checksum_sha256).toHaveLength(64);

    const changed = await store.loadCompatible(
      { ...row, homepage_idea: "Changed input" },
      "/theme",
      "approved/model",
      "instance-001"
    );
    expect(changed).toBeUndefined();
    expect(await store.load()).toBeUndefined();
  });

  test("rolls back files copied before a later destination conflict", async () => {
    const root = await temporaryRoot();
    const staging = path.join(root, "staging");
    const theme = path.join(root, "theme");
    const manifest = buildManifest(baseRow(), homepagePlan(), theme, "approved/model", "instance-001", "run-one", inference());
    const sources = [
      path.join(staging, "page-templates", manifest.template_filename),
      ...manifest.parts.map((part) => path.join(staging, "template-parts", "homepage", part.filename))
    ];
    for (const source of sources) {
      await fs.mkdir(path.dirname(source), { recursive: true });
      await fs.writeFile(source, `source:${path.basename(source)}`);
    }
    const conflict = path.join(theme, "template-parts", "homepage", manifest.parts[0]!.filename);
    await fs.mkdir(path.dirname(conflict), { recursive: true });
    await fs.writeFile(conflict, "different existing content");
    await expect(installHomepage(staging, theme, manifest)).rejects.toThrow(/Refusing to overwrite/);
    await expect(fs.stat(path.join(theme, "page-templates", manifest.template_filename))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(conflict, "utf8")).toBe("different existing content");
  });
});
