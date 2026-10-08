import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ProjectChat } from "../../shared/projects";
import { screenshot } from "../fixtures/screenshot";
import { openInFileTree } from "../fixtures/navigation";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("recovers an agent's repaired worktree after restart and routes branch, Git, files and terminal there", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-agent-worktree-")),
  );
  const repo = join(root, "project"),
    data = join(root, "data");
  const bin = join(root, "bin"),
    capture = join(root, "capture.jsonl");
  const original = join(root, "old-temp-folder"),
    worktree = join(root, "local-urls");
  const gitIn = (path: string, ...args: string[]) =>
    execFileSync("git", ["-C", path, ...args], { encoding: "utf8" }).trim();
  await mkdir(repo);
  await mkdir(bin);
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  gitIn(repo, "init", "-q", "-b", "main");
  gitIn(repo, "config", "user.name", "Fixture");
  gitIn(repo, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "README.md"), "Main checkout\n");
  gitIn(repo, "add", ".");
  gitIn(repo, "commit", "-qm", "Base");
  const mainHead = gitIn(repo, "rev-parse", "HEAD");
  gitIn(repo, "worktree", "add", "-q", "-b", "local-urls", original);
  await rename(original, worktree);
  gitIn(repo, "worktree", "repair", worktree);
  await writeFile(join(worktree, "feature.txt"), "Only in the worktree\n");
  await writeFile(join(repo, "main-only.txt"), "Another thread's work\n");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const launch = () =>
    electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_AGENT_CAPTURE: capture,
        RELAY_TEST_DATA: data,
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, repo);
    const chat = await page.evaluate(async () => {
      const project = await window.relay.addProject();
      if (!project) throw new Error("Fixture project wasn't added");
      const chat = await window.relay.createProjectChat(project.id, {
        kind: "project",
      });
      await window.relay.renameProjectChat(chat.id, "Recovered worktree");
      return chat;
    });
    await app.close();
    // Mimic the affected chat: the creation command is saved, the association is missing.
    const file = join(data, "project-chats", chat.id + ".json");
    const saved: ProjectChat = JSON.parse(await readFile(file, "utf8"));
    saved.messages = [
      {
        id: randomUUID(),
        role: "assistant",
        provider: "codex",
        body: "Working on local URLs in my worktree.",
        status: "complete",
        created: Date.now(),
        version: 1,
        trace: [
          {
            kind: "activity",
            id: "create-worktree",
            activity: {
              id: "create-worktree",
              kind: "command",
              label: `git worktree add -b local-urls ${original}`,
              status: "complete",
            },
          },
        ],
      },
    ];
    await writeFile(file, JSON.stringify(saved));
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: /Recovered worktree/ })
      .first()
      .click();
    const footer = page.locator(
      ".composer-branch-trigger.workspace-trigger.static",
    );
    await expect(page.locator(".agent-worktree-trigger")).toHaveText(
      "local-urls",
    );
    await expect(footer).toHaveText("local-urls");
    await expect(page.getByRole("button", { name: /^main$/ })).toHaveCount(0);
    const where = `${chat.projectId}/${chat.id}`;
    expect(
      await page.evaluate(
        (where) => window.relay.projectWorkingTree(where),
        where,
      ),
    ).toMatchObject({ branch: "local-urls" });
    await page.getByLabel("Message project").fill("where are we now");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    const calls = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      calls.some(
        (call) =>
          call.method === "thread/start" && call.thread.cwd === worktree,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: /^Changes\b/ }).click();
    const changes = page.getByRole("region", { name: "Local changes" });
    await expect(changes).toContainText("feature.txt");
    await expect(changes).not.toContainText("main-only.txt");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await openInFileTree(page, "feature.txt");
    await expect(page.locator(".project-inline-editor")).toContainText(
      "Only in the worktree",
    );
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".terminal-drawer-cwd")).toHaveAttribute(
      "title",
      worktree,
    );
    await screenshot(page, {
      path: "test-results/agent-worktree-recovered.png",
    });

    await page.getByRole("button", { name: "More Git actions" }).click();
    await page.getByRole("menuitem", { name: "Commit", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Commit", exact: true });
    await sheet.getByLabel("Commit message").fill("Worktree change");
    await sheet.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(sheet).toBeHidden();
    expect(gitIn(worktree, "log", "-1", "--format=%s")).toBe("Worktree change");
    expect(gitIn(repo, "rev-parse", "HEAD")).toBe(mainHead);
    expect(gitIn(repo, "status", "--porcelain")).toBe("?? main-only.txt");
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.locator(".project-history")).toContainText(
      "Worktree change",
    );
    gitIn(worktree, "checkout", "-q", "--detach");
    await expect(footer).toHaveText("Detached HEAD");
    await screenshot(page, {
      path: "test-results/agent-worktree-detached.png",
    });
    gitIn(worktree, "checkout", "-q", "local-urls");
    gitIn(repo, "worktree", "remove", worktree);
    await expect(
      page.getByRole("button", { name: /Project folder/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^main$/ })).toBeVisible();
  } finally {
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
