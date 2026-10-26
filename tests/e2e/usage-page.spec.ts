import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("Usage closes from its back button and its bar button, which also uncovers it from Settings", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-usage-"))),
    repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    const adding = page.getByRole("dialog", {
      name: "Add a project",
      exact: true,
    });
    await adding
      .getByRole("button", { name: "Open a folder", exact: true })
      .click();
    await adding
      .getByRole("button", { name: "Choose in Finder…", exact: true })
      .click();
    const bar = page.getByRole("navigation", { name: "Activity bar" });
    const openUsage = () =>
      bar.getByRole("button", { name: "Usage", exact: true }).click();
    const openSettings = () =>
      bar.getByRole("button", { name: "Open settings", exact: true }).click();
    const settings = page.locator(".settings-screen");
    const heading = page.getByRole("heading", { name: "Usage", level: 1 });
    const project = page
      .locator(".project-window-title")
      .getByText("Project", { exact: true });
    await expect(project).toBeVisible();

    await openUsage();
    await expect(heading).toBeVisible();
    await page
      .locator(".project-titlebar")
      .getByRole("button", { name: "Back", exact: true })
      .click();
    await expect(heading).toBeHidden();
    await expect(project).toBeVisible();

    await openUsage();
    await expect(heading).toBeVisible();
    await openUsage();
    await expect(heading).toBeHidden();
    await expect(project).toBeVisible();

    // Settings covers the page but not the bar, so the page's button brings
    // the page back instead of leaving it.
    await openUsage();
    await openSettings();
    await expect(settings).toBeVisible();
    await expect(heading).toBeHidden();
    await openUsage();
    await expect(settings).toBeHidden();
    await expect(heading).toBeVisible();

    const pulls = bar.getByRole("button", {
      name: "Pull requests",
      exact: true,
    });
    await pulls.click();
    await expect(pulls).toHaveAttribute("aria-current", "page");
    await openSettings();
    await expect(pulls).not.toHaveAttribute("aria-current", "page");
    await pulls.click();
    await expect(settings).toBeHidden();
    await expect(pulls).toHaveAttribute("aria-current", "page");
  } finally {
    await app.close();
  }
});
