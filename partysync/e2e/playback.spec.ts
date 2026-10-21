import { expect, test, type Page } from "@playwright/test";
import { installMockYouTube } from "./mock-youtube";

async function createParty(page: Page) {
  await page.goto("/");
  await page.getByLabel("Your Name").fill("Host");
  await page.getByRole("button", { name: "Create Party" }).click();
  const code = await page.locator(".room-code").innerText();
  await page.getByLabel("YouTube karaoke URL").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Share Song" }).click();
  await expect(page.getByText("Use the video controls to lead the party.")).toBeVisible();
  return code.trim();
}

async function joinParty(page: Page, code: string) {
  await page.goto("/");
  await page.getByLabel("Your Name").fill("Guest");
  await page.getByLabel("Room code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Join Party" }).click();
  await expect(page.getByRole("button", { name: "Join & Start" })).toBeEnabled();
}

test("a mobile guest with clock skew joins late and follows play, pause, seeks, speed, and song changes", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext({ baseURL });
  const guestContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await hostContext.addInitScript(installMockYouTube);
  await guestContext.addInitScript(installMockYouTube);
  await guestContext.addInitScript(() => {
    const actualNow = Date.now.bind(Date);
    Date.now = () => actualNow() + 8000;
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  host.on("pageerror", (error) => errors.push(error.message));
  guest.on("pageerror", (error) => errors.push(error.message));
  try {
    const code = await createParty(host);
    await host.evaluate(() => { window.mockYouTube.seekTo(60, true); window.mockYouTube.playVideo(); });
    await expect(host.getByText("Host controls are live. Everyone follows your player.")).toBeVisible();
    await joinParty(guest, code);
    expect(await guest.evaluate(() => window.mockYouTube.getPlayerState())).toBe(5);
    await guest.getByRole("button", { name: "Join & Start" }).click();
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getPlayerState())).toBe(1);
    const hostPosition = await host.evaluate(() => window.mockYouTube.getCurrentTime());
    const guestPosition = await guest.evaluate(() => window.mockYouTube.getCurrentTime());
    expect(Math.abs(hostPosition - guestPosition)).toBeLessThan(1);

    await host.evaluate(() => window.mockYouTube.pauseVideo());
    await expect(guest.getByText("Paused by the host.")).toBeVisible();
    await host.evaluate(() => window.mockYouTube.seekTo(120, true));
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getCurrentTime())).toBeCloseTo(120, 0);
    await host.evaluate(() => { window.mockYouTube.setPlaybackRate(1.5); window.mockYouTube.playVideo(); });
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getPlaybackRate())).toBe(1.5);
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getPlayerState())).toBe(1);

    await guest.evaluate(() => window.mockYouTube.seekTo(10, true));
    await guest.getByRole("button", { name: "Sync now" }).click();
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getCurrentTime())).toBeGreaterThan(120);
    // Selecting the same song restarts the host and resets an already following guest.
    await host.getByLabel("YouTube karaoke URL").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await host.getByRole("button", { name: "Share Song" }).click();
    await expect.poll(() => host.evaluate(() => window.mockYouTube.getCurrentTime())).toBe(0);
    await expect(guest.getByText("Paused by the host.")).toBeVisible();
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.getCurrentTime())).toBe(0);
    await host.getByLabel("YouTube karaoke URL").fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    await host.getByRole("button", { name: "Share Song" }).click();
    await expect.poll(() => guest.evaluate(() => window.mockYouTube.videoId)).toBe("aqz-KE-bpKQ");
    await expect(guest.getByRole("button", { name: "Join & Start" })).toBeEnabled();
    await host.getByRole("button", { name: "End Party" }).click();
    await expect(guest.getByText("The host ended the party.")).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await hostContext.close(); await guestContext.close(); }
});

test("blocked playback can be retried, buffering recovers, and unavailable videos show an error", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(installMockYouTube);
  const host = await context.newPage();
  const guest = await context.newPage();
  try {
    const code = await createParty(host);
    await host.evaluate(() => window.mockYouTube.playVideo());
    await joinParty(guest, code);
    await guest.evaluate(() => { window.mockYouTube.blockPlayback = true; });
    await guest.getByRole("button", { name: "Join & Start" }).click();
    await expect(guest.getByText("Your browser paused playback. Tap Join & Start to continue.")).toBeVisible();
    await expect(guest.getByRole("button", { name: "Join & Start" })).toBeEnabled();
    await guest.evaluate(() => { window.mockYouTube.blockPlayback = false; });
    await guest.getByRole("button", { name: "Join & Start" }).click();
    await expect(guest.getByText("Following the host.")).toBeVisible();
    await host.evaluate(() => window.mockYouTube.buffer());
    await expect(guest.getByText("Paused by the host.")).toBeVisible();
    await host.evaluate(() => window.mockYouTube.playVideo());
    await expect(guest.getByText("Following the host.")).toBeVisible();
    await guest.evaluate(() => window.mockYouTube.error(150));
    await expect(guest.getByRole("alert")).toContainText("YouTube cannot play this video here.");
  } finally { await context.close(); }
});

test("400 ms of host uplink delay does not leave a late guest behind", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext({ baseURL });
  const guestContext = await browser.newContext({ baseURL });
  await hostContext.addInitScript(installMockYouTube);
  await guestContext.addInitScript(installMockYouTube);
  await hostContext.addInitScript(() => {
    const originalSend = WebSocket.prototype.send;
    window.delayedPlaybackPackets = 0;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.includes('"playback:update"')) {
        window.delayedPlaybackPackets++;
        setTimeout(() => { if (this.readyState === WebSocket.OPEN) originalSend.call(this, data); }, 400);
      } else originalSend.call(this, data);
    };
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    const code = await createParty(host);
    await host.evaluate(() => {
      window.mockYouTube.seekTo(60, true);
      window.mockYouTube.setPlaybackRate(1.5);
      window.mockYouTube.playVideo();
    });
    await expect.poll(() => host.evaluate(() => window.delayedPlaybackPackets)).toBeGreaterThan(0);
    await expect(host.getByText("Host controls are live. Everyone follows your player.")).toBeVisible();
    await joinParty(guest, code);
    await guest.getByRole("button", { name: "Join & Start" }).click();
    await expect.poll(async () => {
      const [hostTime, guestTime] = await Promise.all([
        host.evaluate(() => window.mockYouTube.getCurrentTime()),
        guest.evaluate(() => window.mockYouTube.getCurrentTime()),
      ]);
      return Math.abs(hostTime - guestTime);
    }).toBeLessThan(0.2);
  } finally { await hostContext.close(); await guestContext.close(); }
});
