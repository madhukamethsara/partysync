import type { PlaybackResponse, PlaybackState, PlaybackUpdate } from "../shared/protocol.ts";
import { expectedPosition } from "../utils/playback.ts";

/** The synchronous IFrame API object supplied by YouTube's onReady event. */
export interface SyncPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  setPlaybackRate(rate: number): void;
  addEventListener(event: string, listener: (event: { data: number }) => void): void;
  removeEventListener(event: string, listener: (event: { data: number }) => void): void;
}

type HostOptions = {
  player: SyncPlayer;
  playback: PlaybackState;
  send: (update: PlaybackUpdate) => Promise<PlaybackResponse>;
  onPlayback: (playback: PlaybackState) => void;
  onStatus: (message: string) => void;
  now?: () => number;
};

/** Coalesce controls into fresh samples and allow only one update in flight. */
export class HostPublisher {
  private options: HostOptions;
  private playback: PlaybackState;
  private videoId: string | null;
  private disposed = false;
  private pending = false;
  private sending = false;
  private lastSample: { position: number; playing: boolean; playbackRate: number; at: number } | null = null;
  private lastSentAt = -Infinity;

  constructor(options: HostOptions) {
    this.options = options;
    this.playback = options.playback;
    this.videoId = options.playback.videoId;
  }

  accept(playback: PlaybackState) {
    if (playback.sequence > this.playback.sequence) this.playback = playback;
  }

  dispose() { this.disposed = true; this.pending = false; }

  private sample() {
    const player = this.options.player;
    const state = player.getPlayerState();
    // Unstarted/cued players have no user playback sample yet.
    if (state === -1 || state === 5 || !this.videoId || this.playback.videoId !== this.videoId) return null;
    const position = player.getCurrentTime();
    const playbackRate = player.getPlaybackRate();
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(playbackRate)
      || playbackRate < 0.25 || playbackRate > 2) return null;
    return { position, playbackRate, playing: state === 1, at: (this.options.now ?? Date.now)() };
  }

  poll() {
    if (this.disposed) return;
    const sample = this.sample();
    if (!sample) return;
    const previous = this.lastSample;
    const predicted = previous
      ? previous.position + (previous.playing ? (sample.at - previous.at) / 1000 * previous.playbackRate : 0)
      : sample.position;
    if (!previous || sample.playing !== previous.playing || sample.playbackRate !== previous.playbackRate
      || Math.abs(sample.position - predicted) > 0.5 || sample.at - this.lastSentAt >= 2000) {
      this.publish();
    }
    this.lastSample = sample;
  }

  publish() {
    if (this.disposed) return;
    this.pending = true;
    if (!this.sending) void this.flush();
  }

  private async flush() {
    this.sending = true;
    try {
      while (this.pending && !this.disposed) {
        this.pending = false;
        const sample = this.sample();
        if (!sample || !this.videoId) break;
        this.lastSentAt = sample.at;
        const response = await this.options.send({
          videoId: this.videoId, position: sample.position, playing: sample.playing,
          playbackRate: sample.playbackRate, sequence: this.playback.sequence + 1,
        });
        if (this.disposed) return;
        if (response.playback) {
          this.accept(response.playback);
          this.options.onPlayback(this.playback);
        }
        this.options.onStatus(response.success
          ? "Host controls are live. Everyone follows your player."
          : "Playback update delayed. Retrying with the latest position.");
        // A conflict is recovered on the next fresh poll, never by replaying an old sample.
        if (!response.success) { this.pending = false; break; }
      }
    } catch {
      if (!this.disposed) this.options.onStatus("Could not share playback. Retrying automatically.");
      this.pending = false;
    } finally {
      this.sending = false;
    }
  }
}

type GuestOptions = {
  player: SyncPlayer;
  getPlayback: () => PlaybackState;
  serverNow: () => number | null;
  onStatus: (message: string) => void;
  onNeedsStart: (needed: boolean) => void;
  now?: () => number;
};

export class GuestFollower {
  private options: GuestOptions;
  private enabled = false;
  private disposed = false;
  private lastSeekAt = -Infinity;
  private playAttemptAt: number | null = null;
  private requestedRate: number | null = null;
  private lastRateAttemptAt = -Infinity;
  private previousPlayback: PlaybackState | null = null;
  private syncing = false;

  constructor(options: GuestOptions) { this.options = options; }
  dispose() { this.disposed = true; this.enabled = false; }

  start() {
    if (this.disposed) return;
    this.enabled = true;
    this.playAttemptAt = null;
    this.options.onNeedsStart(false);
    this.sync(true);
  }

  autoplayBlocked() {
    if (this.disposed) return;
    this.enabled = false;
    this.playAttemptAt = null;
    this.options.onNeedsStart(true);
    this.options.onStatus("Your browser paused playback. Tap Join & Start to continue.");
  }

  sync(force = false) {
    if (this.disposed || !this.enabled) return;
    // Player commands can themselves cause state events. Never follow recursively.
    if (this.syncing) return;
    this.syncing = true;
    try { this.follow(force); }
    finally { this.syncing = false; }
  }

  private follow(force: boolean) {
    const serverNow = this.options.serverNow();
    if (serverNow === null) {
      this.options.onStatus("Checking the party clock. Tap Join & Start when it is ready.");
      this.enabled = false;
      this.options.onNeedsStart(true);
      return;
    }
    const { player } = this.options;
    const playback = this.options.getPlayback();
    const previous = this.previousPlayback;
    const hostControlChanged = previous && playback.sequence > previous.sequence && (
      playback.playing !== previous.playing || playback.playbackRate !== previous.playbackRate
      || Math.abs(expectedPosition(previous, playback.updatedAt) - playback.position) > 0.6
    );
    this.previousPlayback = playback;
    const now = (this.options.now ?? Date.now)();
    const state = player.getPlayerState();
    const duration = player.getDuration();
    const target = expectedPosition(playback, serverNow, duration);
    const atEnd = duration > 0 && target >= duration;
    const playing = playback.playing && !atEnd;

    const rateSupported = player.getAvailablePlaybackRates().includes(playback.playbackRate);
    if (rateSupported && player.getPlaybackRate() !== playback.playbackRate
      && (this.requestedRate !== playback.playbackRate || now - this.lastRateAttemptAt >= 1500)) {
      this.requestedRate = playback.playbackRate;
      this.lastRateAttemptAt = now;
      player.setPlaybackRate(playback.playbackRate);
    }
    const drift = Math.abs(player.getCurrentTime() - target);
    const shouldSeek = force || (drift > (playing ? 0.6 : 0.15) && (
      hostControlChanged || (state !== 3 && now - this.lastSeekAt >= 2500)
    ));
    if (shouldSeek) {
      player.seekTo(target, true);
      this.lastSeekAt = now;
    }
    if (playing) {
      if (state === 1) {
        this.playAttemptAt = null;
        this.options.onStatus(rateSupported ? "Following the host." : "Your player does not support the host’s playback speed.");
      } else if (state === 3) {
        this.playAttemptAt = null;
        this.options.onStatus("Buffering. Playback will catch up automatically.");
      } else if (this.playAttemptAt === null) {
        this.playAttemptAt = now;
        player.playVideo();
        this.options.onStatus("Syncing with the host…");
      } else if (now - this.playAttemptAt >= 3000) {
        this.autoplayBlocked();
      }
    } else {
      this.playAttemptAt = null;
      if (shouldSeek || (state !== 2 && state !== 0)) player.pauseVideo();
      this.options.onStatus(atEnd ? "The song has ended." : "Paused by the host.");
    }
  }
}
