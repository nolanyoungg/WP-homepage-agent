import { z } from "zod";
import type { GeneratedHomepage, HomepageManifest, HomepagePlan } from "./types.js";

const planSchema = z.object({
  title: z.string().min(1).max(120), pageSlug: z.string().min(1).max(64), audience: z.string().min(1).max(240), tone: z.string().min(1).max(120),
  sections: z.array(z.object({ key: z.string().min(1).max(32), heading: z.string().min(1).max(120), intent: z.string().min(1).max(500) })).length(10)
});

function parseJson<T>(content: string, schema: z.ZodType<T>): T {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return schema.parse(JSON.parse(cleaned));
}

export function normalizeGeneratedHtml(content: string): string {
  const cleaned = content.trim().replace(/^```html\s*/i, "").replace(/\s*```$/, "").trim();
  const forbidden = /<\?(?:php|=)?|<\s*(?:script|style|iframe|object|embed|form)\b|\bon[a-z]+\s*=|javascript:|https?:\/\//i;
  if (!cleaned) throw new Error("LM Studio returned an empty HTML fragment");
  if (forbidden.test(cleaned)) throw new Error("LM Studio HTML fragment contains prohibited executable or remote content");
  return cleaned;
}

export function wrapHtmlPart(content: string): string {
  return `<?php\ndefined( 'ABSPATH' ) || exit;\n?>\n${normalizeGeneratedHtml(content)}\n`;
}

export function buildPageTemplate(manifest: HomepageManifest): string {
  const date = manifest.template_filename.replace("page-template-home-page-", "").replace(".php", "");
  const calls = manifest.parts.map((part) => `get_template_part( 'template-parts/homepage/${part.filename.replace(/\.php$/, "")}' );`).join("\n");
  return `<?php\n/**\n * Template Name: Generated Home Page ${date}\n */\ndefined( 'ABSPATH' ) || exit;\n\nget_header();\n\n${calls}\n\nget_footer();\n`;
}
export class LmStudioClient {
  constructor(private readonly baseUrl: string, private readonly model: string) {}

  async healthCheck(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`LM Studio health check failed with HTTP ${response.status}`);
    const body = z.object({ data: z.array(z.object({ id: z.string() })) }).parse(await response.json());
    if (!body.data.some((entry) => entry.id === this.model)) throw new Error(`LM Studio model is not already available: ${this.model}`);
  }

  private async complete(system: string, user: string, maxTokens: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(300_000),
      body: JSON.stringify({
        model: this.model, temperature: 0.2, seed: 42, reasoning_effort: "low", max_tokens: maxTokens, stream: false,
        messages: [{ role: "system", content: system }, { role: "user", content: user }]
      })
    });
    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => undefined);
      const parsedError = z.object({ error: z.union([z.string(), z.object({ message: z.string() })]).optional() }).safeParse(errorBody);
      const detail = parsedError.success
        ? typeof parsedError.data.error === "string" ? parsedError.data.error : parsedError.data.error?.message
        : undefined;
      throw new Error(`LM Studio generation failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`);
    }
    const body = z.object({
      choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string() }) })).min(1)
    }).parse(await response.json());
    const choice = body.choices[0]!;
    if (choice.finish_reason && choice.finish_reason !== "stop") throw new Error(`LM Studio response ended with finish_reason=${choice.finish_reason}`);
    return choice.message.content;
  }

  async generatePlan(homepageIdea: string): Promise<HomepagePlan> {
    const content = await this.complete(
      "You plan one concise WordPress business homepage. Return one JSON object only, without markdown. Never create blog content or invent testimonials, credentials, statistics, or factual claims.",
      `Idea: ${homepageIdea}\nReturn {title,pageSlug,audience,tone,sections}. Sections must use exactly this key order: 01-hero,02-trust,03-problem,04-solution,05-features,06-process,07-results,08-testimonial,09-faq,10-cta. Each section has key, heading, and a one-sentence intent.`,
      4_000
    );
    return parseJson(content, planSchema);
  }

  async generatePhp(plan: HomepagePlan, manifest: HomepageManifest): Promise<GeneratedHomepage> {
    const parts: GeneratedHomepage["parts"] = [];
    for (const part of manifest.parts) {
      const section = plan.sections.find((candidate) => candidate.key === part.key);
      const html = await this.complete(
        "Generate only one static semantic HTML section fragment. Do not use markdown, PHP, scripts, styles, forms, iframes, remote URLs, javascript URLs, inline event handlers, credentials, fabricated claims, or fabricated testimonials. Use relative hash links for calls to action.",
        `Section filename: ${part.filename}\nPurpose: ${part.purpose}\nHomepage context: ${JSON.stringify({ title: plan.title, audience: plan.audience, tone: plan.tone, section })}\nReturn only the complete HTML fragment. A testimonial must be an explicit placeholder, never a fabricated endorsement.`,
        4_000
      );
      parts.push({ filename: part.filename, content: wrapHtmlPart(html) });
    }
    return { template: buildPageTemplate(manifest), parts };
  }
}




