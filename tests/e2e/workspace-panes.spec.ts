import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("chat, changes and files are inline panes that can be reordered", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-panes-"))),
    repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(join(repo, "src"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "src/a.ts"), "export const a = 1;\n");
  await writeFile(join(repo, "src/b.ts"), "export const b = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  await writeFile(join(repo, "src/a.ts"), "export const a = 2;\n");
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
    const toggles = page.getByRole("group", { name: "Workspace panes" });
    const toggle = (name: string) =>
      toggles.getByRole("button", { name, exact: true });
    const order = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".workspace-pane")]
          .filter((p) => !p.hidden)
          .sort((a, b) => Number(a.style.order) - Number(b.style.order))
          .map((p) => p.dataset.pane),
      );

    // Only the chat is open at first.
    await expect(toggles).toBeVisible();
    await expect(page.locator(".pane-header")).toHaveCount(0);
    expect(await order()).toEqual(["chat"]);

    // Opening a file happens inline and is remembered.
    await toggle("Files").click();
    await page
      .locator(".project-file-list")
      .getByRole("button", { name: /b\.ts/ })
      .click();
    await expect(
      page.locator(".project-inline-editor").getByRole("textbox", {
        name: "src/b.ts",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close files", exact: true })
      .click();

    // Regression: the Changes pane never pops the remembered file in a modal.
    await toggle("Changes").click();
    await expect(
      page.getByRole("region", { name: "Local changes" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Changes open in the Files pane, next to the diff.
    await page.locator(".working-select", { hasText: "src/a.ts" }).click();
    await page
      .getByRole("button", { name: "Open in editor", exact: true })
      .click();
    await expect(
      page.locator(".project-inline-editor").getByRole("textbox", {
        name: "src/a.ts",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await order()).toEqual(["chat", "changes", "files"]);

    // Drag a header toggle to reorder the panes; the order survives a reload.
    await toggle("Files").dragTo(toggle("Chat"), {
      targetPosition: { x: 2, y: 5 },
    });
    expect(await order()).toEqual(["files", "chat", "changes"]);
    await page.reload();
    await toggle("Changes").click();
    await toggle("Files").click();
    expect(await order()).toEqual(["files", "chat", "changes"]);

    // The last visible pane cannot be hidden.
    await toggle("Files").click();
    await toggle("Changes").click();
    await expect(toggle("Chat")).toBeDisabled();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
