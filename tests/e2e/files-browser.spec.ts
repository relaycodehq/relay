import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openInFileTree, openSurface } from "../fixtures/navigation";

// A 1×1 PNG, so the picture views have a real image to decode.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

test("browses the folder from disk: ignored files, pictures, binaries, and basic file operations", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-files-"))),
    repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(join(repo, "output/redesign"), { recursive: true });
  await mkdir(join(repo, "docs"));
  await mkdir(bin);
  await writeFile(join(repo, ".gitignore"), "output/\n");
  await writeFile(join(repo, "output/redesign/shot.png"), png);
  await writeFile(join(repo, "docs/data.bin"), Buffer.from([1, 2, 0, 3]));
  await writeFile(join(repo, "notes.md"), "# Notes\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    // The Trash and Finder aren't for a test to touch: record what they'd get.
    await app.evaluate(({ dialog, shell }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
      const calls: string[] = [];
      (globalThis as any).shellCalls = calls;
      shell.openPath = async (p) => (calls.push("open " + p), "");
      shell.showItemInFolder = (p) => void calls.push("show " + p);
      shell.trashItem = async (p) => {
        calls.push("trash " + p);
        process.getBuiltinModule("node:fs").rmSync(p, { recursive: true });
      };
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page.getByLabel("Message project").fill("hello");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await openSurface(page, "Files");

    // What Git ignores is still there to browse, and looks it.
    const tree = page.locator(".file-tree");
    const output = tree.getByRole("treeitem", { name: "output", exact: true });
    await expect(output).toBeVisible();
    await expect(tree.locator(".file-tree-row.ignored")).toHaveCount(1);
    await openInFileTree(page, "output/redesign");
    await expect(page.locator(".folder-card img")).toBeVisible();
    await openInFileTree(page, "output/redesign/shot.png");
    await expect(page.locator(".image-file-stage img")).toBeVisible();
    await expect(page.locator(".editor-bar-state")).toContainText("1 × 1");

    // What can't be edited says so and offers the way out.
    await openInFileTree(page, "docs/data.bin");
    await expect(
      page.getByText("Binary files are not supported here."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open with default app" })
      .last()
      .click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).shellCalls))
      .toContain("open " + join(repo, "docs/data.bin"));

    // A folder opens in Finder from its menu.
    await tree
      .getByRole("treeitem", { name: "docs", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: /Show in/ }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).shellCalls))
      .toContain("open " + join(repo, "docs"));

    // New file, rename and trash, all on disk.
    await tree
      .getByRole("treeitem", { name: "docs", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "New file" }).click();
    await page.keyboard.type("todo.md");
    await page.keyboard.press("Enter");
    await expect(page.locator(".project-inline-editor")).toBeVisible();
    expect(await readFile(join(repo, "docs/todo.md"), "utf8")).toBe("");
    const item = tree.getByRole("treeitem", { name: "todo.md", exact: true });
    // The editor takes focus once it has loaded; the tree's keys work after that.
    const loaded = async () => {
      await expect(
        page.locator('.project-inline-editor [contenteditable="true"]'),
      ).toBeAttached();
      await page.waitForTimeout(500);
    };
    await loaded();
    await item.focus();
    await page.keyboard.press("F2");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("done.md");
    await page.keyboard.press("Enter");
    await expect(
      tree.getByRole("treeitem", { name: "done.md", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        stat(join(repo, "docs/done.md")).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await expect(page.locator(".project-inline-editor")).toBeVisible();
    await loaded();
    await tree.getByRole("treeitem", { name: "done.md", exact: true }).focus();
    await page.keyboard.press("Delete");
    await expect(
      tree.getByRole("treeitem", { name: "done.md", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        stat(join(repo, "docs/done.md")).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
    // With nothing open, the pane shows the root again.
    await expect(page.locator(".folder-view")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
