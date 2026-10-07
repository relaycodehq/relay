import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { languageProject, reviewPath } from "../fixtures/language-project";
import {
  openInFileTree,
  openSurface,
  panelToggle,
} from "../fixtures/navigation";
test("local Angular projects run checks and symbol navigation without a Gitea account", async () => {
  const repo = await languageProject("https://gitea.example.invalid", true),
    data = await mkdtemp(join(tmpdir(), "relay-local-language-ui-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo.root);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    await openSurface(page, "Files");
    await expect(page.locator(".checks-button")).toContainText("2 errors", {
      timeout: 30000,
    });
    expect(
      (await page.evaluate(() => window.relay.bootstrap())).account,
    ).toBeNull();
    await page.locator(".checks-button").click();
    await expect(page.getByRole("dialog")).toContainText("missing");
    await expect(page.getByRole("dialog")).toContainText("number");
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await openInFileTree(page, reviewPath);
    const editor = page.getByRole("textbox", { name: reviewPath, exact: true });
    await expect(editor).toBeVisible();
    const call = editor
      .locator("span")
      .filter({ hasText: /^greet$/ })
      .last();
    await call.click({
      modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
    });
    await expect(
      page
        .getByRole("dialog", { name: "Go to definition" })
        .locator(".symbol-code"),
    ).toContainText("Hello,");
    await page
      .getByRole("button", { name: "Back to editing", exact: true })
      .click();
    await editor.press(
      (process.platform === "darwin" ? "Meta" : "Control") + "+End",
    );
    await editor.pressSequentially("// Keep my unsaved edit");
    // An unsaved buffer keeps Files and the panel open.
    await expect(panelToggle(page)).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Close files", exact: true }),
    ).toBeDisabled();
    await app.evaluate(({ app }) =>
      app.emit(
        "open-url",
        { preventDefault() {} },
        "relay://open?url=" +
          encodeURIComponent(
            "https://gitea.example.invalid/Web/web-store/pulls/7",
          ),
      ),
    );
    await expect(page.getByRole("alert")).toContainText("Save or close");
    await expect(editor).toContainText("Keep my unsaved edit");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect(
      page.getByLabel("Personal access token", { exact: true }),
    ).toBeVisible();
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !relaySeen(w) && !w.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close();
    await rm(repo.root, { recursive: true, force: true });
    await rm(data, { recursive: true, force: true });
  }
});
