import { screenshot } from "../fixtures/screenshot";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
test("shows ahead/behind next to the branch and syncs with its upstream", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-branch-sync-")),
    ),
    repo = join(root, "project"),
    bare = join(root, "upstream.git"),
    other = join(root, "other"),
    fixture = await fixtureServer();
  const gitIn =
    (dir: string) =>
    (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  const git = gitIn(repo),
    otherGit = gitIn(other);
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    execFileSync("git", ["init", "-q", "--bare", "-b", "review", bare]);
    git("init", "-q", "-b", "review");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
    git("remote", "add", "upstream", bare);
    await writeFile(join(repo, "readme.md"), "one\n");
    git("add", ".");
    git("commit", "-qm", "Base");
    git("push", "-q", "-u", "upstream", "review");
    // Someone else pushes a commit this checkout hasn't fetched yet.
    execFileSync("git", ["clone", "-q", bare, other]);
    otherGit("config", "user.name", "Other");
    otherGit("config", "user.email", "other@example.invalid");
    await writeFile(join(other, "readme.md"), "one\ntwo\n");
    otherGit("commit", "-qam", "Remote change");
    otherGit("push", "-q");
    const remoteHead = otherGit("rev-parse", "HEAD");

    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
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
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+N" : "Control+N",
    );
    await expect(
      page.locator(".composer-branch-trigger:not(.workspace-trigger)"),
    ).toHaveText("review");

    // The background fetch surfaces the remote commit without user action.
    const pull = page.getByRole("button", {
      name: "Pull 1 commit from upstream/review",
    });
    await expect(pull).toHaveText("1");
    await screenshot(page, {
      path: "test-results/screenshots/branch-sync-behind.png",
      animations: "disabled",
    });
    await pull.click();
    await expect(pull).toHaveCount(0);
    expect(git("rev-parse", "HEAD")).toBe(remoteHead);

    await writeFile(join(repo, "readme.md"), "one\ntwo\nthree\n");
    git("commit", "-qam", "Local change");
    const push = page.getByRole("button", {
      name: "Push 1 commit to upstream/review",
    });
    await push.click();
    // A failed push shows why beside the branch; fail with that, not a count.
    await expect(async () => {
      expect(
        await page.locator(".composer-branch-error").allTextContents(),
      ).toEqual([]);
      expect(await push.count()).toBe(0);
    }).toPass({ timeout: 30000 });
    expect(gitIn(bare)("rev-parse", "review")).toBe(git("rev-parse", "HEAD"));

    // Diverged branches are shown but never synced automatically.
    await writeFile(join(other, "other.md"), "x\n");
    otherGit("add", ".");
    otherGit("commit", "-qm", "Another remote change");
    otherGit("pull", "-q", "--rebase");
    otherGit("push", "-q");
    await writeFile(join(repo, "local.md"), "y\n");
    git("add", ".");
    git("commit", "-qm", "Another local change");
    git("fetch", "-q", "upstream");
    const diverged = page.getByRole("button", {
      name: "1 ahead, 1 behind upstream/review",
    });
    await expect(diverged).toBeDisabled({ timeout: 15000 });
  } finally {
    await app?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
