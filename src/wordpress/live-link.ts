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
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    ...(authorization ? { headers: { Authorization: authorization } } : {})
  });
  if (!response.ok) throw new Error(`Page render check failed with HTTP ${response.status}`);
}
