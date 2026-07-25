export const TRACKER_SHEET = "Homepage tracker";

export const TRACKER_COLUMNS = [
  "homepage_id", "homepage_idea", "homepage_status", "target_theme_path",
  "homepage_slug", "template_date", "template_path", "manifest_path",
  "preview_page_id", "preview_url", "live_link_url", "review_status",
  "review_token", "review_requested_at", "review_reply_at", "model_used",
  "last_error", "last_updated_at"
] as const;

export const HOMEPAGE_STATES = [
  "pending", "planning", "generating", "validating", "awaiting_review",
  "approved", "installing", "installed", "rejected", "error",
  "blocked_review_delivery"
] as const;

export type HomepageState = (typeof HOMEPAGE_STATES)[number];
export type TrackerColumn = (typeof TRACKER_COLUMNS)[number];

export const PART_SPECS = [
  ["01-hero", "Introduce the offer with a clear value proposition and primary call to action."],
  ["02-trust", "Establish credibility with concise, supportable trust signals."],
  ["03-problem", "Describe the visitor's problem in empathetic, concrete language."],
  ["04-solution", "Present the business or service as the practical solution."],
  ["05-features", "Explain the most important capabilities or benefits."],
  ["06-process", "Show a simple, low-friction process for getting started."],
  ["07-results", "Describe realistic outcomes without fabricated statistics."],
  ["08-testimonial", "Provide a clearly labeled testimonial placeholder, never a fabricated endorsement."],
  ["09-faq", "Answer common buyer questions."],
  ["10-cta", "Close with a focused call to action."]
] as const;

export const EXPECTED_THEME_DIRECTORY = "nolan-young-theme-template-02";
export const PROMPT_VERSION = "homepage-v2-2026-07-25";
