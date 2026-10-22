import type { VideoSample } from "./messages.ts";

export function watchVideoId(href: string): string | null {
  const url = new URL(href);
  const id = url.searchParams.get("v");
  return url.hostname === "www.youtube.com" && url.pathname === "/watch"
    && id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
}

export function readVideoSample(doc: Document, href: string, now = Date.now()): VideoSample | null {
  const videoId = watchVideoId(href);
  const watchPage = doc.querySelector("ytd-watch-flexy[video-id]");
  if (!videoId || (watchPage && watchPage.getAttribute("video-id") !== videoId)) return null;
  const video = doc.querySelector<HTMLVideoElement>("#movie_player video.html5-main-video, ytd-player video");
  if (!video || video.readyState < 1 || !Number.isFinite(video.currentTime)) return null;
  if (!Number.isFinite(video.playbackRate) || video.playbackRate < 0.25 || video.playbackRate > 2) return null;
  const buffering = !video.paused && !video.ended && video.readyState < 3;
  return {
    videoId, position: Math.max(0, video.currentTime), playbackRate: video.playbackRate,
    playing: !video.paused && !video.ended && !buffering,
    buffering,
    adShowing: !!doc.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting"),
    capturedAt: now,
  };
}
