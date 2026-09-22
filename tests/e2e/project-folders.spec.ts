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
test("organizes virtual folders, preserves child expansion across restart, and centers add icons", async () => {
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
    const projects = await page.evaluate(() => window.relay.projects());
    async function move(name: string, folder: string) {
      await page
        .getByRole("button", { name: "Organize projects", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Organize projects" });
      await dialog
        .getByLabel("Project to organize")
        .selectOption(projects.find((p) => p.name === name)!.id);
      await dialog.getByLabel("Virtual folder", { exact: true }).fill(folder);
      if (folder === "Work/Frontend")
        await page.screenshot({
          path: "test-results/screenshots/59-organize-projects.png",
          animations: "disabled",
        });
      await dialog
        .getByRole("button", { name: "Move project", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
    }
    await move("web-store", "Work/Frontend");
    await move("acme-service", "Work");
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
        name: "Collapse folder Work/Frontend",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Collapse folder Work", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "acme-service", exact: true }),
    ).not.toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Expand folder Work", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Collapse acme-service", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Expand folder Work/Frontend", exact: true })
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
    await move("web-store", "");
    expect(
      (await page.evaluate(() => window.relay.projects())).find(
        (p) => p.name === "web-store",
      )?.folder,
    ).toBeUndefined();
    await expect(
      page.getByRole("button", {
        name: "Collapse folder Work/Frontend",
        exact: true,
      }),
    ).not.toBeVisible();
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
