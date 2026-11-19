import { test, expect } from "@playwright/test";

test.describe("Offline Chapter Downloads", () => {
  test("downloads page renders empty state and works offline after initial online visit", async ({ page, context }) => {
    await page.goto("/downloads");
    await expect(page.getByRole("heading", { name: "Downloads" })).toBeVisible();
    await expect(page.getByText("No offline chapters yet")).toBeVisible();

    // Wait for service worker registration
    await page.waitForFunction(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg.active);
    });

    await context.setOffline(true);
    const freshPage = await context.newPage();
    await freshPage.goto("/downloads");
    await expect(freshPage.getByRole("heading", { name: "Downloads" })).toBeVisible();
    await freshPage.close();
  });
});
