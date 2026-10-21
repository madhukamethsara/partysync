import type { SyncPlayer } from "../src/sync/playback";

interface TestPlayer extends SyncPlayer {
  videoId: string;
  blockPlayback: boolean;
  seekLatencyMs: number;
  seekCount: number;
  error(code: number): void;
  buffer(): void;
}

declare global {
  interface Window { mockYouTube: TestPlayer; delayedPlaybackPackets: number }
}

/** Test only: preserves the IFrame API's event wiring without network or ads. */
export function installMockYouTube() {
  type Event = { data: number; target: MockPlayer };
  type Listener = (event: Event) => void;
  class MockPlayer {
    videoId: string;
    blockPlayback = false;
    seekLatencyMs = 0;
    seekCount = 0;
    private state = 5;
    private position = 0;
    private rate = 1;
    private sampledAt = performance.now();
    private iframe: HTMLIFrameElement;
    private events: Record<string, Listener>;
    private listeners = new Map<string, Set<Listener>>();
    private seekTimer: ReturnType<typeof setTimeout> | null = null;
    private seekResumeState = 1;

    constructor(element: HTMLElement, options: { videoId: string; events: Record<string, Listener> }) {
      this.videoId = options.videoId;
      this.events = options.events;
      this.iframe = document.createElement("iframe");
      element.replaceWith(this.iframe);
      window.mockYouTube = this;
      setTimeout(() => this.events.onReady?.({ target: this, data: 0 }), 0);
    }
    private emit(name: string, data: number) {
      setTimeout(() => {
        const event = { target: this, data };
        this.events[name]?.(event);
        this.listeners.get(name)?.forEach((listener) => listener(event));
      }, 0);
    }
    private setState(state: number) {
      this.position = this.getCurrentTime(); this.sampledAt = performance.now();
      if (this.state === state) return;
      this.state = state; this.emit("onStateChange", state);
    }
    getCurrentTime() {
      return this.position + (this.state === 1 ? (performance.now() - this.sampledAt) / 1000 * this.rate : 0);
    }
    getPlayerState() { return this.state; }
    getPlaybackRate() { return this.rate; }
    getDuration() { return 300; }
    getAvailablePlaybackRates() { return [0.5, 1, 1.5, 2]; }
    getIframe() { return this.iframe; }
    playVideo() {
      if (this.blockPlayback) { this.emit("onAutoplayBlocked", 0); return; }
      if (this.seekTimer !== null) { this.seekResumeState = 1; return; }
      this.setState(1);
    }
    pauseVideo() { this.seekResumeState = 2; this.setState(2); }
    buffer() { this.setState(3); }
    seekTo(position: number) {
      this.seekCount++;
      if (this.seekTimer !== null) clearTimeout(this.seekTimer);
      if (this.seekLatencyMs > 0) {
        this.seekResumeState = this.state === 2 ? 2 : 1;
        this.setState(3);
        this.seekTimer = setTimeout(() => {
          this.position = position; this.sampledAt = performance.now();
          this.seekTimer = null;
          if (this.seekResumeState === 1) this.playVideo();
          else this.pauseVideo();
        }, this.seekLatencyMs);
        return;
      }
      this.position = position; this.sampledAt = performance.now();
      if (this.state === 5 || this.state === 0) this.playVideo();
    }
    setPlaybackRate(rate: number) {
      this.position = this.getCurrentTime(); this.sampledAt = performance.now();
      this.rate = rate; this.emit("onPlaybackRateChange", rate);
    }
    addEventListener(event: string, listener: Listener) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(listener);
    }
    removeEventListener(event: string, listener: Listener) { this.listeners.get(event)?.delete(listener); }
    setSize() {}
    error(code: number) { this.emit("onError", code); }
    destroy() {
      if (this.seekTimer !== null) clearTimeout(this.seekTimer);
      this.listeners.clear(); this.iframe.remove();
    }
  }
  Object.assign(window, { YT: { Player: MockPlayer } });
}
