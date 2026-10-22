import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mac = process.platform === "darwin";
const mod = mac ? "Meta" : "Control";

test("a changed shortcut moves its command, the app menu's included", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-shortcuts-"));
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
    },
  });
  const reloadKeys = () =>
    app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!
        .items.find((item) => item.label === "View")!
        .submenu!.items.filter((item) => item.label === "Reload")
        .map((item) => item.accelerator),
    );
  try {
    const page = await app.firstWindow();
    const settings = page.locator("section.settings-screen");
    const row = (title: string) =>
      settings.locator(`section.setting[aria-label="${title}"]`);
    await expect(
      page.getByRole("button", { name: "View activity" }),
    ).toBeVisible();
    await page.keyboard.press(`${mod}+Comma`);
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Keyboard shortcuts" }).click();

    // Open settings moves to ⇧ as well; Esc while recording keeps Settings open.
    await row("Open settings")
      .getByRole("button", { name: /Change/ })
      .click();
    await page.keyboard.press("Escape");
    await expect(settings).toBeVisible();
    await row("Open settings")
      .getByRole("button", { name: /Change/ })
      .click();
    await page.keyboard.press(`${mod}+Shift+Comma`);
    await expect(row("Open settings").locator(".shortcut-key")).toHaveText(
      mac ? "⇧⌘," : "Ctrl+Shift+,",
    );

    // A menu key reaches the app menu, and one another command has asks first.
    await row("Reload the window")
      .getByRole("button", { name: /Change/ })
      .click();
    await page.keyboard.press(`${mod}+KeyB`);
    await expect(row("Reload the window")).toContainText(
      "Pin or unpin the projects sidebar",
    );
    await row("Reload the window")
      .getByRole("button", { name: "Cancel" })
      .click();
    await row("Reload the window")
      .getByRole("button", { name: /Change/ })
      .click();
    await page.keyboard.press(`${mod}+Alt+KeyR`);
    await expect
      .poll(reloadKeys)
      .toEqual([mac ? "Alt+Command+R" : "Ctrl+Alt+R"]);

    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await page.keyboard.press(`${mod}+Comma`);
    await page.waitForTimeout(300);
    await expect(settings).toBeHidden();
    await page.keyboard.press(`${mod}+Shift+Comma`);
    await expect(settings).toBeVisible();

    // Changes outlive a reload, and Reset brings the defaults back.
    await page.reload();
    await expect(
      page.getByRole("button", { name: "View activity" }),
    ).toBeVisible();
    await expect
      .poll(reloadKeys)
      .toEqual([mac ? "Alt+Command+R" : "Ctrl+Alt+R"]);
    await page.keyboard.press(`${mod}+Shift+Comma`);
    await settings.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await settings.getByRole("button", { name: "Reset 2 shortcuts" }).click();
    await expect
      .poll(reloadKeys)
      .toEqual([mac ? "Shift+Command+R" : "Ctrl+Shift+R"]);
    await expect(row("Open settings").locator(".shortcut-key")).toHaveText(
      mac ? "⌘," : "Ctrl+,",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("passive update notices leave app shortcuts and Settings Escape available", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-shortcut-toasts-"));
  const app = await electron.launch({
    env: { ...relayEnv(), RELAY_TEST_DATA: join(root, "data") },
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "View activity" }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send("relay:update", {
        status: "available",
        current: "0.0.1",
        version: "99.0.0",
        install: "manual",
      });
    });
    const toast = page.locator(".update-toast").filter({ hasText: "99.0.0" });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute("role", "dialog");
    await page.keyboard.press(`${mod}+KeyN`);
    const picker = page.getByRole("dialog", { name: "New thread in…" });
    await expect(picker).toBeVisible();
    // Real dialogs still prevent app navigation underneath them.
    await page.keyboard.press(`${mod}+Comma`);
    const settings = page.locator("section.settings-screen");
    await expect(settings).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await page.keyboard.press(`${mod}+Comma`);
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(toast).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
