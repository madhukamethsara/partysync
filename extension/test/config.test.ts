import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, backendPermission, inviteUrl, normalizeUrl, parseSettings } from "../src/config.ts";
import { validSample } from "../src/messages.ts";
import { watchVideoId } from "../src/youtube.ts";

test("settings use the working frontend and validate backend origins", () => {
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
  assert.equal(normalizeUrl("https://partysync-seven.vercel.app/"), "https://partysync-seven.vercel.app");
  assert.equal(normalizeUrl("http://localhost:3008/", true), "http://localhost:3008");
  for (const value of ["javascript:alert(1)", "http://example.com", "https://user:password@example.com", "https://example.com?token=1"]) {
    assert.throws(() => normalizeUrl(value));
  }
  assert.throws(() => normalizeUrl("https://example.com/api", true));
  assert.equal(backendPermission("https://partysync.onrender.com"), "https://partysync.onrender.com/*");
});

test("invite links preserve website paths and encode only validated room codes", () => {
  assert.equal(inviteUrl("https://example.com/party", "ABC123"), "https://example.com/party?room=ABC123");
  assert.throws(() => inviteUrl("https://example.com", "../oops"));
});

test("only supported YouTube watch URLs and finite native playback samples are accepted", () => {
  assert.equal(watchVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(watchVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), null);
  assert.equal(watchVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  const sample = { videoId: "dQw4w9WgXcQ", position: 45, playing: true, buffering: false,
    adShowing: false, playbackRate: 1, capturedAt: Date.now() };
  assert.equal(validSample(sample), true);
  for (const invalid of [null, {}, { ...sample, position: NaN }, { ...sample, playbackRate: 4 },
    { ...sample, videoId: "bad" }, { ...sample, adShowing: 1 }, { ...sample, capturedAt: Infinity }]) {
    assert.equal(validSample(invalid), false);
  }
});
