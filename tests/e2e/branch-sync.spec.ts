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
test("shows ahead/behind next to the branch, syncs with its upstream and rebases onto it", async () => {
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

    // Diverged: the button rebases the local commit onto what came in.
    await writeFile(join(other, "other.md"), "x\n");
    otherGit("add", ".");
    otherGit("commit", "-qm", "Another remote change");
    otherGit("pull", "-q", "--rebase");
    otherGit("push", "-q");
    await writeFile(join(repo, "local.md"), "y\n");
    git("add", ".");
    git("commit", "-qm", "Another local change");
    await writeFile(join(repo, "wip.md"), "not committed\n");
    // The view still knows only our outgoing commit. A rejected push must
    // fetch immediately and turn that same control into a rebase action.
    const rejectedPush = page.getByRole("button", {
      name: "Push 1 commit to upstream/review",
    });
    await rejectedPush.click();
    await expect(page.locator(".composer-branch-error")).toContainText(
      "Rebase onto upstream/review",
    );
    const rebase = page.getByRole("button", {
      name: "Rebase 1 commit onto upstream/review",
    });
    await expect(rebase).toBeEnabled();
    await expect(rejectedPush).toHaveCount(0);
    await screenshot(page, {
      path: "test-results/screenshots/branch-sync-push-rejected.png",
      animations: "disabled",
    });
    await rebase.click();
    await expect(page.locator(".composer-branch-error")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Push 1 commit to upstream/review" }),
    ).toBeVisible({ timeout: 15000 });
    expect(git("rev-parse", "HEAD~1")).toBe(otherGit("rev-parse", "HEAD"));
    expect(git("log", "-1", "--format=%s")).toBe("Another local change");
    expect(git("status", "--porcelain")).toBe("?? wip.md");

    // A conflict changes nothing and offers a thread to resolve it.
    await writeFile(join(other, "readme.md"), "theirs\n");
    otherGit("commit", "-qam", "Their readme");
    otherGit("push", "-q");
    await writeFile(join(repo, "readme.md"), "ours\n");
    git("commit", "-qam", "Our readme");
    const head = git("rev-parse", "HEAD");
    git("fetch", "-q", "upstream");
    await page
      .getByRole("button", { name: "Rebase 2 commits onto upstream/review" })
      .click();
    const card = page.locator(".rebase-conflict-card");
    await expect(card).toContainText("Couldn’t rebase onto upstream/review");
    await expect(card.locator(".rebase-conflict-file")).toHaveText([
      "readme.md",
    ]);
    await expect(card).toContainText("Their readme");
    await screenshot(page, {
      path: "test-results/screenshots/branch-sync-conflict.png",
      animations: "disabled",
    });
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(git("status", "--porcelain")).toBe("?? wip.md");
    await card.getByRole("button", { name: "Open as draft" }).click();
    await expect(card).toHaveCount(0);
    await expect(
      page.locator('[contenteditable="true"][aria-label="Message project"]'),
    ).toContainText("Rebase `review` onto `upstream/review`");
    // The button keeps saying so until either side moves.
    await expect(
      page.getByRole("button", {
        name: "Couldn’t rebase onto upstream/review",
      }),
    ).toBeVisible();
  } finally {
    await app?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
