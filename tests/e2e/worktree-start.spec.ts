import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { screenshot } from "../fixtures/screenshot";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

/** A repository on main with `relay/setup-phase` a commit ahead, and an app with it as its project. */
async function launch() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-wt-start-")));
  const repo = join(root, "project"),
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
  git(repo, "switch", "-qc", "relay/setup-phase");
  await writeFile(join(repo, "setup.ts"), "export const phase = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "Setup phase");
  git(repo, "switch", "-q", "main");
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
      RELAY_TEST_DATA: data,
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
  await page.reload();
  return {
    app,
    page,
    repo,
    git,
    folder: join(data, "worktrees", "project"),
    close: async () => {
      await app.close();
      await fixture.close();
    },
  };
}

async function send(page: Page) {
  await page.getByLabel("Message project").fill("fixture edit files");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("needed no change")).toBeVisible();
}

test("carries an existing branch on in a worktree, leaving the checkout on its own", async () => {
  const { page, repo, git, folder, close } = await launch();
  try {
    const tip = git(repo, "rev-parse", "relay/setup-phase");
    await page.getByRole("button", { name: /Current checkout/ }).click();
    await screenshot(page, { path: "test-results/worktree-start-menu.png" });
    await page.getByRole("menuitem", { name: "Worktree on a branch…" }).click();
    // Main is checked out here, so Git couldn't carry it on in a worktree too.
    await expect(page.getByRole("option", { name: /^main/ })).toHaveCount(0);
    await screenshot(page, { path: "test-results/worktree-start-list.png" });
    await page.getByRole("option", { name: /setup-phase/ }).click();
    await expect(
      page.getByRole("button", { name: "Worktree on relay/setup-phase" }),
    ).toBeVisible();
    // Its branch has a name already; there's none to type.
    await expect(page.getByLabel("Branch for the new worktree")).toHaveCount(0);
    await screenshot(page, { path: "test-results/worktree-carry-on.png" });
    await send(page);

    const worktree = join(folder, "setup-phase");
    expect(git(worktree, "branch", "--show-current")).toBe("relay/setup-phase");
    expect(git(worktree, "rev-parse", "HEAD")).toBe(tip);
    expect(await readFile(join(worktree, "src/guard.ts"), "utf8")).toBe(
      "export const guard = true;\n",
    );
    expect(git(repo, "branch", "--show-current")).toBe("main");
  } finally {
    await close();
  }
});

test("starts a new worktree off another branch without switching the checkout", async () => {
  const { page, repo, git, folder, close } = await launch();
  try {
    const tip = git(repo, "rev-parse", "relay/setup-phase");
    await page.getByRole("button", { name: /Current checkout/ }).click();
    await page.getByRole("menuitem", { name: "New worktree off…" }).click();
    await page.getByRole("option", { name: /setup-phase/ }).click();
    await expect(
      page.getByRole("button", { name: "New worktree off relay/setup-phase" }),
    ).toBeVisible();
    await page
      .getByLabel("Branch for the new worktree")
      .fill("relay/next-step");
    await screenshot(page, { path: "test-results/worktree-off-branch.png" });
    await send(page);

    const worktree = join(folder, "next-step");
    expect(git(worktree, "branch", "--show-current")).toBe("relay/next-step");
    expect(git(worktree, "merge-base", "--is-ancestor", tip, "HEAD")).toBe("");
    expect(git(repo, "branch", "--show-current")).toBe("main");
  } finally {
    await close();
  }
});
