import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("putting off Relay's update toast leaves a dot on Settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-update-dot-"));
  const app = await electron.launch({
    env: { ...relayEnv(), RELAY_TEST_DATA: join(root, "data") },
  });
  try {
    const page = await app.firstWindow();
    const bar = page.getByRole("navigation", { name: "Activity bar" });
    const settings = bar.getByRole("button", { name: "Open settings" });
    await expect(settings).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send("relay:update", {
        status: "ready",
        current: "0.0.1",
        version: "99.0.0",
      });
    });
    const toast = page.locator(".update-toast").filter({ hasText: "99.0.0" });
    await expect(toast).toBeVisible();
    // The toast says it already; the dot waits until it's put off.
    await expect(settings.locator(".activity-bar-dot")).toHaveCount(0);

    // Base UI hides the × from the accessibility tree.
    await toast.hover();
    await toast.getByTitle("Dismiss").click();
    await expect(toast).toBeHidden();
    await expect(settings.locator(".activity-bar-dot")).toBeVisible();
    await expect(settings).toHaveAttribute(
      "title",
      /Relay 99\.0\.0 is ready to install/,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
