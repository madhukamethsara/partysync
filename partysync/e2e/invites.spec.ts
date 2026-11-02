import { expect, test } from "@playwright/test";

test("room invites copy links and codes, support manual copying, and prefill joining", async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } },
    });
  });
  await page.goto("/?unrelated=value#old");
  await page.getByLabel("Your Name").fill("Host");
  await page.getByRole("button", { name: "Create Party" }).click();
  const code = (await page.locator(".room-code").innerText()).trim();
  const link = await page.getByLabel("Invite link", { exact: true }).inputValue();
  expect(new URL(link).search).toBe(`?room=${code}`);
  expect(new URL(link).hash).toBe("");
  await page.getByRole("button", { name: "Copy Invite Link" }).click();
  await expect(page.getByRole("status")).toHaveText("Invite link copied!");
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(link);
  await page.getByRole("button", { name: "Copy Room Code" }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(code);
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: undefined }); });
  await page.getByRole("button", { name: "Copy Invite Link" }).click();
  await expect(page.getByRole("alert")).toContainText("Select and copy the invite link below");
  await page.getByLabel("Invite link", { exact: true }).focus();
  expect(await page.getByLabel("Invite link", { exact: true }).evaluate((input: HTMLInputElement) =>
    input.value.substring(input.selectionStart ?? 0, input.selectionEnd ?? 0))).toBe(link);
  const guest = await context.newPage();
  await guest.goto(link);
  await expect(guest.getByLabel("Room code", { exact: true })).toHaveValue(code);
  await guest.getByLabel("Your Name").fill("Guest");
  await guest.getByRole("button", { name: "Join Party" }).click();
  await expect(guest.locator(".room-code")).toHaveText(code);
  await expect(page.getByText("Party Members (2)")).toBeVisible();
});
