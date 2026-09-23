import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
test("organizes project groups, preserves child expansion across restart, and centers add icons", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-folders-")));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
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
    app = await launch();
    let page = await app.firstWindow();
    for (const name of ["web-store", "acme-service", "personal"]) {
      const repo = join(root, name);
      await mkdir(repo);
      const git = (...args: string[]) =>
        execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
      git("init", "-q", "-b", "main");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.invalid");
      await writeFile(join(repo, "README.md"), "Example");
      git("add", ".");
      git("commit", "-qm", "Initial");
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, repo);
      await page.evaluate(() => window.relay.addProject());
    }
    await page.reload();
    await page.emulateMedia({ colorScheme: "dark" });
    const folderOf = async (name: string) =>
      (await page.evaluate(() => window.relay.projects())).find(
        (p) => p.name === name,
      )?.folder;
    const row = (name: string) =>
      page.locator(".sb-project-row").filter({ hasText: name });
    await page.getByRole("button", { name: "New group", exact: true }).click();
    await page.getByLabel("New group name").fill("Work");
    await page.getByLabel("New group name").press("Enter");
    await expect(page.locator(".sb-group-empty")).toHaveText(
      "Drag projects here",
    );
    await page
      .getByRole("button", { name: "Group actions for Work", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "New group inside" }).click();
    await page.getByLabel("New group name").fill("Frontend");
    await page.getByLabel("New group name").press("Enter");
    await row("web-store").dragTo(page.locator(".sb-group-empty"));
    await expect.poll(() => folderOf("web-store")).toBe("Work/Frontend");
    await row("acme-service").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to group" }).click();
    await page.getByRole("menuitem", { name: "Work", exact: true }).click();
    await expect.poll(() => folderOf("acme-service")).toBe("Work");
    await page.screenshot({
      path: "test-results/screenshots/59-organize-projects.png",
      animations: "disabled",
    });
    await page
      .locator(".sb-project-name")
      .filter({ hasText: "web-store" })
      .click();
    await page
      .getByRole("button", { name: "Collapse web-store", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Expand acme-service", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Collapse group Work/Frontend",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Collapse group Work", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "acme-service", exact: true }),
    ).not.toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Expand group Work", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Collapse acme-service", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Expand group Work/Frontend", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Expand web-store", exact: true }),
    ).toBeVisible();
    for (const name of ["Add project", "New thread in acme-service"]) {
      const button = page.getByRole("button", { name, exact: true });
      await button.hover();
      const b = (await button.boundingBox())!,
        icon = (await button.locator("svg").boundingBox())!;
      expect(
        Math.abs(b.x + b.width / 2 - (icon.x + icon.width / 2)),
      ).toBeLessThan(1);
      expect(
        Math.abs(b.y + b.height / 2 - (icon.y + icon.height / 2)),
      ).toBeLessThan(1);
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator(".composer-branch-trigger")).toContainText(
      "main",
    );
    await page.screenshot({
      path: "test-results/screenshots/58-project-folders.png",
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Collapse group Work", exact: true })
      .dblclick();
    await page.getByLabel("Group name", { exact: true }).fill("Clients");
    await page.getByLabel("Group name", { exact: true }).press("Enter");
    await expect.poll(() => folderOf("web-store")).toBe("Clients/Frontend");
    await page
      .getByRole("button", { name: "Collapse group Clients/Frontend" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: /Remove group/ }).click();
    await expect.poll(() => folderOf("web-store")).toBe("Clients");
    await row("web-store").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to group" }).click();
    await page.getByRole("menuitem", { name: "Remove from group" }).click();
    await expect.poll(() => folderOf("web-store")).toBeUndefined();
    await expect(
      page.getByRole("button", {
        name: "Collapse group Clients/Frontend",
        exact: true,
      }),
    ).not.toBeVisible();
    await page
      .getByRole("button", {
        name: "Project actions for acme-service",
        exact: true,
      })
      .click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByLabel("Project name").fill("Services");
    await page.getByLabel("Project name").press("Enter");
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.relay.projects())).map((p) => p.name),
      )
      .toContain("Services");
    await row("Services").locator(".sb-project-chevron").click();
    await expect(
      page.getByRole("button", { name: "Expand Services", exact: true }),
    ).toBeVisible();
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
