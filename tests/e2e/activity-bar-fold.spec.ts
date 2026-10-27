import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("the activity bar folds away with the sidebar and peeks back with it", async () => {
  const data = await mkdtemp(join(tmpdir(), "relay-bar-fold-"));
  await mkdir(join(data, "config"), { recursive: true });
  await writeFile(
    join(data, "config", "settings.json"),
    JSON.stringify({ activityBar: { foldsWithSidebar: true } }),
  );
  const app = await electron.launch({
    env: { ...relayEnv(), RELAY_TEST_DATA: data },
  });
  try {
    const page = await app.firstWindow();
    const bar = page.getByRole("navigation", { name: "Activity bar" });
    const sidebar = page.locator(".projects-sidebar");
    await expect(bar).toBeVisible();

    await page.getByTitle(/^Hide sidebar/).click();
    await expect(bar).toBeHidden();
    await expect(sidebar).toBeHidden();
    // The page takes the bar's room too.
    const layout = page.locator(".project-layout");
    await expect(layout).toHaveCSS("padding-left", "0px");

    // The window's own edge peeks both, and the pointer can cross the bar
    // into the sidebar without either folding.
    const { y, height } = (await layout.boundingBox())!;
    const middle = y + height / 2;
    await page.mouse.move(4, middle);
    await expect(bar).toBeVisible();
    await expect(sidebar).toBeVisible();
    await page.mouse.move(26, middle, { steps: 4 });
    const barBox = (await bar.boundingBox())!;
    await page.mouse.move(barBox.x + barBox.width + 60, middle, { steps: 6 });
    await page.waitForTimeout(400);
    await expect(bar).toBeVisible();
    await expect(sidebar).toBeVisible();

    await page.mouse.move(1000, middle, { steps: 6 });
    await expect(bar).toBeHidden();
    await expect(sidebar).toBeHidden();

    // Settings keeps the bar, whose button is the way back.
    await page.mouse.move(4, middle);
    await bar.getByRole("button", { name: "Open settings" }).click();
    await page.mouse.move(1000, middle, { steps: 6 });
    await page.waitForTimeout(400);
    await expect(bar).toBeVisible();
    await expect(layout).not.toHaveCSS("padding-left", "0px");
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});
