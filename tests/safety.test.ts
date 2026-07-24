import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assertTransition, createStarterTracker, TrackerStore } from "../src/tracker.js";
import { buildManifest, validateManifest, writeManifest } from "../src/manifest.js";
import { isPathInside } from "../src/paths.js";
import { parseApproval } from "../src/relay.js";
import { redact, SafeLogger } from "../src/logger.js";
import { validateGeneratedHomepage } from "../src/validation.js";
import { buildPageTemplate, normalizeGeneratedHtml, wrapHtmlPart } from "../src/lm-studio.js";
import { firstNumericWpId } from "../src/wordpress.js";
import type { HomepagePlan, TrackerRow } from "../src/types.js";

const temporaryRoots: string[] = [];
async function temporaryRoot(): Promise<string> {
  const root = path.resolve(".test-tmp", crypto.randomUUID());
  temporaryRoots.push(root); await fs.mkdir(root, { recursive: true }); return root;
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function trackerRow(): TrackerRow {
  return {
    homepage_id: "42", homepage_idea: "A careful local landscaping service", homepage_status: "planning",
    target_theme_path: "C:\\theme", homepage_slug: "", template_date: "", template_path: "", manifest_path: "",
    preview_page_id: "", preview_url: "", live_link_url: "", review_status: "", review_token: "",
    review_requested_at: "", review_reply_at: "", model_used: "", last_error: "", last_updated_at: ""
  };
}
function plan(): HomepagePlan {
  const keys = ["01-hero","02-trust","03-problem","04-solution","05-features","06-process","07-results","08-testimonial","09-faq","10-cta"];
  return { title: "Careful Landscaping", pageSlug: "careful-landscaping", audience: "Homeowners", tone: "Grounded", sections: keys.map((key) => ({ key, heading: key, intent: key })) };
}

describe("tracker transitions", () => {
  test("accepts intended progression and rejects unsafe jumps", () => {
    expect(() => assertTransition("pending", "planning")).not.toThrow();
    expect(() => assertTransition("awaiting_review", "approved")).not.toThrow();
    expect(() => assertTransition("error", "validating")).not.toThrow();
    expect(() => assertTransition("pending", "installed")).toThrow(/Invalid tracker transition/);
  });
  test("claims only one pending workbook row", async () => {
    const root = await temporaryRoot(); const workbook = path.join(root, "tracker.xlsx");
    await createStarterTracker(workbook);
    const store = new TrackerStore(workbook);
    expect(await store.claimPending()).toBeUndefined();
  });
});

describe("manifest enforcement", () => {
  test("creates exactly ten unique canonical parts", () => {
    const manifest = buildManifest(trackerRow(), plan(), "C:\\theme", "local-model", new Date("2026-07-24T12:00:00Z"));
    expect(validateManifest(manifest).parts).toHaveLength(10);
    expect(new Set(manifest.parts.map((part) => part.filename)).size).toBe(10);
  });
  test("atomically replaces the canonical manifest after checksums", async () => {
    const root = await temporaryRoot(); const file = path.join(root, "manifest.json");
    const manifest = buildManifest(trackerRow(), plan(), "C:\\theme", "local-model");
    await writeManifest(file, manifest);
    manifest.template_checksum_sha256 = "a".repeat(64);
    await writeManifest(file, manifest);
    expect(JSON.parse(await fs.readFile(file, "utf8")).template_checksum_sha256).toBe("a".repeat(64));
  });
  test("replaces a generic model slug with the validated plan title", () => {
    const genericPlan = { ...plan(), pageSlug: "home" };
    expect(buildManifest(trackerRow(), genericPlan, "C:\\theme", "local-model").homepage_slug).toBe("careful-landscaping");
  });
  test("rejects a duplicate filename", () => {
    const manifest = buildManifest(trackerRow(), plan(), "C:\\theme", "local-model");
    manifest.parts[1]!.filename = manifest.parts[0]!.filename;
    expect(() => validateManifest(manifest)).toThrow(/duplicate/i);
  });
  test("rejects a staged set that is not exactly eleven PHP files", async () => {
    const root = await temporaryRoot(); const staging = path.join(root, "staging");
    const theme = path.join(root, "theme"); const manifest = buildManifest(trackerRow(), plan(), theme, "local-model");
    await fs.mkdir(path.join(staging, "page-templates"), { recursive: true });
    await fs.mkdir(path.join(staging, "template-parts", "homepage"), { recursive: true });
    await fs.writeFile(path.join(staging, "page-templates", manifest.template_filename), "<?php");
    for (const part of manifest.parts.slice(0, 9)) await fs.writeFile(path.join(staging, "template-parts", "homepage", part.filename), "<?php");
    await expect(validateGeneratedHomepage(staging, theme, manifest, [])).rejects.toThrow("Expected exactly 11 PHP files");
  });
});

describe("WP-CLI output parsing", () => {
  test("ignores PHP startup warnings and returns only a numeric Page ID", () => {
    expect(firstNumericWpId("Warning: missing extension\n128\n")).toBe("128");
    expect(firstNumericWpId("Warning: missing extension\n[]")).toBeUndefined();
  });
});
describe("deterministic PHP construction", () => {
  test("wraps safe model HTML with an effective ABSPATH guard", () => {
    const wrapped = wrapHtmlPart("<section><h2>Safe content</h2></section>");
    expect(wrapped).toContain("defined( 'ABSPATH' ) || exit;");
    expect(wrapped).toContain("<section><h2>Safe content</h2></section>");
  });
  test("rejects executable and remote model HTML", () => {
    expect(() => normalizeGeneratedHtml("<?php echo 'unsafe'; ?>")).toThrow(/prohibited/);
    expect(() => normalizeGeneratedHtml("<script>alert(1)</script>")).toThrow(/prohibited/);
    expect(() => normalizeGeneratedHtml('<a href="https://example.com">Remote</a>')).toThrow(/prohibited/);
  });
  test("constructs exactly ten manifest-ordered template calls", () => {
    const manifest = buildManifest(trackerRow(), plan(), "C:\\theme", "local-model");
    const template = buildPageTemplate(manifest);
    expect([...template.matchAll(/get_template_part\s*\(/g)]).toHaveLength(10);
    manifest.parts.forEach((part) => expect(template).toContain(part.filename.replace(/\.php$/, "")));
  });
});
describe("safety boundaries", () => {
  test("contains child paths and rejects traversal", () => {
    const root = path.resolve("allowed");
    expect(isPathInside(root, path.join(root, "page-templates", "home.php"))).toBe(true);
    expect(isPathInside(root, path.resolve(root, "..", "other-theme", "home.php"))).toBe(false);
  });
  test("rejects stale, wrong-sender, and malformed approvals", () => {
    const requested = "2026-07-24T12:00:00.000Z";
    const base = { id: "1", sender: "+15551234567", body: "YES 42 — make this preview the Local site's homepage", receivedAt: "2026-07-24T12:01:00.000Z" };
    expect(parseApproval(base, "42", "+15551234567", requested)).toBe("approved");
    expect(parseApproval({ ...base, receivedAt: "2026-07-24T11:59:00.000Z" }, "42", "+15551234567", requested)).toBeUndefined();
    expect(parseApproval({ ...base, sender: "+15550000000" }, "42", "+15551234567", requested)).toBeUndefined();
    expect(parseApproval({ ...base, receivedAt: "not-a-date" }, "42", "+15551234567", requested)).toBeUndefined();
    expect(parseApproval({ ...base, body: "YES 41 — make this preview the Local site's homepage" }, "42", "+15551234567", requested)).toBeUndefined();
  });
  test("redacts secrets from objects and logger output", () => {
    const secret = "do-not-print-this";
    expect(JSON.stringify(redact({ password: secret, note: `value=${secret}` }, [secret]))).not.toContain(secret);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    new SafeLogger([secret]).error("failure", { value: secret, relayToken: secret });
    expect(write.mock.calls.flat().join(" ")).not.toContain(secret);
    expect(write.mock.calls.flat().join(" ")).toContain("[REDACTED]");
  });
});





