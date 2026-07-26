import path from "node:path";

export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertPathInside(parent: string, child: string): void {
  if (!isPathInside(parent, child)) throw new Error(`Refusing path outside allowed directory: ${child}`);
}

export function assertSafeHomepageId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error("homepage_id must be 1-64 safe letters, digits, underscores, or hyphens");
  }
}

export function safeSlug(input: string): string {
  const slug = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  if (!slug) throw new Error("Homepage idea cannot produce a safe slug");
  return slug;
}
