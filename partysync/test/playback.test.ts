import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { PlaybackResponse, PlaybackState, PlaybackUpdate, Room } from "../src/shared/protocol.ts";
import { GuestFollower, HostPublisher, type SyncPlayer } from "../src/sync/playback.ts";
import { applyPlayback, clockSample, expectedPosition, mergeRoom } from "../src/utils/playback.ts";

const snapshot = (changes: Partial<PlaybackState> = {}): PlaybackState => ({
  videoId: "dQw4w9WgXcQ", position: 20, playing: true,
  playbackRate: 1, updatedAt: 10000, sequence: 1, ...changes,
});

class Player implements SyncPlayer {
  position = 0;
  state = 5;
  rate = 1;
  duration = 300;
  blocked = false;
  seeks: number[] = [];
  plays = 0;
  pauses = 0;
  rates: number[] = [];
  availableRates = [0.5, 1, 1.5, 2];
  getCurrentTime() { return this.position; }
  getDuration() { return this.duration; }
  getPlayerState() { return this.state; }
  getPlaybackRate() { return this.rate; }
  getAvailablePlaybackRates() { return this.availableRates; }
  seekTo(seconds: number) { this.seeks.push(seconds); this.position = seconds; }
  playVideo() { this.plays++; if (!this.blocked) this.state = 1; }
  pauseVideo() { this.pauses++; this.state = 2; }
  setPlaybackRate(rate: number) { this.rates.push(rate); this.rate = rate; }
  addEventListener() {}
  removeEventListener() {}
}

function guestFixture(initial = snapshot()) {
  const player = new Player();
  let playback = initial;
  let time = 12000;
  let clockReady = true;
  let needsStart = true;
  let status = "";
  const follower = new GuestFollower({
    player, getPlayback: () => playback,
    serverNow: () => clockReady ? time : null,
    now: () => time, onStatus: (value) => { status = value; },
    onNeedsStart: (value) => { needsStart = value; },
  });
  return {
    player, follower,
    setPlayback: (value: PlaybackState) => { playback = value; },
    setTime: (value: number) => { time = value; },
    setClockReady: (value: boolean) => { clockReady = value; },
    get needsStart() { return needsStart; },
    get status() { return status; },
  };
}

test("clock samples account for skew and server processing time, and reject invalid replies", () => {
  const reply = { success: true as const, clientSentAt: 1000, serverReceivedAt: 1120, serverSentAt: 1130 };
  assert.deepEqual(clockSample(reply, 1000, 1050), { offsetMs: 100, roundTripMs: 40 });
  assert.equal(clockSample(reply, 999, 1050), null);
  assert.equal(clockSample(reply, 1000, 1005), null);
  assert.equal(clockSample({ success: false, message: "invalid" }, 1000, 1050), null);
  assert.deepEqual(clockSample({ ...reply, serverReceivedAt: 920, serverSentAt: 930 }, 1000, 1050), {
    offsetMs: -100, roundTripMs: 40,
  });
});

test("positions advance at host speed, stay fixed while paused, and clamp to valid duration", () => {
  assert.equal(expectedPosition(snapshot({ playbackRate: 1.5 }), 14000), 26);
  assert.equal(expectedPosition(snapshot({ playing: false }), 14000), 20);
  assert.equal(expectedPosition(snapshot(), 9000), 20);
  assert.equal(expectedPosition(snapshot(), 500000, 300), 300);
});

test("older room or playback events never rewind an accepted snapshot", () => {
  const room: Room = { code: "ABC123", hostId: "host", videoId: "dQw4w9WgXcQ", playback: snapshot({ sequence: 4 }), participants: [] };
  assert.equal(applyPlayback(room, snapshot({ sequence: 3 })), room);
  assert.equal(applyPlayback(null, snapshot()), null);
  const incoming = { ...room, playback: snapshot({ sequence: 2 }), participants: [{ id: "guest", name: "Guest", role: "guest" as const }] };
  assert.equal(mergeRoom(room, incoming).playback.sequence, 4);
  assert.equal(mergeRoom(room, incoming).participants.length, 1);
  assert.equal(applyPlayback(room, snapshot({ sequence: 5 }))?.playback.sequence, 5);
});

test("host serializes updates and samples fresh controls after an in-flight acknowledgement", async () => {
  const player = new Player();
  player.state = 1;
  const first = Promise.withResolvers<PlaybackResponse>();
  const sent: PlaybackUpdate[] = [];
  const host = new HostPublisher({
    player, playback: snapshot(), onPlayback: () => {}, onStatus: () => {},
    send: async (update) => {
      sent.push(update);
      return sent.length === 1 ? first.promise : { success: true, playback: { ...update, updatedAt: 12000 } };
    },
  });
  host.publish();
  player.position = 40;
  host.publish();
  player.position = 60;
  player.state = 2;
  host.publish();
  assert.equal(sent.length, 1);
  first.resolve({ success: true, playback: snapshot({ sequence: 2 }) });
  await setImmediate();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].sequence, 3);
  assert.equal(sent[1].position, 60);
  assert.equal(sent[1].playing, false);
  host.dispose();
});

test("host polling catches paused seeks and sends heartbeats without flooding steady playback", async () => {
  const player = new Player();
  player.state = 2;
  let now = 10000;
  const sent: PlaybackUpdate[] = [];
  const host = new HostPublisher({
    player, playback: snapshot(), now: () => now, onPlayback: () => {}, onStatus: () => {},
    send: async (update) => { sent.push(update); return { success: true, playback: { ...update, updatedAt: now } }; },
  });
  host.poll(); await setImmediate();
  now += 500; host.poll(); await setImmediate();
  assert.equal(sent.length, 1);
  player.position = 45;
  now += 500; host.poll(); await setImmediate();
  assert.equal(sent[1].position, 45);
  now += 2000; host.poll(); await setImmediate();
  assert.equal(sent.length, 3);
  host.dispose(); host.publish();
  assert.equal(sent.length, 3);
});

test("host recovers from uncertain acknowledgements using the returned sequence and a new sample", async () => {
  const player = new Player();
  player.state = 1;
  const sent: PlaybackUpdate[] = [];
  const accepted: PlaybackState[] = [];
  const host = new HostPublisher({
    player, playback: snapshot(), onPlayback: (state) => accepted.push(state), onStatus: () => {},
    send: async (update) => {
      sent.push(update);
      if (sent.length === 1) throw new Error("ack lost");
      if (sent.length === 2) return { success: false, message: "stale", playback: snapshot({ sequence: 7 }) };
      return { success: true, playback: { ...update, updatedAt: 12000 } };
    },
  });
  host.publish(); await setImmediate();
  host.publish(); await setImmediate();
  player.position = 80;
  host.accept(snapshot({ sequence: 2 }));
  host.publish(); await setImmediate();
  assert.equal(sent[2].sequence, 8);
  assert.equal(sent[2].position, 80);
  assert.equal(accepted.at(-1)?.sequence, 8);
});

test("disposed host ignores late acknowledgements and stops sampling a changed video", async () => {
  const player = new Player(); player.state = 1;
  const response = Promise.withResolvers<PlaybackResponse>();
  let accepted = 0;
  const host = new HostPublisher({ player, playback: snapshot(), send: () => response.promise,
    onPlayback: () => { accepted++; }, onStatus: () => {} });
  host.publish(); host.dispose();
  response.resolve({ success: true, playback: snapshot({ sequence: 2 }) });
  await setImmediate();
  assert.equal(accepted, 0);
  let sent = 0;
  const other = new HostPublisher({ player, playback: snapshot(), send: async () => { sent++; throw new Error(); },
    onPlayback: () => {}, onStatus: () => {} });
  other.accept(snapshot({ sequence: 3, videoId: "aqz-KE-bpKQ" }));
  other.publish();
  assert.equal(sent, 0);
});

test("guests wait for a click, then join at the projected time and follow host speed", () => {
  const f = guestFixture(snapshot({ playbackRate: 1.5 }));
  f.follower.sync();
  assert.equal(f.player.plays, 0);
  assert.deepEqual(f.player.seeks, []);
  f.follower.start();
  assert.equal(f.needsStart, false);
  assert.equal(f.player.position, 23);
  assert.equal(f.player.rate, 1.5);
  assert.equal(f.player.state, 1);
});

test("small drift is tolerated; large drift is corrected with a cooldown and manual override", () => {
  const f = guestFixture(); f.follower.start();
  f.player.position = 21.8; f.follower.sync();
  assert.equal(f.player.seeks.length, 1);
  f.player.position = 10; f.follower.sync();
  assert.equal(f.player.seeks.length, 1);
  f.setTime(15000); f.follower.sync();
  assert.equal(f.player.position, 25);
  assert.equal(f.player.seeks.length, 2);
  f.player.position = 2; f.follower.start();
  assert.equal(f.player.position, 25);
  assert.equal(f.player.seeks.length, 3);
});

test("host seeks and pauses take effect immediately, including during correction cooldown", () => {
  const f = guestFixture(); f.follower.start();
  f.setPlayback(snapshot({ position: 90, playing: false, updatedAt: 12000, sequence: 2 }));
  f.follower.sync();
  assert.equal(f.player.position, 90);
  assert.equal(f.player.state, 2);
  f.setPlayback(snapshot({ position: 90, playbackRate: 2, updatedAt: 12000, sequence: 3 }));
  f.follower.sync();
  assert.equal(f.player.state, 1);
  assert.equal(f.player.rate, 2);
});

test("buffering does not trigger seek loops and catches up after recovery", () => {
  const f = guestFixture(); f.follower.start();
  f.player.state = 3; f.player.position = 1; f.setTime(20000);
  f.follower.sync(); f.follower.sync();
  assert.equal(f.player.seeks.length, 1);
  assert.match(f.status, /Buffering/);
  f.player.state = 1; f.follower.sync();
  assert.equal(f.player.position, 30);
});

test("autoplay denial and missing clocks require another user gesture; disposal stops playback commands", () => {
  const f = guestFixture(); f.player.blocked = true;
  f.follower.start(); f.setTime(16000); f.follower.sync();
  assert.equal(f.needsStart, true);
  assert.match(f.status, /browser paused/);
  assert.equal(f.player.plays, 1);
  f.player.blocked = false; f.follower.start();
  assert.equal(f.player.state, 1);
  f.follower.autoplayBlocked();
  assert.equal(f.needsStart, true);
  f.setClockReady(false); f.follower.start();
  assert.equal(f.needsStart, true);
  f.follower.dispose(); const seeks = f.player.seeks.length;
  f.setClockReady(true); f.follower.start();
  assert.equal(f.player.seeks.length, seeks);
});

test("ended videos stay within duration and a paused host does not start guest audio", () => {
  const f = guestFixture(snapshot({ playing: false }));
  f.follower.start();
  assert.equal(f.player.state, 2);
  assert.equal(f.player.plays, 0);
  f.setPlayback(snapshot({ sequence: 2, position: 299 }));
  f.setTime(20000); f.follower.sync();
  assert.equal(f.player.position, 300);
  assert.equal(f.player.plays, 0);
  assert.match(f.status, /ended/);
});

test("host speed is applied when YouTube makes it available after loading", () => {
  const f = guestFixture(snapshot({ playbackRate: 1.5 }));
  f.player.availableRates = [1];
  f.follower.start(); f.follower.sync();
  assert.equal(f.player.rate, 1);
  assert.match(f.status, /does not support/);
  f.player.availableRates = [1, 1.5];
  f.follower.sync();
  assert.equal(f.player.rate, 1.5);
  assert.deepEqual(f.player.rates, [1.5]);
});
