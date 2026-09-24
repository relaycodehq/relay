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

test("a thread works in its own worktree and merges back into the checkout", async () => {
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
  // Another thread's work in progress: the worktree starts with it.
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
    await page.getByRole("button", { name: /Current checkout/ }).click();
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

    // The agent worked in the worktree; the checkout is untouched.
    const folder = join(data, "worktrees", "project");
    const [leaf] = await readdir(folder);
    const worktree = join(folder, leaf);
    expect(leaf).toBe("fixture-edit-files");
    expect(await readFile(join(worktree, "src/guard.ts"), "utf8")).toBe(
      "export const guard = true;\n",
    );
    expect(await readFile(join(worktree, "notes.txt"), "utf8")).toBe("mine\n");
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("# Cache\n");
    expect(existsSync(join(repo, "src/guard.ts"))).toBe(false);
    await expect(page.getByText("relay/fixture-edit-files")).toBeVisible();

    // What the worktree changed opens like a turn's diff.
    const menu = page.getByRole("button", { name: /^Worktree/ });
    await expect(menu.getByLabel("2 files not in the checkout")).toBeVisible();
    await menu.click();
    await page.screenshot({ path: "test-results/worktree-menu.png" });
    await page.getByRole("menuitem", { name: "Show changes" }).click();
    const changes = page.getByRole("region", { name: "Turn changes" });
    await expect(changes).toContainText("Changed in this worktree");
    await expect(changes).toContainText("Checkout → Worktree");
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

    // Merging brings the thread's changes over, uncommitted, and nothing else.
    await menu.click();
    await page
      .getByRole("menuitem", { name: "Merge into current checkout" })
      .click();
    await expect(
      page.getByText("Merged into the checkout", { exact: true }),
    ).toBeVisible();
    expect(await readFile(join(repo, "src/guard.ts"), "utf8")).toBe(
      "export const guard = true;\n",
    );
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe(
      "# Cache\nEdited by the agent.\n",
    );
    expect(await readFile(join(repo, "notes.txt"), "utf8")).toBe("mine\n");
    expect(git("rev-list", "--count", "HEAD")).toBe("1");
    await page.screenshot({ path: "test-results/worktree-merged.png" });

    // Brought over by hand, outside Relay: it notices.
    await page.getByLabel("Message project").fill("fixture edit files again");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(menu.getByLabel("1 file not in the checkout")).toBeVisible();
    await writeFile(
      join(repo, "README.md"),
      await readFile(join(worktree, "README.md"), "utf8"),
    );
    await expect(
      page.getByText("Merged into the checkout outside Relay"),
    ).toBeVisible({ timeout: 25000 });

    // Both sides change the same lines: nothing is written, the agent gets markers.
    await page
      .getByLabel("Message project")
      .fill("fixture edit files once more");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(menu.getByLabel("1 file not in the checkout")).toBeVisible();
    const before =
      (await readFile(join(repo, "README.md"), "utf8")) + "Mine too.\n";
    await writeFile(join(repo, "README.md"), before);
    await menu.click();
    await page
      .getByRole("menuitem", { name: "Merge into current checkout" })
      .click();
    await expect(page.getByText("Couldn’t merge")).toBeVisible();
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe(before);
    await page.screenshot({ path: "test-results/worktree-conflict.png" });
    await page.getByRole("button", { name: "Ask the agent to fix" }).click();
    await expect(
      page.getByText("Relay brought the checkout's latest changes"),
    ).toBeVisible();
    const marked = await readFile(join(worktree, "README.md"), "utf8");
    expect(marked).toContain("<<<<<<< worktree");
    expect(marked).toContain("Mine too.");

    // Removing asks first while changes aren't merged; the process stops with it.
    await expect(
      page.getByText("The cache guard prevents duplicate requests."),
    ).toBeVisible();
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
