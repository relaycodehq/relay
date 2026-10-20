import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ProjectChat } from "../../shared/projects";

for (const push of [false, true]) {
  test(`turn commits hide when committed and remember settling (${push ? "commit & push" : "commit"})`, async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-turn-commit-")),
    );
    const repo = join(root, "project"),
      data = join(root, "data"),
      origin = join(root, "origin.git");
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    await mkdir(repo);
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(join(repo, "README.md"), "Base\n");
    git("add", ".");
    git("commit", "-qm", "Base");
    if (push) {
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
      git("remote", "add", "origin", origin);
      git("push", "-qu", "origin", "main");
    }
    for (const path of ["a.txt", "b.txt", "notes.txt"])
      await writeFile(join(repo, path), `${path}\n`);
    const projectId = randomUUID(),
      chatId = randomUUID(),
      now = Date.now();
    const chat: ProjectChat = {
      id: chatId,
      projectId,
      title: "Turn to commit",
      scope: { kind: "project" },
      created: now,
      updated: now,
      messages: [
        {
          id: randomUUID(),
          role: "assistant",
          provider: "codex",
          status: "complete",
          body: "Changed two files.",
          created: now,
          version: 1,
          changes: ["a.txt", "b.txt"].map((path) => ({
            path,
            additions: 1,
            deletions: 0,
          })),
        },
      ],
    };
    await mkdir(join(data, "project-chats"), { recursive: true });
    await writeFile(
      join(data, "project-chats", chatId + ".json"),
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
    const env = relayEnv();
    const app = await electron.launch({
      env: {
        ...env,
        RELAY_TEST_DATA: data,
      },
    });
    try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: /^Turn to commit/ }).click();
      const card = page.getByRole("region", { name: "Changed files" });
      const commit = card.getByRole("button", { name: "Commit", exact: true });
      // The card's Commit only commits; the header's pushes where there's an upstream.
      const sheet = page.getByRole("dialog", { name: "Commit", exact: true });
      const header = page.getByRole("dialog", {
        name: push ? "Commit & push" : "Commit",
        exact: true,
      });
      const settleBox = { name: "Settle thread after commit" };
      const checkbox = sheet.getByRole("checkbox", settleBox);
      const settled = () =>
        page.evaluate(
          async ({ projectId, chatId }) =>
            (await window.relay.projectChats(projectId)).find(
              (c) => c.id === chatId,
            )?.settledAt,
          { projectId, chatId },
        );
      await expect(commit).toBeVisible();
      // The ordinary project commit has no thread to settle.
      await page.locator(".git-actions-main").click();
      await expect(header).toBeVisible();
      await expect(header.getByRole("checkbox", settleBox)).toHaveCount(0);
      await header.getByRole("button", { name: "Close dialog" }).click();
      await commit.click();
      await expect(checkbox).not.toBeChecked();
      await checkbox.check();
      await sheet.getByRole("button", { name: "Close dialog" }).click();
      await page.reload();
      await commit.click();
      await expect(checkbox).toBeChecked();
      await checkbox.uncheck();
      await sheet.getByRole("button", { name: "Close dialog" }).click();

      // A partial external commit still leaves an action; the last one hides it,
      // even though the unrelated notes are still dirty.
      git("add", "a.txt");
      git("commit", "-qm", "First external commit");
      await expect(commit).toBeVisible();
      git("add", "b.txt");
      git("commit", "-qm", "Last external commit");
      await expect(commit).toHaveCount(0);
      await expect(
        card.getByRole("button", { name: "Open diff" }),
      ).toBeVisible();
      await expect(card.getByRole("alert")).toHaveCount(0);

      await writeFile(join(repo, "b.txt"), "Changed again\n");
      await expect(commit).toBeVisible();
      await commit.click();
      await expect(checkbox).not.toBeChecked();
      await sheet
        .getByRole("textbox", { name: "Commit message", exact: true })
        .fill("Leave thread active");
      await sheet.getByRole("button", { name: /^Commit .*file/ }).click();
      await expect(sheet).toBeHidden();
      expect(await settled()).toBeUndefined();
      expect(git("show", "--name-only", "--format=", "HEAD")).toBe("b.txt");
      expect(git("status", "--porcelain")).toContain("notes.txt");
      await expect(commit).toHaveCount(0);

      await writeFile(join(repo, "b.txt"), "Ready to settle\n");
      await expect(commit).toBeVisible();
      await commit.click();
      await checkbox.check();
      await sheet
        .getByRole("textbox", { name: "Commit message", exact: true })
        .fill("Finish thread");
      await page.emulateMedia({ colorScheme: push ? "dark" : "light" });
      await sheet.screenshot({
        path: join(
          tmpdir(),
          `relay-turn-commit-${push ? "push" : "local"}.png`,
        ),
      });
      // A refused commit must leave the thread active and the option intact.
      const hook = join(repo, ".git", "hooks", "pre-commit");
      await writeFile(
        hook,
        "#!/bin/sh\necho 'Fixture commit refused' >&2\nexit 1\n",
        { mode: 0o755 },
      );
      await sheet.getByRole("button", { name: /^Commit .*file/ }).click();
      await expect(sheet.getByRole("alert")).toContainText(
        "Fixture commit refused",
      );
      expect(await settled()).toBeUndefined();
      await expect(checkbox).toBeChecked();
      await rm(hook);
      await sheet.getByRole("button", { name: /^Commit .*file/ }).click();
      await expect(sheet).toBeHidden();
      await expect.poll(settled).toBeGreaterThanOrEqual(now);
      await expect(commit).toHaveCount(0);
      // Both external commits and both of the card's wait for the header's Push.
      if (push)
        expect(git("rev-list", "--count", "@{upstream}..HEAD")).toBe("4");
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("the commit sheet notices files committed in the background", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-commit-")));
  const repo = join(root, "project"),
    origin = join(root, "origin.git"),
    data = join(root, "data");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", origin);
  await writeFile(join(repo, "README.md"), "# Base\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  git("push", "-qu", "origin", "main");
  for (const f of ["a.txt", "b.txt", "c.txt"])
    await writeFile(join(repo, f), `${f}\n`);
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      RELAY_TEST_DATA: data,
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();

    const open = async () => {
      await page.locator(".git-actions-main").click();
      const sheet = page.getByRole("dialog", { name: "Commit & push" });
      await expect(sheet).toBeVisible();
      return sheet;
    };

    // Part of the selection lands elsewhere; the rest still commits.
    let sheet = await open();
    await expect(sheet.getByText("3 of 3 files")).toBeVisible();
    git("add", "a.txt");
    git("commit", "-qm", "Agent took a");
    await expect(sheet.getByRole("status")).toHaveText(
      "1 file was committed while this was open: Agent took a",
    );
    await expect(sheet.getByText("2 of 2 files")).toBeVisible();
    await sheet
      .getByRole("textbox", { name: "Commit message", exact: true })
      .fill("Mine");
    await sheet.getByRole("button", { name: /^Commit & push/ }).click();
    await expect(sheet).toBeHidden();
    expect(git("log", "--format=%s", "-3")).toBe("Mine\nAgent took a\nBase");
    expect(git("show", "--name-only", "--format=", "HEAD")).toBe(
      "b.txt\nc.txt",
    );
    expect(git("rev-list", "--count", "@{upstream}..HEAD")).toBe("0");

    // Everything lands elsewhere: the sheet offers the push that's left.
    await writeFile(join(repo, "d.txt"), "d\n");
    sheet = await open();
    await expect(sheet.getByText("1 of 1 file")).toBeVisible();
    git("add", "d.txt");
    git("commit", "-qm", "Agent took d");
    await expect(sheet.getByRole("status")).toHaveText(
      "Already committed while this was open: Agent took d",
    );
    await expect(
      sheet.getByRole("textbox", { name: "Commit message", exact: true }),
    ).toBeHidden();
    await sheet.getByRole("button", { name: "Push", exact: true }).click();
    await expect(sheet).toBeHidden();
    expect(git("rev-list", "--count", "@{upstream}..HEAD")).toBe("0");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
