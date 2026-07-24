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
