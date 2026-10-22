import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, PlaybackState, Room, ServerToClientEvents } from "../../partysync/src/shared/protocol.ts";
import { HostPublisher, type SyncPlayer } from "../../partysync/src/sync/playback.ts";
import { applyPlayback, clockSample, expectedPosition, mergeRoom } from "../../partysync/src/utils/playback.ts";
import { inviteUrl, type Settings } from "./config.ts";
import type { HostView, VideoSample } from "./messages.ts";

type PartySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** One host tab owns one socket and one room. No room restoration is attempted. */
export class HostSession {
  private settings: Settings;
  private notify: (view: HostView) => void;
  private socket: PartySocket | null = null;
  private room: Room | null = null;
  private publisher: HostPublisher | null = null;
  private latest: VideoSample | null = null;
  private remote: VideoSample | null = null;
  private offsetMs: number | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private selecting = false;
  private unavailable = false;
  private generation = 0;
  private view: HostView;
  private cancelConnect: (() => void) | null = null;

  get active() { return this.view.phase !== "idle"; }

  constructor(settings: Settings, notify: (view: HostView) => void, name = "") {
    this.settings = settings;
    this.notify = notify;
    this.view = { phase: "idle", message: "Host this video and invite friends to PartySync.", code: null,
      invite: null, members: 0, name };
    this.emit();
  }

  private emit() { this.notify({ ...this.view }); }
  private status(message: string) { this.view.message = message; this.emit(); }

  async start(name: string, sample: VideoSample) {
    if (this.view.phase !== "idle") return;
    name = name.trim();
    if (!name || name.length > 24) { this.status("Enter a name with up to 24 characters."); return; }
    if (sample.adShowing) { this.status("Wait for the YouTube ad to finish, then start the party."); return; }
    const generation = ++this.generation;
    this.latest = sample;
    this.view = { ...this.view, phase: "connecting", name, message: "Connecting to PartySync…" };
    this.emit();
    const socket: PartySocket = io(this.settings.backendUrl, {
      autoConnect: false, transports: ["websocket"], reconnection: false, timeout: 20000,
    });
    this.socket = socket;
    socket.on("disconnect", () => {
      if (this.socket === socket) this.stop("Connection lost. Start a new party when you are connected again.");
    });
    socket.on("room:updated", (room) => {
      if (this.room?.code !== room.code) return;
      this.room = mergeRoom(this.room, room);
      this.publisher?.accept(this.room.playback);
      this.view.members = room.participants.length;
      this.emit();
    });
    socket.on("playback:updated", (playback) => this.accept(playback));
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer); socket.off("connect", connected); socket.off("connect_error", failed);
          this.cancelConnect = null;
        };
        const connected = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("Could not connect. Check the backend URL and try again.")); };
        const timer = setTimeout(failed, 25000);
        this.cancelConnect = failed;
        socket.once("connect", connected);
        socket.once("connect_error", failed);
        socket.connect();
      });
      if (generation !== this.generation) return;
      await this.syncClock(socket);
      if (generation !== this.generation) return;
      const response = await socket.timeout(15000).emitWithAck("room:create", { name });
      if (generation !== this.generation) return;
      if (!response.success) throw new Error(response.message);
      this.room = response.room;
      this.view = { ...this.view, phase: "hosting", code: response.room.code, members: 1,
        invite: inviteUrl(this.settings.frontendUrl, response.room.code), message: "Preparing this video…" };
      this.emit();
      // Chrome 116+ extends worker lifetime on WebSocket traffic. Keep traffic
      // flowing even while the YouTube video is paused or an ad is playing.
      this.keepAlive = setInterval(() => { void this.syncClock(socket); }, 20000);
      await this.selectVideo();
    } catch (error) {
      if (generation === this.generation) this.stop(error instanceof Error ? error.message : "Could not start the party.");
    }
  }

  private async syncClock(socket: PartySocket) {
    let best: { offsetMs: number; roundTripMs: number } | null = null;
    for (let count = 0; count < 3; count++) {
      if (this.socket !== socket || !socket.connected) return;
      const sentAt = Date.now();
      try {
        const response = await socket.timeout(4000).emitWithAck("clock:sync", { clientSentAt: sentAt });
        if (this.socket !== socket) return;
        const sample = clockSample(response, sentAt, Date.now());
        if (sample && (!best || sample.roundTripMs < best.roundTripMs)) {
          best = sample; this.offsetMs = sample.offsetMs;
        }
      } catch { return; }
    }
  }

  private accept(playback: PlaybackState) {
    this.room = applyPlayback(this.room, playback);
    this.publisher?.accept(playback);
  }

  update(sample: VideoSample | null, immediate = false) {
    this.latest = sample;
    if (this.view.phase !== "hosting" || this.selecting || !this.room) return;
    if (!sample || sample.adShowing) {
      if (!this.unavailable && this.room.videoId) {
        this.unavailable = true;
        const capturedAt = Date.now();
        this.remote = {
          videoId: this.room.videoId,
          position: expectedPosition(this.room.playback, capturedAt + (this.offsetMs ?? 0)),
          playbackRate: this.room.playback.playbackRate, playing: false, buffering: true,
          adShowing: false, capturedAt,
        };
        if (!this.publisher) this.createPublisher();
        this.publisher?.publish();
      }
      this.status(sample?.adShowing ? "YouTube is showing an ad. Guests are paused."
        : "Waiting for a YouTube video. Guests are paused.");
      return;
    }
    const resumed = this.unavailable;
    this.unavailable = false;
    if (sample.videoId !== this.room.videoId) { void this.selectVideo(); return; }
    this.remote = sample;
    if (!this.publisher) this.createPublisher();
    if (immediate || resumed) this.publisher?.publish();
    else this.publisher?.poll();
  }

  private async selectVideo() {
    if (this.selecting || !this.socket || !this.room) return;
    this.selecting = true;
    this.publisher?.dispose();
    this.publisher = null;
    const socket = this.socket;
    try {
      while (this.socket === socket && this.room && this.latest && !this.latest.adShowing) {
        const videoId = this.latest.videoId;
        if (this.room.videoId !== videoId) {
          const response = await socket.timeout(5000).emitWithAck("video:change", { videoId });
          if (this.socket !== socket || !this.room) return;
          if (!response.success) throw new Error(response.message);
        }
        if (!this.latest || this.latest.adShowing) break;
        if (this.latest.videoId !== videoId) continue;
        this.remote = this.latest;
        const publisher = this.createPublisher();
        publisher?.publish();
        break;
      }
    } catch { if (this.socket === socket) this.status("Could not share this video. Retrying automatically."); }
    finally {
      this.selecting = false;
      if (this.socket === socket && (!this.latest || this.latest.adShowing)) this.update(this.latest);
    }
  }

  private createPublisher() {
    if (!this.room || !this.socket) return;
    const socket = this.socket;
    // HostPublisher only reads this adapter; it never controls the YouTube video.
    const player: SyncPlayer = {
      getCurrentTime: () => this.remote?.position ?? 0,
      getPlaybackRate: () => this.remote?.playbackRate ?? 1,
      getPlayerState: () => this.remote?.buffering ? 3 : this.remote?.playing ? 1 : 2,
      getDuration: () => 0, getAvailablePlaybackRates: () => [],
      seekTo() {}, playVideo() {}, pauseVideo() {}, setPlaybackRate() {},
      addEventListener() {}, removeEventListener() {},
    };
    this.publisher = new HostPublisher({ player, playback: this.room.playback,
      now: () => this.remote?.capturedAt ?? Date.now(),
      serverNow: () => this.offsetMs === null ? null : (this.remote?.capturedAt ?? Date.now()) + this.offsetMs,
      send: (update) => socket.timeout(5000).emitWithAck("playback:update", update),
      onPlayback: (playback) => this.accept(playback),
      onStatus: (message) => {
        if (!this.unavailable) this.status(this.remote?.buffering ? "Your video is buffering. Guests are paused."
          : message);
      },
    });
    return this.publisher;
  }

  end() { this.stop("Party ended. You can host another video."); }
  dispose() { this.stop("Host tab closed."); }

  private stop(message: string) {
    this.generation++;
    this.cancelConnect?.();
    this.publisher?.dispose(); this.publisher = null;
    if (this.keepAlive !== null) clearInterval(this.keepAlive);
    this.keepAlive = null;
    const socket = this.socket;
    this.socket = null;
    socket?.disconnect();
    this.room = null; this.latest = null; this.remote = null;
    this.offsetMs = null; this.unavailable = false;
    this.view = { ...this.view, phase: "idle", code: null, invite: null, members: 0, message };
    this.emit();
  }
}
