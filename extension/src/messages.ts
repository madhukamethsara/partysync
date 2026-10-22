export type VideoSample = {
  videoId: string;
  position: number;
  playbackRate: number;
  playing: boolean;
  buffering: boolean;
  adShowing: boolean;
  capturedAt: number;
};

export type HostView = {
  phase: "idle" | "connecting" | "hosting";
  message: string;
  code: string | null;
  invite: string | null;
  members: number;
  name: string;
};

export type HostCommand =
  | { type: "start"; name: string; sample: VideoSample }
  | { type: "sample"; sample: VideoSample | null; immediate: boolean }
  | { type: "end" }
  | { type: "settings" };

export function validSample(value: unknown): value is VideoSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sample = value as VideoSample;
  return typeof sample.videoId === "string" && /^[a-zA-Z0-9_-]{11}$/.test(sample.videoId)
    && Number.isFinite(sample.position) && sample.position >= 0
    && Number.isFinite(sample.playbackRate) && sample.playbackRate >= 0.25 && sample.playbackRate <= 2
    && typeof sample.playing === "boolean" && typeof sample.buffering === "boolean"
    && typeof sample.adShowing === "boolean" && Number.isFinite(sample.capturedAt)
    && sample.capturedAt >= 0;
}
