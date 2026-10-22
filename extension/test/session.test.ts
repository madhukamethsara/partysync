import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { io } from "socket.io-client";
import { createPartySyncServer } from "../../server/app.js";
import { HostSession } from "../src/session.ts";
import type { HostView, VideoSample } from "../src/messages.ts";

const sample = (changes: Partial<VideoSample> = {}): VideoSample => ({
  videoId: "dQw4w9WgXcQ", position: 45, playbackRate: 1, playing: true,
  buffering: false, adShowing: false, capturedAt: Date.now(), ...changes,
});

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for host state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("extension sessions share native video time, switch songs, pause ads, and close guests", async (t) => {
  const server = createPartySyncServer();
  server.httpServer.listen(0, "127.0.0.1");
  await once(server.httpServer, "listening");
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  const backendUrl = `http://127.0.0.1:${address.port}`;
  let view: HostView | null = null;
  const session = new HostSession({ backendUrl, frontendUrl: "https://partysync-seven.vercel.app" }, (value) => { view = value; });
  const guest = io(backendUrl, { autoConnect: false, reconnection: false });
  t.after(async () => {
    session.dispose(); guest.disconnect();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });
  await session.start("Host", sample());
  assert.equal(session.active, true);
  const connected = new Promise<void>((resolve) => guest.once("connect", () => resolve())); guest.connect(); await connected;
  const joined = await guest.timeout(2000).emitWithAck("room:join", { name: "Guest", code: view!.code });
  assert.equal(joined.success, true);
  assert.equal(joined.room.playback.playing, true);
  assert.ok(joined.room.playback.position >= 45);
  assert.equal(new URL(view!.invite!).searchParams.get("room"), view!.code);
  await waitFor(() => view?.members === 2);

  let playback = joined.room.playback;
  guest.on("playback:updated", (value) => { playback = value; });
  session.update(sample({ position: 90, playing: false }), true);
  await waitFor(() => !playback.playing && playback.position === 90);
  session.update(sample({ videoId: "aqz-KE-bpKQ", position: 120, playbackRate: 1.5 }), true);
  await waitFor(() => playback.videoId === "aqz-KE-bpKQ" && playback.position >= 120 && playback.playbackRate === 1.5);
  session.update(sample({ videoId: "aqz-KE-bpKQ", position: 3, adShowing: true }), true);
  await waitFor(() => !playback.playing);
  assert.ok(playback.position >= 120, "An ad's own position must not replace the song position");
  session.update(sample({ videoId: "aqz-KE-bpKQ", position: 125 }), true);
  await waitFor(() => playback.playing && playback.position >= 125);
  session.update(null, true);
  await waitFor(() => !playback.playing);
  const closed = new Promise<void>((resolve) => guest.once("room:closed", () => resolve()));
  session.end();
  await closed;
  assert.equal(session.active, false);
  assert.equal(view!.code, null);
});

test("invalid host names and starting during an ad do not create rooms", async () => {
  let message = "";
  const session = new HostSession({ backendUrl: "http://127.0.0.1:1", frontendUrl: "https://example.com" }, (view) => { message = view.message; });
  await session.start(" ", sample());
  assert.equal(session.active, false);
  assert.match(message, /Enter a name/);
  await session.start("Host", sample({ adShowing: true }));
  assert.equal(session.active, false);
  assert.match(message, /ad to finish/);
  session.dispose();
});
