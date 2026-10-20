import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ProjectChat } from "../../shared/projects";
import { workspaceId } from "../../shared/workspaces";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("the worktree's composer and header share push counts and sync its branch, leaving the checkout alone", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-worktree-sync-")),
  );
  const repo = join(root, "project"),
    remote = join(root, "origin.git"),
    worktree = join(root, "worktree"),
    other = join(root, "other"),
    data = join(root, "data"),
    bin = join(root, "bin");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    await mkdir(remote);
    await mkdir(bin);
    await mkdir(join(data, "project-chats"), { recursive: true });
    await fakeCli(
      join(bin, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
    git(remote, "init", "-q", "--bare", "-b", "main");
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.invalid");
    git(repo, "remote", "add", "origin", remote);
    await writeFile(join(repo, "README.md"), "Base\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "Base");
    git(repo, "push", "-qu", "origin", "main");
    const published = git(repo, "rev-parse", "HEAD");
    git(repo, "commit", "--allow-empty", "-qm", "Inherited one");
    git(repo, "commit", "--allow-empty", "-qm", "Inherited two");
    const branch = "relay/improve-c-editor-diagnostics-to-replace";
    git(repo, "worktree", "add", "-qb", branch, worktree);
    const start = git(worktree, "rev-parse", "HEAD");
    // The checkout's count differs, so reading the wrong workspace can't pass.
    git(repo, "commit", "--allow-empty", "-qm", "Checkout only");
    const checkoutHead = git(repo, "rev-parse", "HEAD");
    await writeFile(join(repo, "notes.txt"), "Other thread's work\n");
    const projectId = randomUUID();
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId,
      title: "Worktree sync",
      scope: { kind: "project" },
      created: Date.now(),
      updated: Date.now(),
      worktree: { path: worktree, branch, from: "main", head: start, start },
      messages: [
        {
          id: randomUUID(),
          role: "assistant",
          provider: "codex",
          status: "complete",
          body: "Ready to work here.",
          created: Date.now(),
          version: 1,
        },
      ],
    };
    await writeFile(
      join(data, "project-chats", chat.id + ".json"),
      JSON.stringify(chat),
    );
    await writeFile(
      join(data, "state.json"),
      JSON.stringify({
        version: 1,
        folders: {},
        progress: {},
        projects: [
          {
            id: projectId,
            path: repo,
            name: "project",
            repository: null,
            added: 1,
          },
        ],
        chats: [{ ...chat, messages: undefined }],
      }),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    app = await electron.launch({
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
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.locator(".sb-thread", { hasText: "Worktree sync" }).click();
    const sync = page.locator(".composer-branch-sync");
    const header = page.getByRole("group", { name: "Git actions" });
    const where = workspaceId(projectId, chat.id);
    // Nothing was done in this worktree: its two unpublished commits are inherited.
    await expect(sync).toHaveAccessibleName(
      `Push 2 commits to origin/${branch}`,
    );
    await expect(header.locator(".git-actions-ahead")).toHaveText("2");
    await page.screenshot({
      path: join(tmpdir(), "relay-worktree-sync-ahead.png"),
    });
    await sync.click();
    await expect(sync).toHaveCount(0);
    await expect(header.locator(".git-actions-ahead")).toHaveCount(0);
    expect(git(remote, "rev-parse", `refs/heads/${branch}`)).toBe(start);
    expect(git(worktree, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe(
      `origin/${branch}`,
    );

    // Pushing from the header updates the composer too.
    git(worktree, "commit", "--allow-empty", "-qm", "Worktree only");
    await expect(sync).toHaveAccessibleName(
      `Push 1 commit to origin/${branch}`,
    );
    await header.getByRole("button", { name: "More Git actions" }).click();
    await page.getByRole("menuitem", { name: "Push", exact: true }).click();
    await expect(sync).toHaveCount(0);
    expect(git(remote, "rev-parse", `refs/heads/${branch}`)).toBe(
      git(worktree, "rev-parse", "HEAD"),
    );

    // Incoming commits also belong to this worktree, never the main checkout.
    git(
      repo,
      "worktree",
      "add",
      "-qb",
      "remote-writer",
      other,
      `origin/${branch}`,
    );
    await writeFile(join(other, "README.md"), "Incoming change\n");
    git(other, "add", ".");
    git(other, "commit", "-qm", "Incoming");
    git(other, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
    const incoming = git(other, "rev-parse", "HEAD");
    await page.evaluate(async (where) => {
      await window.relay.projectGitAction(where, { kind: "fetch" });
    }, where);
    await page.reload();
    await expect(sync).toHaveAccessibleName(
      `Pull 1 commit from origin/${branch}`,
    );
    await page.screenshot({
      path: join(tmpdir(), "relay-worktree-sync-behind.png"),
    });
    await sync.click();
    await expect(sync).toHaveCount(0);
    expect(git(worktree, "rev-parse", "HEAD")).toBe(incoming);
    expect(await readFile(join(worktree, "README.md"), "utf8")).toBe(
      "Incoming change\n",
    );
    expect(git(repo, "rev-parse", "HEAD")).toBe(checkoutHead);
    expect(git(remote, "rev-parse", "refs/heads/main")).toBe(published);
    expect(await readFile(join(repo, "notes.txt"), "utf8")).toBe(
      "Other thread's work\n",
    );
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("Base\n");
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
