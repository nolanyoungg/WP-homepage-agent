export function buildLivePreviewUrl(liveLinkBase: string, localPreviewUrl: string): string {
  const local = new URL(localPreviewUrl);
  const live = new URL(liveLinkBase);
  live.pathname = local.pathname;
  live.search = local.search;
  live.hash = "";
  return live.toString();
}

export function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export async function confirmUrl(url: string, authorization?: string): Promise<void> {
  const initial = new URL(url);
  if (!["http:", "https:"].includes(initial.protocol)) {
    throw new Error("Page render check requires an HTTP(S) URL");
  }
  let current = initial;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      ...(authorization ? { headers: { Authorization: authorization } } : {})
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Page render redirect did not include a location");
      const next = new URL(location, current);
      if (!["http:", "https:"].includes(next.protocol) || next.hostname !== initial.hostname) {
        throw new Error("Page render redirect left the configured host");
      }
      if (authorization && next.origin !== initial.origin) {
        throw new Error("Authenticated page render redirect left the configured origin");
      }
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`Page render check failed with HTTP ${response.status}`);
    await response.body?.cancel();
    return;
  }
  throw new Error("Page render check exceeded five redirects");
}
