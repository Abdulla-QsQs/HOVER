import { expect, test } from "@playwright/test";
import QRCode from "qrcode";

test("the bundled camera decoder reads a real HOVER pairing QR", async ({ page }) => {
  const pairingUrl = "https://hover-reminder.pages.dev/?pair=ABC123&secret=fixture-secret";
  const qrDataUrl = await QRCode.toDataURL(pairingUrl, { margin: 1, width: 320 });
  await page.goto("/tests/qr-scanner-fixture.html");
  const decoded = await page.evaluate((source) => window.scanHoverQr(source), qrDataUrl);
  expect(decoded).toBe(pairingUrl);
  await expect(page.locator("#result")).toHaveText(pairingUrl);
});

test("production phone runtime is edge-to-edge and removes simulator chrome", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?runtime=native&screen=planner");

  const screen = page.getByTestId("device-screen");
  await expect(screen).toHaveAttribute("data-native-mobile", "true");
  await expect(page.getByTestId("phone-frame")).toHaveCount(0);
  await expect(page.getByTestId("device-picker")).toHaveCount(0);
  await expect(page.getByTestId("mobile-cursor")).toHaveCount(0);
  await expect(page.getByTestId("status-time")).toHaveCount(0);
  await expect(page.getByTestId("keyboard-dock")).toHaveCount(0);
  await expect(page.getByTestId("hover-planner")).toBeVisible();
  const todayHeading = await page.evaluate(() =>
    new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()),
  );
  await expect(page.getByRole("heading", { name: todayHeading })).toBeVisible();

  const box = await screen.boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 393, height: 852 });
  await expect(page.getByTestId("mobile-scroll")).toHaveAttribute("data-native-scroll", "true");
  expect(await page.getByTestId("mobile-scroll").evaluate((element) => getComputedStyle(element).touchAction)).toBe("pan-y");
  await expect(page.locator(".reminder-block")).toHaveCount(0);
  await expect(page.getByText("This day is clear")).toBeVisible();
  await expect(page.locator(".device-copy strong")).toHaveText("Your planner");
  await expect(page.locator(".device-copy span")).toContainText("iPhone · On device");
});

test("manual pairing submits from the phone keyboard and reaches notification setup", async ({ page }) => {
  await page.route("**/api/pair/inspect?code=ABC123", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: "ABC123", desktopName: "PRIVATE-HOSTNAME" }),
    });
  });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?runtime=native&screen=pair");
  await page.getByRole("button", { name: "Pair with desktop" }).click();
  const code = page.getByRole("textbox", { name: "Pairing code" });
  await code.fill("abc123");
  await expect(code).toHaveAttribute("enterkeyhint", "go");
  await code.press("Enter");
  await expect(page.getByRole("heading", { name: "Let HOVER reach you on time." })).toBeVisible();
  await expect(page.getByText("PRIVATE-HOSTNAME")).toHaveCount(0);
});

test("legacy sample reminders and their completion streak are removed", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hover-username", "realuser");
    localStorage.setItem("hover-reminders", JSON.stringify([
      { id: "morning-focus", title: "Morning focus", start: "08:15", end: "09:15", dateKey: "2026-08-21", color: "sky", top: 0, height: 48, alarm: true },
    ]));
    localStorage.setItem("hover-completed-history", JSON.stringify([
      { id: "morning-focus:2026-08-21", reminderId: "morning-focus", title: "Morning focus", start: "08:15", dateKey: "2026-08-21", color: "sky", completedAt: "2026-08-21T08:16:00.000Z", username: "realuser" },
    ]));
  });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?runtime=native&screen=planner");
  await expect(page.locator(".reminder-block")).toHaveCount(0);
  await expect(page.locator(".device-copy strong")).toHaveText("@realuser");
  await expect(page.locator(".device-copy span")).toContainText("iPhone · On device");
  await page.getByRole("button", { name: "Open profile and completed history" }).click();
  await expect(page.getByText("0", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No history yet")).toBeVisible();
});

test("the readable day timeline scrolls to late reminders and keeps completion usable", async ({ page }) => {
  await page.addInitScript(() => {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    localStorage.setItem("hover-username", "realuser");
    localStorage.setItem("hover-reminders", JSON.stringify([
      { id: "late-reminder", title: "Late reminder", start: "19:15", end: "19:45", dateKey, color: "coral", top: 0, height: 48, alarm: true },
    ]));
  });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?runtime=native&screen=planner");
  const scroll = page.getByTestId("mobile-scroll");
  const metrics = await scroll.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(metrics.scrollHeight - metrics.clientHeight).toBeGreaterThan(350);
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(350);
  const reminder = page.getByRole("button", { name: "Late reminder, tap to edit" });
  await expect(reminder).toBeVisible();
  expect(await reminder.evaluate((element) => getComputedStyle(element).touchAction)).toBe("pan-y");
  const drag = page.getByRole("button", { name: "Hold to move Late reminder" });
  expect(await drag.evaluate((element) => getComputedStyle(element).touchAction)).toBe("none");
  await page.getByRole("button", { name: "Mark Late reminder completed" }).click();
  await expect(page.locator(".reminder-block")).toHaveCount(0);
});

test("the current-time line advances while HOVER stays open", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-21T10:00:00") });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?runtime=native&screen=planner");
  const nowLine = page.getByTestId("now-line");
  await expect(nowLine).toBeVisible();
  const before = await nowLine.getAttribute("data-now");
  const beforeTop = await nowLine.evaluate((element) => element.style.top);
  await page.clock.runFor(2_000);
  const after = await nowLine.getAttribute("data-now");
  const afterTop = await nowLine.evaluate((element) => element.style.top);
  expect(after).not.toBe(before);
  expect(afterTop).not.toBe(beforeTop);
});

test("desktop QA runtime keeps the device preview available", async ({ page }) => {
  await page.goto("/?runtime=preview&screen=planner");
  await expect(page.getByTestId("phone-frame")).toBeVisible();
  await expect(page.getByTestId("device-picker")).toBeVisible();
  await expect(page.getByTestId("mobile-cursor")).toHaveCount(1);
});
