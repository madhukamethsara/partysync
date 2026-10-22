import { expect, test, chromium, type CDPSession } from "@playwright/test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installMockYouTube } from "../../partysync/e2e/mock-youtube.ts";

/** Native video fields live in the extension's isolated world for this fixture. */
function simulateNativeVideo() {
  const video = document.querySelector("video")!;
  let position = 60;
  let playing = true;
  let rate = 1;
  let at = performance.now();
  const current = () => position + (playing ? (performance.now() - at) / 1000 * rate : 0);
  const freeze = () => { position = current(); at = performance.now(); };
  Object.defineProperties(video, {
    readyState: { get: () => 4 }, paused: { get: () => !playing }, ended: { get: () => false },
    currentTime: { get: current }, playbackRate: { get: () => rate },
  });
  Object.assign(globalThis, { testNative: {
    pause: () => { freeze(); playing = false; video.dispatchEvent(new Event("pause")); },
    play: () => { at = performance.now(); playing = true; video.dispatchEvent(new Event("play")); },
    seek: (value: number) => { position = value; at = performance.now(); video.dispatchEvent(new Event("seeked")); },
    rate: (value: number) => { freeze(); rate = value; video.dispatchEvent(new Event("ratechange")); },
  } });
}

async function inWorld(cdp: CDPSession, contextId: number, expression: string) {
  const result = await cdp.send("Runtime.evaluate", { expression, contextId, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

test("an installed extension hosts YouTube, shares controls with a mobile guest, survives navigation, and ends the room", async () => {
  const extensionPath = await mkdtemp(path.join(tmpdir(), "partysync-extension-test-"));
  await cp(fileURLToPath(new URL("../dist/", import.meta.url)), extensionPath, { recursive: true });
  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Only the temporary test build pregrants access to the local test server.
  manifest.host_permissions.push("http://127.0.0.1/*");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext("", {
    channel: process.env.PLAYWRIGHT_CHANNEL || "chromium", headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  });
  try {
    const browserCdp = await context.browser()!.newBrowserCDPSession();
    const installed = await browserCdp.send("Extensions.loadUnpacked", { path: extensionPath });
    const extensionId = installed.id;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByLabel("PartySync website URL").fill("http://127.0.0.1:5179");
    await options.getByLabel("PartySync backend URL").fill("http://127.0.0.1:3009");
    await options.getByRole("button", { name: "Save settings" }).click();
    await expect(options.getByRole("status")).toContainText("Settings saved");

    const host = await context.newPage();
    await host.route("https://www.youtube.com/**", (route) => route.fulfill({
      contentType: "text/html", body: `<html><body><ytd-watch-flexy video-id="dQw4w9WgXcQ">
      <div id="movie_player"><video class="html5-main-video"></video></div>
      <ytd-watch-metadata><div id="title">Test karaoke video</div></ytd-watch-metadata>
      </ytd-watch-flexy></body></html>`,
    }));
    const cdp = await context.newCDPSession(host);
    let world = 0;
    cdp.on("Runtime.executionContextCreated", ({ context: execution }) => {
      if (execution.origin === `chrome-extension://${extensionId}` || execution.name === extensionId
        || execution.name === "PartySync for YouTube") world = execution.id;
    });
    await cdp.send("Runtime.enable");
    await host.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await expect(host.getByRole("button", { name: "Host with PartySync" })).toBeVisible();
    await expect.poll(() => world).toBeGreaterThan(0);
    await inWorld(cdp, world, `(${simulateNativeVideo.toString()})()`);
    await host.getByRole("button", { name: "Host with PartySync" }).click();
    await host.getByLabel("Your name", { exact: true }).fill("YouTube Host");
    await host.getByRole("button", { name: "Start party" }).click();
    await expect(host.locator("#code")).toHaveText(/^[A-F0-9]{6}$/);
    const invite = await host.getByLabel("Invite link", { exact: true }).inputValue();
    expect(new URL(invite).origin).toBe("http://127.0.0.1:5179");
    await expect(host.locator("#status")).toContainText("Host controls are live");

    const guest = await context.newPage();
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.addInitScript(installMockYouTube);
    await guest.goto(invite);
    await expect(guest.getByLabel("Room code", { exact: true })).toHaveValue(new URL(invite).searchParams.get("room")!);
    await guest.getByLabel("Your Name").fill("Mobile Guest");
    await guest.getByRole("button", { name: "Join Party" }).click();
    await guest.getByRole("button", { name: "Join & Start" }).click();
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getCurrentTime())).toBeGreaterThan(60);
    await expect(host.locator("#members")).toHaveText("2 members in the party");

    // Closing the panel must not end the party or interrupt the worker connection.
    await host.getByRole("button", { name: /^PartySync ·/ }).click();
    await inWorld(cdp, world, "testNative.pause()");
    await expect(guest.getByText("Paused by the host.")).toBeVisible();
    await inWorld(cdp, world, "testNative.seek(120)");
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getCurrentTime())).toBe(120);
    await inWorld(cdp, world, "testNative.rate(1.5); testNative.play()");
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getPlaybackRate())).toBe(1.5);
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getPlayerState())).toBe(1);

    await host.evaluate(() => document.getElementById("movie_player")!.classList.add("ad-showing"));
    await expect(guest.getByText("Paused by the host.")).toBeVisible();
    await host.evaluate(() => document.getElementById("movie_player")!.classList.remove("ad-showing"));
    await expect(guest.getByText("Following the host.")).toBeVisible();
    await host.evaluate(() => {
      document.dispatchEvent(new Event("yt-navigate-start"));
      history.pushState(null, "", "/watch?v=aqz-KE-bpKQ");
      document.querySelector("ytd-watch-flexy")!.setAttribute("video-id", "aqz-KE-bpKQ");
      const replacement = document.createElement("video");
      replacement.className = "html5-main-video";
      document.querySelector("video")!.replaceWith(replacement);
      document.dispatchEvent(new Event("yt-navigate-finish"));
    });
    await inWorld(cdp, world, `(${simulateNativeVideo.toString()})()`);
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.videoId)).toBe("aqz-KE-bpKQ");
    expect(await host.locator("#partysync-extension-root").count()).toBe(1);
    await host.getByRole("button", { name: /^PartySync ·/ }).click();
    await host.getByRole("button", { name: "End party" }).click();
    await expect(guest.getByText("The host ended the party.")).toBeVisible();
    await expect(host.getByRole("button", { name: "Start party" })).toBeVisible();
    // A second party on the same tab must work, and closing that tab ends it.
    await host.getByRole("button", { name: "Start party" }).click();
    await expect(host.locator("#code")).toHaveText(/^[A-F0-9]{6}$/);
    const nextInvite = await host.getByLabel("Invite link", { exact: true }).inputValue();
    await guest.goto(nextInvite);
    await guest.getByLabel("Your Name").fill("Returning Guest");
    await guest.getByRole("button", { name: "Join Party" }).click();
    await expect(guest.getByRole("button", { name: "Join & Start" })).toBeEnabled();
    await host.close();
    await expect(guest.getByText("The host ended the party.")).toBeVisible();
  } finally { await context.close(); }
});
