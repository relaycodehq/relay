import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { mkdtemp, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { screenshot } from "../fixtures/screenshot";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

/** A repository on main with `panel` checked out in a worktree made by hand, and an app with it as its project. */
async function launch() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-switch-")));
  const repo = join(root, "project"),
    panel = join(root, "panel"),
    bin = join(root, "bin"),
    data = join(root, "data");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  const fixture = await fixtureServer();
  await mkdir(repo);
  await mkdir(bin);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.invalid");
  git(
    repo,
    "remote",
    "add",
    "origin",
    fixture.serverUrl + "/Web/web-store.git",
  );
  await writeFile(join(repo, "README.md"), "# Cache\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "Base");
  git(repo, "worktree", "add", "-q", "-b", "panel", panel);
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const env = relayEnv();
  const app = await electron.launch({
    env: { ...env, ...pathWith(env, bin), RELAY_TEST_DATA: data },
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
  await page.reload();
  return {
    page,
    repo,
    panel,
    git,
    close: async () => {
      await app.close();
      await fixture.close();
    },
  };
}

test("moves a started thread into a branch's worktree and back to the project folder", async () => {
  const { page, repo, git, close } = await launch();
  try {
    await page.getByLabel("Message project").fill("fixture edit files");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByText("needed no change")).toBeVisible();

    await page.getByRole("button", { name: "main", exact: true }).click();
    // A branch another folder has checked out is a choice like any other.
    await expect(page.getByRole("option", { name: /panel/ })).toBeEnabled();
    await screenshot(page, { path: "test-results/branch-switch-list.png" });
    await page.getByRole("option", { name: /panel/ }).click();
    await expect(page.getByText("Switched to panel")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "panel", exact: true }),
    ).toBeVisible();
    await screenshot(page, { path: "test-results/branch-switch-joined.png" });
    expect(git(repo, "branch", "--show-current")).toBe("main");

    await page.getByRole("button", { name: "panel", exact: true }).click();
    await page.getByRole("option", { name: /^main/ }).click();
    await expect(
      page.getByRole("button", { name: "main", exact: true }),
    ).toBeVisible();
    // There and back after one message is no move at all; the line goes.
    await expect(page.getByText("Switched to panel")).toHaveCount(0);
  } finally {
    await close();
  }
});

test("reviews the edits in a branch's worktree, picked on the deep review page", async () => {
  const { page, panel, close } = await launch();
  try {
    await writeFile(join(panel, "panel.ts"), "export const panel = 1;\n");
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    // The project folder has nothing uncommitted of its own.
    await expect(page.getByText("No uncommitted changes")).toBeVisible();
    await page.getByRole("button", { name: "main", exact: true }).click();
    await page.getByRole("option", { name: /panel/ }).click();
    await expect(page.getByText("1 file changed on panel")).toBeVisible();
    await screenshot(page, { path: "test-results/branch-switch-review.png" });
  } finally {
    await close();
  }
});
