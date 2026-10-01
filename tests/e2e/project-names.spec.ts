import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screenshot } from "../fixtures/screenshot";

test("smart project names update immediately and stay off across restart", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-project-names-")),
  );
  const folder = join(root, "my-project_name.v2");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
    ),
  ) as Record<string, string>;
  const launch = () =>
    electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
  let app: ElectronApplication | undefined;
  try {
    await mkdir(folder);
    app = await launch();
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, folder);
    await page
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await screenshot(page, {
      path: "test-results/screenshots/smart-project-names-initial.png",
      animations: "disabled",
    });
    await expect(page.locator(".sb-project-row")).toContainText(
      "My Project Name.v2",
    );
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("region", { name: "Settings", exact: true });
    await dialog.getByRole("textbox").first().fill("smart project names");
    const toggle = dialog.getByRole("switch", {
      name: "Smart project names",
      exact: true,
    });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".sb-project-row")).toContainText(
      "my-project_name.v2",
    );
    await screenshot(page, {
      path: "test-results/screenshots/smart-project-names-off.png",
      animations: "disabled",
    });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".sb-project-row")).toContainText(
      "my-project_name.v2",
    );
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .first()
      .click();
    const restoredDialog = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await restoredDialog
      .getByRole("textbox")
      .first()
      .fill("smart project names");
    const restoredToggle = restoredDialog.getByRole("switch", {
      name: "Smart project names",
      exact: true,
    });
    await expect(restoredToggle).not.toBeChecked();
    await restoredToggle.click();
    await expect(restoredToggle).toBeChecked();
    await expect(restoredDialog.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".sb-project-row")).toContainText(
      "My Project Name.v2",
    );
    await screenshot(page, {
      path: "test-results/screenshots/smart-project-names-on.png",
      animations: "disabled",
    });
  } finally {
    await app?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
