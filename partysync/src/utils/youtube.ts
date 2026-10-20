export function extractYoutubeId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let videoId: string | null = null;

    if (host === "youtu.be") {
      videoId = url.pathname.split("/")[1];
    } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const parts = url.pathname.split("/");
      videoId = url.pathname === "/watch"
        ? url.searchParams.get("v")
        : ["shorts", "embed", "live"].includes(parts[1]) ? parts[2] : null;
    }

    return videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}
