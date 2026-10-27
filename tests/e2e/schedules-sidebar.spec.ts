import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("Schedules lists them in the sidebar and shows the picked one beside", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-schedules-")),
    ),
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
  const app = await electron.launch({
    env: { ...relayEnv(), RELAY_TEST_DATA: join(root, "data") },
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
    const threads = page.locator(".shell-sidebar-threads");
    const list = page.getByRole("navigation", { name: "Schedules" });
    const picked = list.locator("[aria-current]");
    const name = page.locator(".schedule-name");
    const gallery = page.getByRole("region", { name: "New schedule" });
    await expect(threads).toBeVisible();

    await bar.getByRole("button", { name: "Schedules", exact: true }).click();
    await expect(list).toContainText("No schedules yet.");
    await expect(threads).toBeHidden();
    await gallery.getByRole("button", { name: /Start from scratch/ }).click();
    await expect(picked).toContainText("New schedule");
    await expect(picked).toContainText("Paused");
    await expect(name).toHaveValue("New schedule");

    // New schedule in the sidebar's head brings the examples back.
    await page
      .locator(".projects-sidebar")
      .getByRole("button", { name: "New schedule", exact: true })
      .click();
    await expect(gallery).toBeVisible();
    await expect(picked).toHaveCount(0);
    await gallery.getByRole("button", { name: /Find critical bugs/ }).click();
    await expect(picked).toContainText("Find critical bugs");
    await expect(name).toHaveValue("Find critical bugs");

    await list.getByRole("button", { name: /New schedule/ }).click();
    await expect(name).toHaveValue("New schedule");

    await bar.getByRole("button", { name: "Threads", exact: true }).click();
    await expect(threads).toBeVisible();
    await expect(list).toHaveCount(0);
  } finally {
    await app.close();
  }
});
