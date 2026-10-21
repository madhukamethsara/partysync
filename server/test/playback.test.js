import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { io as connect } from "socket.io-client";
import { createPartySyncServer } from "../app.js";

const VIDEO = "dQw4w9WgXcQ";
const OTHER_VIDEO = "aqz-KE-bpKQ";
const ack = (socket, event, data) => socket.timeout(2000).emitWithAck(event, data);
const nextEvent = (socket, event) => once(socket, event, { signal: AbortSignal.timeout(3000) });

async function fixture(t) {
  let time = 1_800_000_000_000;
  const server = createPartySyncServer({ now: () => time });
  const clients = [];
  t.after(async () => {
    clients.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => server.io.close(resolve));
  });
  server.httpServer.listen(0, "127.0.0.1");
  await once(server.httpServer, "listening");
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  async function client() {
    const socket = connect(url, { autoConnect: false, reconnection: false });
    clients.push(socket);
    const connected = nextEvent(socket, "connect");
    socket.connect();
    await connected;
    return socket;
  }
  const host = await client();
  const created = await ack(host, "room:create", { name: "Host" });
  assert.equal(created.success, true);
  return {
    host, client, room: created.room, url,
    setTime: (value) => { time = value; },
    async select() {
      assert.deepEqual(await ack(host, "video:change", { videoId: VIDEO }), { success: true });
    },
    async join() {
      const guest = await client();
      const response = await ack(guest, "room:join", { code: created.room.code, name: "Guest" });
      assert.equal(response.success, true);
      return { guest, room: response.room };
    },
  };
}

const sample = (overrides = {}) => ({
  videoId: VIDEO, position: 42.5, playing: true, playbackRate: 1.25, sequence: 2,
  ...overrides,
});

test("new rooms expose an idle playback snapshot and health remains available", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.room.playback, {
    videoId: null, position: 0, playing: false, playbackRate: 1,
    updatedAt: 1_800_000_000_000, sequence: 0,
  });
  const health = await fetch(`${f.url}/api/health`).then((res) => res.json());
  assert.equal(health.activeRooms, 1);
});

test("host updates reach host and guests with authoritative timestamps; late joins get latest state", async (t) => {
  const f = await fixture(t);
  await f.select();
  const { guest } = await f.join();
  f.setTime(1_800_000_000_500);
  const hostUpdate = nextEvent(f.host, "playback:updated");
  const guestUpdate = nextEvent(guest, "playback:updated");
  const result = await ack(f.host, "playback:update", {
    ...sample(), updatedAt: 1, hostId: guest.id,
  });
  assert.equal(result.success, true);
  const expected = { ...sample(), updatedAt: 1_800_000_000_500 };
  assert.deepEqual(result.playback, expected);
  assert.deepEqual((await hostUpdate)[0], expected);
  assert.deepEqual((await guestUpdate)[0], expected);
  f.setTime(1_800_000_010_500);
  const late = await f.join();
  assert.deepEqual(late.room.playback, expected);
  assert.equal(late.room.videoId, expected.videoId);
});

test("pause, seek, and rate changes persist; changing songs resets position and advances sequence", async (t) => {
  const f = await fixture(t);
  await f.select();
  for (const update of [sample(), sample({ position: 12, playing: false, playbackRate: 0.5, sequence: 3 })]) {
    const result = await ack(f.host, "playback:update", update);
    assert.equal(result.success, true);
    assert.deepEqual(result.playback, { ...update, updatedAt: 1_800_000_000_000 });
  }
  const updated = nextEvent(f.host, "playback:updated");
  const roomUpdated = nextEvent(f.host, "room:updated");
  await ack(f.host, "video:change", { videoId: OTHER_VIDEO });
  const expected = {
    videoId: OTHER_VIDEO, position: 0, playing: false, playbackRate: 1,
    updatedAt: 1_800_000_000_000, sequence: 4,
  };
  assert.deepEqual((await updated)[0], expected);
  const [room] = await roomUpdated;
  assert.deepEqual(room.playback, expected);
  assert.equal(room.videoId, OTHER_VIDEO);
});

test("guests, outsiders, and hosts in other rooms cannot change this room's playback", async (t) => {
  const f = await fixture(t);
  await f.select();
  const { guest, room: initial } = await f.join();
  const outsider = await f.client();
  assert.equal((await ack(guest, "playback:update", sample())).success, false);
  assert.equal((await ack(guest, "video:change", { videoId: OTHER_VIDEO })).success, false);
  assert.equal((await ack(outsider, "playback:update", sample())).success, false);
  await ack(outsider, "room:create", { name: "Other Host" });
  assert.equal((await ack(outsider, "playback:update", sample({ code: f.room.code }))).success, false);
  assert.deepEqual((await f.join()).room.playback, initial.playback);
});

test("invalid payloads leave playback unchanged and cannot crash the server", async (t) => {
  const f = await fixture(t);
  await f.select();
  const { room: initial } = await f.join();
  const invalid = [
    null, [], "play", {}, sample({ videoId: "bad" }),
    sample({ position: -1 }), sample({ position: "42" }),
    sample({ position: Infinity }), sample({ position: NaN }),
    sample({ playing: 1 }), sample({ playbackRate: 0 }),
    sample({ playbackRate: 2.1 }), sample({ playbackRate: "1" }),
    sample({ sequence: 0 }), sample({ sequence: 1.5 }),
    sample({ sequence: Number.MAX_SAFE_INTEGER + 1 }),
    sample({ sampledAt: null }), sample({ sampledAt: "1234" }),
    sample({ sampledAt: -1 }), sample({ sampledAt: Infinity }),
  ];
  for (const data of invalid) {
    assert.equal((await ack(f.host, "playback:update", data)).success, false, JSON.stringify(data));
  }
  assert.deepEqual((await f.join()).room.playback, initial.playback);
  assert.equal((await ack(f.host, "playback:update", sample())).success, true);
});

test("duplicate, skipped, and previous-video updates return current state without mutation", async (t) => {
  const f = await fixture(t);
  await f.select();
  const accepted = await ack(f.host, "playback:update", sample());
  for (const data of [sample(), sample({ sequence: 1 }), sample({ sequence: 4 }), sample({ videoId: OTHER_VIDEO, sequence: 3 })]) {
    const rejected = await ack(f.host, "playback:update", data);
    assert.equal(rejected.success, false);
    assert.deepEqual(rejected.playback, accepted.playback);
  }
  assert.deepEqual((await f.join()).room.playback, accepted.playback);
});

test("playback requires a selected video; unacknowledged updates do not mutate state", async (t) => {
  const f = await fixture(t);
  assert.equal((await ack(f.host, "playback:update", sample({ sequence: 1 }))).success, false);
  await f.select();
  f.host.emit("playback:update", sample());
  f.host.emit("clock:sync", { clientSentAt: 1 });
  await ack(f.host, "clock:sync", { clientSentAt: 1 });
  assert.equal((await f.join()).room.playback.sequence, 1);
});

test("clock sync works before joining, echoes client time, and rejects malformed timestamps", async (t) => {
  const f = await fixture(t);
  const outsider = await f.client();
  f.setTime(1_800_000_000_200);
  assert.deepEqual(await ack(outsider, "clock:sync", { clientSentAt: 1234 }), {
    success: true, clientSentAt: 1234,
    serverReceivedAt: 1_800_000_000_200, serverSentAt: 1_800_000_000_200,
  });
  for (const data of [null, {}, { clientSentAt: -1 }, { clientSentAt: "1234" }, { clientSentAt: Infinity }]) {
    assert.equal((await ack(outsider, "clock:sync", data)).success, false);
  }
});

test("playback broadcasts stay in their room and rejected updates emit nothing", async (t) => {
  const f = await fixture(t);
  await f.select();
  const { guest } = await f.join();
  const otherHost = await f.client();
  await ack(otherHost, "room:create", { name: "Other Host" });
  const guestEvents = [];
  const otherEvents = [];
  guest.on("playback:updated", (state) => guestEvents.push(state));
  otherHost.on("playback:updated", (state) => otherEvents.push(state));

  const accepted = await ack(f.host, "playback:update", sample());
  await ack(guest, "clock:sync", { clientSentAt: 1 });
  await ack(otherHost, "clock:sync", { clientSentAt: 1 });
  assert.deepEqual(guestEvents, [accepted.playback]);
  assert.deepEqual(otherEvents, []);

  await ack(f.host, "playback:update", sample());
  await ack(guest, "playback:update", sample({ sequence: 3 }));
  await ack(guest, "clock:sync", { clientSentAt: 1 });
  assert.deepEqual(guestEvents, [accepted.playback]);
});

test("timestamped samples compensate host uplink delay and preserve that position for late joins", async (t) => {
  const f = await fixture(t);
  await f.select();
  const sampledAt = 1_800_000_000_000;
  f.setTime(sampledAt + 400);
  const result = await ack(f.host, "playback:update", sample({
    position: 30, playbackRate: 1.5, sampledAt,
  }));
  assert.equal(result.success, true);
  assert.equal(result.playback.position, 30.6);
  assert.equal(result.playback.updatedAt, sampledAt + 400);
  f.setTime(sampledAt + 900);
  const late = await f.join();
  assert.deepEqual(late.room.playback, result.playback);
  // At guest receipt the projected position matches 900 ms of host playback.
  const guestPosition = late.room.playback.position + 0.5 * late.room.playback.playbackRate;
  assert.equal(guestPosition, 31.35);
});

test("timestamp compensation is bounded, never rewinds, and never advances paused samples", async (t) => {
  const f = await fixture(t);
  await f.select();
  const receivedAt = 1_800_000_001_000;
  f.setTime(receivedAt);
  let sequence = 2;
  for (const offset of [-10000, -2001, -2000, -400, 0, 100, 250, 251, 10000]) {
    const result = await ack(f.host, "playback:update", sample({ sequence: sequence++, sampledAt: receivedAt + offset }));
    assert.equal(result.success, true);
    const expected = offset >= -2000 && offset < 0 ? 42.5 - offset / 1000 * 1.25 : 42.5;
    assert.equal(result.playback.position, expected, `offset ${offset}`);
    assert.equal(result.playback.updatedAt, receivedAt);
  }
  const paused = await ack(f.host, "playback:update", sample({
    sequence, sampledAt: receivedAt - 1000, playing: false,
  }));
  assert.equal(paused.success, true);
  assert.equal(paused.playback.position, 42.5);
});
