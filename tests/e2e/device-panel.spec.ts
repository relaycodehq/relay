import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { openSurface } from "../fixtures/navigation";

// Downloads the real expo-device-hub with the user's npm and streams a real
// emulator, so it runs only when asked: boot one, then RELAY_DEVICE_E2E=1.
test("the Device surface downloads the hub, streams a booted emulator over the panel, and stops the hub on quit", async () => {
  test.skip(
    !process.env.RELAY_DEVICE_E2E,
    "Boot an Android Emulator, then set RELAY_DEVICE_E2E=1",
  );
  test.setTimeout(240_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-device-"))),
    repo = join(root, "project");
  await mkdir(repo, { recursive: true });
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  await writeFile(join(repo, "README.md"), "Device fixture\n");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) =>
        k !== "ELECTRON_RUN_AS_NODE" &&
        k !== "RELAY_DEV_URL" &&
        v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: process.env.RELAY_TEST_HEADED ?? "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  /** The hub's page, when it's laid over Relay's window. */
  const hubView = () =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (w) =>
          w.webContents.getURL().includes("index.html") ||
          w.webContents.getURL().startsWith("http://127.0.0.1:5177"),
      )!;
      const view = win.contentView.children.find(
        (v) =>
          "webContents" in v &&
          v.webContents !== win.webContents &&
          /^http:\/\/127\.0\.0\.1:(?!5177)/.test(
            (v as Electron.WebContentsView).webContents.getURL(),
          ),
      ) as Electron.WebContentsView | undefined;
      return view
        ? { url: view.webContents.getURL(), bounds: view.getBounds() }
        : null;
    });
  let hubOrigin = "";
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, repo);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Add a project", exact: true })
      .getByRole("option", { name: "Choose in Finder…", exact: true })
      .click();

    await openSurface(page, "Device");
    const panel = page.locator('[data-pane="panel"]');
    await expect(panel.getByRole("tab", { name: "Device" })).toBeVisible();
    // Nothing downloads until asked.
    expect(await hubView()).toBeNull();
    await panel
      .getByRole("button", { name: "Download and start", exact: true })
      .click();
    await expect.poll(hubView, { timeout: 180_000 }).not.toBeNull();
    const shown = (await hubView())!;
    hubOrigin = new URL(shown.url).origin;
    expect(hubOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // The token became a cookie and left the address.
    expect(shown.url).not.toContain("token=");
    const box = (await panel.locator(".device-surface").boundingBox())!;
    expect(shown.bounds.width).toBeGreaterThan(0);
    expect(Math.abs(shown.bounds.x - box.x)).toBeLessThanOrEqual(1);

    const hubPage = () =>
      app.evaluate(async ({ webContents }, origin) => {
        const wc = webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith(origin))!;
        return wc.executeJavaScript("document.body.innerText");
      }, hubOrigin);
    await expect.poll(hubPage, { timeout: 60_000 }).toContain("Live");
    // Without the cookie the hub refuses.
    expect((await fetch(`${hubOrigin}/api/devices`)).status).toBe(401);

    await page.screenshot({ path: "test-results/device-panel.png" });
    const frame = await app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith(origin))!;
      return (await wc.capturePage()).toPNG().toString("base64");
    }, hubOrigin);
    await writeFile("test-results/device-view.png", Buffer.from(frame, "base64"));

    // Closing the tab takes the page away; the hub keeps running.
    await panel.getByRole("tab", { name: "Device" }).hover();
    await panel.getByRole("button", { name: "Close device" }).click();
    await expect.poll(hubView).toBeNull();
    expect((await fetch(`${hubOrigin}/readyz`)).ok).toBe(true);
  } finally {
    await app.close();
  }
  if (hubOrigin)
    await expect
      .poll(() => fetch(`${hubOrigin}/readyz`).then(() => "up", () => "down"))
      .toBe("down");
});
