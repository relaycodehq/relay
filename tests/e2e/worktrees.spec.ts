import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  realpath,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";

test("a worktree thread is its own branch: the header follows it, commits there and merges into main", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-worktree-")));
  const repo = join(root, "project"),
    bin = join(root, "bin"),
    data = join(root, "data");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  const fixture = await fixtureServer();
  await mkdir(repo);
  await mkdir(bin);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
  await writeFile(join(repo, "README.md"), "# Cache\n");
  await mkdir(join(repo, "src"));
  await writeFile(join(repo, "src/cache.ts"), "export const cache = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  // Another thread's work in progress stays in the checkout.
  await writeFile(join(repo, "notes.txt"), "mine\n");
  await writeFile(
    join(bin, "codex"),
    `#!${process.execPath}\n` +
      (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
    { mode: 0o700 },
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
      PATH: bin + ":" + env.PATH,
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  let server: number | undefined;
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
    }, fixture.serverUrl);
    await page.reload();

    // Pick the worktree before the first message.
    await page.getByRole("button", { name: /Project folder/ }).click();
    await page.getByRole("menuitem", { name: "New worktree" }).click();
    await expect(
      page.getByRole("button", { name: /New worktree/ }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/worktree-new-thread.png" });
    await page.getByLabel("Message project").fill("fixture edit files");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByText("needed no change")).toBeVisible();

    // The agent worked in the worktree, on its own branch from the last commit.
    const folder = join(data, "worktrees", "project");
    const [leaf] = await readdir(folder);
    const worktree = join(folder, leaf);
    const inWorktree = (...args: string[]) =>
      execFileSync("git", ["-C", worktree, ...args], {
        encoding: "utf8",
      }).trim();
    expect(leaf).toBe("fixture-edit-files");
    expect(await readFile(join(worktree, "src/guard.ts"), "utf8")).toBe(
      "export const guard = true;\n",
    );
    expect(existsSync(join(worktree, "notes.txt"))).toBe(false);
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("# Cache\n");
    expect(existsSync(join(repo, "src/guard.ts"))).toBe(false);
    await expect(page.getByText("relay/fixture-edit-files")).toBeVisible();

    // The header follows the thread: Changes and Files show the worktree.
    await page.getByRole("button", { name: /^Changesb/ }).click();
    const local = page.getByRole("region", { name: "Local changes" });
    await expect(
      local.getByRole("button", { name: "Added src/guard.ts", exact: true }),
    ).toBeVisible();
    await expect(
      local.getByRole("button", { name: "Modified README.md", exact: true }),
    ).toBeVisible();
    await expect(local).not.toContainText("notes.txt");
    await expect(page.locator(".pane-header-detail").first()).toHaveText(
      "worktree",
    );
    await page.getByRole("button", { name: "Files", exact: true }).click();
    const fileList = page.locator(".project-file-list");
    await expect(
      fileList.getByRole("button", { name: /guard\.ts/ }),
    ).toBeVisible();
    await expect(fileList).not.toContainText("notes.txt");
    await page.screenshot({ path: "test-results/worktree-header.png" });
    await page.getByRole("button", { name: "Files", exact: true }).click();

    // What the branch has that main doesn't opens like a turn's diff.
    const menu = page.getByRole("button", { name: /^Worktree/ });
    await expect(menu.getByLabel("2 files not in main")).toBeVisible();
    await menu.click();
    await page.screenshot({ path: "test-results/worktree-menu.png" });
    await page.getByRole("menuitem", { name: "Changes against main" }).click();
    const changes = page.getByRole("region", { name: "Turn changes" });
    await expect(changes).toContainText("Changed in this worktree");
    await expect(changes).toContainText("Branched from → Worktree");
    await expect(changes).not.toContainText("notes.txt");

    // A process running in the worktree says so in Running.
    // Started from a subshell that exits at once, so it runs on its own like `nohup … &`.
    execFileSync("sh", [
      "-c",
      `cd ${JSON.stringify(worktree)} && (exec ${JSON.stringify(process.execPath)} -e "require('http').createServer().listen(0);setInterval(()=>{},1000)" </dev/null >/dev/null 2>&1 &)`,
    ]);
    server = Number(
      execFileSync("pgrep", ["-f", "createServer\\(\\).listen\\(0\\)"], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")[0],
    );
    const running = page.getByRole("complementary", {
      name: "Running processes",
    });
    await expect(running).toContainText("worktree", { timeout: 20000 });
    await running.screenshot({ path: "test-results/worktree-running.png" });

    // The header's Git button commits on the worktree's branch.
    const commitIn = async (message: string) => {
      await page.getByRole("button", { name: "More Git actions" }).click();
      await page.getByRole("menuitem", { name: "Commit", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Commit" });
      await sheet.getByLabel("Commit message").fill(message);
      await sheet.getByRole("button", { name: "Commit", exact: true }).click();
      await expect(sheet).toBeHidden();
    };
    await commitIn("Add the cache guard");
    expect(inWorktree("log", "-1", "--format=%s")).toBe("Add the cache guard");
    expect(inWorktree("branch", "--show-current")).toBe(
      "relay/fixture-edit-files",
    );
    expect(git("rev-list", "--count", "HEAD")).toBe("1");

    // Landing moves main in the checkout, around its work in progress.
    // The fixture remote isn't a Git server, so nothing is pushed.
    const mergeIntoMain = async () => {
      await page.getByRole("button", { name: "More Git actions" }).click();
      await page.getByRole("menuitem", { name: "Merge into main" }).click();
      const sheet = page.getByRole("dialog", { name: "Merge branch" });
      await expect(sheet).toContainText(
        "Also moves main where it's checked out",
      );
      await sheet.getByLabel(/Push main to/).uncheck();
      await sheet
        .getByRole("button", { name: "Merge into main", exact: true })
        .click();
      return sheet;
    };
    await mergeIntoMain();
    const merged = page.getByRole("dialog", { name: "Merged into main" });
    await expect(merged).toBeVisible();
    await page.screenshot({ path: "test-results/worktree-merged.png" });
    await merged.getByRole("button", { name: "Done" }).click();
    expect(git("rev-list", "--count", "HEAD")).toBe("2");
    expect(await readFile(join(repo, "src/guard.ts"), "utf8")).toBe(
      "export const guard = true;\n",
    );
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe(
      "# Cache\nEdited by the agent.\n",
    );
    expect(await readFile(join(repo, "notes.txt"), "utf8")).toBe("mine\n");
    await expect(page.locator(".worktree-landed")).toHaveText(
      "Merged into main",
    );

    // Both sides change the same lines: nothing lands; catching up with main
    // leaves the conflict marked in the worktree.
    await page
      .getByLabel("Message project")
      .fill("fixture edit files once more");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(menu.getByLabel("1 file not in main")).toBeVisible();
    await writeFile(
      join(repo, "README.md"),
      "# Cache\nEdited by the agent.\nMine too.\n",
    );
    git("commit", "-qam", "Mine too");
    await commitIn("Edit again");
    const sheet = await mergeIntoMain();
    await expect(sheet).toContainText("These files conflict");
    expect(git("log", "-1", "--format=%s")).toBe("Mine too");
    await page.screenshot({ path: "test-results/worktree-conflict.png" });
    await sheet
      .getByRole("button", { name: "Merge main into relay/fixture-edit-files" })
      .click();
    await expect(sheet).toContainText("with conflicts marked");
    const marked = await readFile(join(worktree, "README.md"), "utf8");
    expect(marked).toContain("<<<<<<<");
    expect(marked).toContain("Mine too.");
    await sheet.getByRole("button", { name: "Close dialog" }).click();
    await page
      .getByRole("button", { name: "Local changes", exact: true })
      .click();
    await expect(
      local
        .getByRole("button", { name: "Conflict README.md", exact: true })
        .first(),
    ).toBeVisible();

    // Removing asks first while changes aren't in main; the process stops with it.
    await menu.click();
    await page.getByRole("menuitem", { name: "Remove worktree" }).click();
    await page
      .getByRole("dialog", { name: "Remove the worktree?" })
      .getByRole("button", { name: "Remove worktree" })
      .click();
    await expect(page.getByText("Worktree removed")).toBeVisible();
    expect(existsSync(worktree)).toBe(false);
    expect(git("branch", "--list", "relay/fixture-edit-files")).toBe("");
    // It was the only process, so the list goes away.
    await expect(running).toBeHidden();
  } finally {
    if (server)
      try {
        process.kill(server);
      } catch {}
    await app.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
