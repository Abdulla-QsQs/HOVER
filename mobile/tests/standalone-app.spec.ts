import { expect, test } from "@playwright/test";

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
});

test("desktop QA runtime keeps the device preview available", async ({ page }) => {
  await page.goto("/?runtime=preview&screen=planner");
  await expect(page.getByTestId("phone-frame")).toBeVisible();
  await expect(page.getByTestId("device-picker")).toBeVisible();
  await expect(page.getByTestId("mobile-cursor")).toHaveCount(1);
});
