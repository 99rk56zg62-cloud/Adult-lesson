export function isAllowedReturnUrl(value: string, appWebUrl: string): boolean {
  if (!value || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "lido:" || url.protocol === "exp:" || url.protocol === "exps:") {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  let webOrigin: string | null = null;
  try {
    webOrigin = new URL(appWebUrl).origin;
  } catch {
    webOrigin = null;
  }
  if (webOrigin && url.origin === webOrigin) return true;

  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

export function appendQuery(value: string, params: Record<string, string>): string {
  const url = new URL(value);
  for (const [key, item] of Object.entries(params)) {
    url.searchParams.set(key, item);
  }
  return url.toString();
}
