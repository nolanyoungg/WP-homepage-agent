import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import type { GeneratedHomepage, HomepageManifest } from "../domain/types.js";

const allowedTags = new Set([
  "section", "div", "header", "footer", "main", "aside", "nav",
  "h1", "h2", "h3", "h4", "p", "span", "strong", "em", "small",
  "ul", "ol", "li", "dl", "dt", "dd", "blockquote", "cite",
  "a", "button", "figure", "figcaption", "img", "picture", "source",
  "details", "summary", "br", "hr"
]);

const allowedGlobalAttributes = new Set([
  "class", "id", "role", "aria-label", "aria-labelledby", "aria-describedby",
  "aria-hidden", "title"
]);

const allowedAttributesByTag: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "target", "rel"]),
  button: new Set(["type"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding"]),
  source: new Set(["srcset", "media", "type"]),
  details: new Set(["open"])
};

function isElement(node: AnyNode): node is Element {
  return node.type === "tag";
}

function validateUrl(value: string, attribute: string): void {
  if ([...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) || value.includes("\\")) {
    throw new Error(`Generated HTML contains an invalid ${attribute} value`);
  }
  if (attribute === "srcset") {
    const sources = value.split(",").map((entry) => entry.trim().split(/\s+/)[0] ?? "");
    if (!sources.length || sources.some((source) => !source)) {
      throw new Error("Generated HTML contains an invalid srcset value");
    }
    for (const source of sources) validateUrl(source, "src");
    return;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("//")) throw new Error(`Generated HTML contains a protocol-relative ${attribute}`);
  if (/^(?:https?:|javascript:|data:|vbscript:|file:)/i.test(normalized)) {
    throw new Error(`Generated HTML contains a prohibited ${attribute} URL`);
  }
  if (attribute === "href" && !(normalized.startsWith("#") || normalized.startsWith("/") || normalized.startsWith("./") || normalized.startsWith("../"))) {
    throw new Error("Generated HTML links must use a local path or hash target");
  }
  if ((attribute === "src" || attribute === "srcset") && !(normalized.startsWith("/") || normalized.startsWith("./") || normalized.startsWith("../"))) {
    throw new Error(`Generated HTML ${attribute} must use a local path`);
  }
}

function visit(node: AnyNode): void {
  if (node.type === "script" || node.type === "style" || node.type === "directive" || node.type === "cdata") {
    throw new Error(`Generated HTML contains prohibited ${node.type} content`);
  }
  if (isElement(node)) {
    const tag = node.name.toLowerCase();
    if (!allowedTags.has(tag)) throw new Error(`Generated HTML contains prohibited element <${tag}>`);
    if (tag === "svg" || tag === "math" || tag === "iframe" || tag === "object" || tag === "embed" || tag === "form") {
      throw new Error(`Generated HTML contains prohibited active element <${tag}>`);
    }
    for (const [rawName, value] of Object.entries(node.attribs)) {
      const name = rawName.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcdoc") {
        throw new Error(`Generated HTML contains prohibited attribute ${name}`);
      }
      const allowed = allowedGlobalAttributes.has(name) || allowedAttributesByTag[tag]?.has(name);
      if (!allowed) throw new Error(`Generated HTML contains unsupported attribute ${name} on <${tag}>`);
      if (name === "href" || name === "src" || name === "srcset") validateUrl(value, name);
      if (name === "target" && value !== "_self") throw new Error("Generated HTML may not open a new browsing context");
    }
  }
  for (const child of DomUtils.getChildren(node)) visit(child);
}

export function normalizeGeneratedHtml(content: string): string {
  const cleaned = content.trim().replace(/^```html\s*/i, "").replace(/\s*```$/, "").trim();
  if (!cleaned) throw new Error("LM Studio returned an empty HTML fragment");
  if (/<\?(?:php|=)?/i.test(cleaned)) throw new Error("LM Studio HTML fragment contains prohibited PHP");
  const document = parseDocument(cleaned, { decodeEntities: false, lowerCaseAttributeNames: true, lowerCaseTags: true });
  for (const child of document.children) visit(child);
  const html = DomUtils.getOuterHTML(document, { decodeEntities: false }).trim();
  if (!html) throw new Error("LM Studio returned an empty parsed HTML fragment");
  return html;
}

export function wrapHtmlPart(content: string): string {
  return `<?php\ndefined( 'ABSPATH' ) || exit;\n?>\n${normalizeGeneratedHtml(content)}\n`;
}

export function buildPageTemplate(manifest: HomepageManifest): string {
  const label = manifest.template_filename.replace(/^page-template-home-page-/, "").replace(/\.php$/, "");
  const calls = manifest.parts.map((part) =>
    `get_template_part( 'template-parts/homepage/${part.filename.replace(/\.php$/, "")}' );`
  ).join("\n");
  return `<?php\n/**\n * Template Name: Generated Home Page ${label}\n */\ndefined( 'ABSPATH' ) || exit;\n\nget_header();\n\n${calls}\n\nget_footer();\n`;
}

export function assembleGeneratedHomepage(manifest: HomepageManifest, parts: Array<{ filename: string; content: string }>): GeneratedHomepage {
  return { template: buildPageTemplate(manifest), parts };
}
