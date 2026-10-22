export const DEFAULT_SETTINGS = {
  backendUrl: "https://partysync.onrender.com",
  frontendUrl: "https://partysync-seven.vercel.app",
};
export type Settings = typeof DEFAULT_SETTINGS;

export function normalizeUrl(value: unknown, backend = false): string {
  if (typeof value !== "string") throw new Error("Enter a valid website URL.");
  const url = new URL(value.trim());
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password) {
    throw new Error("Use HTTPS, or HTTP on localhost for development.");
  }
  if (backend && url.pathname !== "/") throw new Error("The backend URL must be an origin, without /api or /socket.io.");
  if (url.search || url.hash) throw new Error("Remove query parameters and fragments from the URL.");
  return url.href.replace(/\/$/, "");
}

export function parseSettings(value: unknown): Settings {
  const settings = value as Partial<Settings> | null;
  return {
    backendUrl: normalizeUrl(settings?.backendUrl ?? DEFAULT_SETTINGS.backendUrl, true),
    frontendUrl: normalizeUrl(settings?.frontendUrl ?? DEFAULT_SETTINGS.frontendUrl),
  };
}

export function inviteUrl(frontendUrl: string, code: string): string {
  if (!/^[A-F0-9]{6}$/.test(code)) throw new Error("Invalid room code.");
  const url = new URL(frontendUrl);
  url.searchParams.set("room", code);
  return url.href;
}

export function backendPermission(backendUrl: string) { return `${new URL(backendUrl).origin}/*`; }
