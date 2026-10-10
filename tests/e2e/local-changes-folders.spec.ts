import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { screenshot } from "../fixtures/screenshot";

test("the Changes pane groups files by folder, per project", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-folders-"))),
    repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(join(repo, "src/lib"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "README.md"), "# Project\n");
  await writeFile(join(repo, "src/a.ts"), "export const a = 1;\n");
  await writeFile(join(repo, "src/b.ts"), "export const b = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  await writeFile(join(repo, "README.md"), "# Project!\n");
  await writeFile(join(repo, "src/a.ts"), "export const a = 2;\n");
  await writeFile(join(repo, "src/b.ts"), "export const b = 2;\n");
  await writeFile(join(repo, "src/lib/c.ts"), "export const c = 1;\n");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
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
    }, repo);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Add a project", exact: true })
      .getByRole("option", { name: "Choose in Finder…", exact: true })
      .click();
    await page
      .getByRole("group", { name: "Workspace panes" })
      .getByRole("button", { name: /^Changes\b/ })
      .click();
    const changes = page.getByRole("region", { name: "Local changes" });
    const folders = () => changes.locator(".working-folder").allTextContents();

    // Flat by default, with the folder after each name.
    await expect(changes.locator(".working-file")).toHaveCount(4);
    expect(await folders()).toEqual([]);

    await page
      .getByRole("button", { name: "Group by folder", exact: true })
      .click();
    await expect.poll(folders).toEqual(["/", "src", "src/lib"]);
    await expect(changes.locator(".change-dir")).toHaveCount(0);
    await screenshot(changes.locator(".working-sidebar"), {
      path: "test-results/local-changes-by-folder.png",
    });

    // A folder's box stages just that folder's files.
    await changes
      .getByRole("checkbox", { name: "Stage src", exact: true })
      .click();
    await expect(
      changes.locator(".working-file-list > section").first(),
    ).toContainText("2 files");
    expect(git("diff", "--cached", "--name-only").trim().split("\n")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);

    // A folder folds away its files and says how many it hides; ⌥ folds them all.
    const working = changes.locator(".working-file-list > section").nth(1);
    await working.getByRole("button", { name: "Repository root", exact: true }).click();
    await expect(working.locator(".working-file")).toHaveCount(1);
    await expect(working.locator(".working-folder small")).toHaveText(["1"]);
    await screenshot(changes.locator(".working-sidebar"), {
      path: "test-results/local-changes-folder-collapsed.png",
    });
    await working
      .getByRole("button", { name: "src/lib", exact: true })
      .click({ modifiers: ["Alt"] });
    await expect(working.locator(".working-file")).toHaveCount(0);
    await working
      .getByRole("button", { name: "src/lib", exact: true })
      .click({ modifiers: ["Alt"] });
    await expect(working.locator(".working-file")).toHaveCount(2);

    // The choice survives a reload.
    await page.reload();
    await expect.poll(folders).toEqual(["src", "/", "src/lib"]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
