import { screenshot } from "../fixtures/screenshot";
import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import {
  claudeTurns,
  writeClaudeSession,
  writeCodexSession,
} from "../fixtures/terminal-sessions";

const HOUR = 3_600_000;

test("continues a terminal session as a thread: resumed in the checkout, forked into a new worktree", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-continue-")));
  const repo = join(root, "project"),
    bin = join(root, "bin"),
    data = join(root, "data"),
    claudeHome = join(root, "claude-home"),
    codexHome = join(root, "codex-home"),
    capture = join(root, "capture.jsonl");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  await mkdir(repo);
  await mkdir(bin);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "cache.ts"), "export const guard = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  // What the terminal session left uncommitted.
  await writeFile(join(repo, "cache.ts"), "export const guard = 2;\n");
  const agent = await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8");
  for (const name of ["codex", "claude"]) await fakeCli(join(bin, name), agent);

  await writeClaudeSession(
    claudeHome,
    repo,
    "claude-idle-1",
    claudeTurns([
      { prompt: "Why does the cache guard never trip?", answer: "It compares the wrong key." },
      { prompt: "Fix it and keep the test", answer: "Fixed in cache.ts; the test passes." },
    ]),
    { ago: 2 * HOUR },
  );
  await writeCodexSession(
    codexHome,
    repo,
    "codex-live-01",
    [
      { prompt: "Tidy the README", answer: "Tidied." },
      { prompt: "Now the changelog", answer: "Half done", done: false },
    ],
    { name: "Docs pass" },
  );
  // No terminal lists it any more, but Codex never says; it goes on in a copy too.
  await writeCodexSession(
    codexHome,
    repo,
    "codex-idle-01",
    [{ prompt: "Bump the lockfile", answer: "Bumped." }],
    { ago: 3 * HOUR },
  );
  // Neither is listed: one is Relay's own, the other ran in another folder.
  await writeClaudeSession(claudeHome, repo, "claude-relay-1", claudeTurns([{ prompt: "Relay's own", answer: "x" }]), {
    entrypoint: "sdk-cli",
  });
  await writeClaudeSession(claudeHome, root, "claude-other1", claudeTurns([{ prompt: "Elsewhere", answer: "x" }]));

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
      RELAY_AGENT_CAPTURE: capture,
      // Never the real ~/.claude and ~/.codex.
      CLAUDE_CONFIG_DIR: claudeHome,
      CODEX_HOME: codexHome,
    },
  });
  const calls = async () =>
    (await readFile(capture, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((c) => !String(c.cwd).includes("relay-helper-"));
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

    const newThread = page
      .getByRole("button", { name: "New thread", exact: true })
      .first();
    const trigger = page.getByRole("button", {
      name: "Continue a terminal session",
    });
    await trigger.click();
    const popup = page.getByRole("dialog", {
      name: "Continue a terminal session",
    });
    const rows = popup.getByRole("option");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Docs pass");
    await expect(rows.nth(0).locator(".continue-session-detail")).toHaveText(
      "Codex · just now · 2 turns · open in a terminal, continues as a copy",
    );
    await expect(rows.nth(1)).toContainText("Why does the cache guard never trip?");
    await expect(rows.nth(1).locator(".continue-session-detail")).toHaveText(
      "Claude · 2h ago · 2 turns",
    );
    await expect(rows.nth(2)).toContainText("Bump the lockfile");
    await expect(rows.nth(2).locator(".continue-session-detail")).toHaveText(
      "Codex · 3h ago · 1 turn · continues as a copy",
    );
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await screenshot(page, {
        path: `test-results/continue-session-picker-${theme}.png`,
      });
    }
    await page.emulateMedia({ colorScheme: "light" });
    await popup.getByLabel("Search terminal sessions").fill("cache");
    await expect(rows).toHaveCount(1);
    await page.keyboard.press("Enter");

    // The idle Claude session opens as a thread holding its conversation.
    await expect(popup).toHaveCount(0);
    const thread = page.locator(".project-message");
    await expect(thread.filter({ hasText: "Fixed in cache.ts" })).toBeVisible();
    await expect(page.getByText("Continued from a terminal session")).toBeVisible();
    await screenshot(page, { path: "test-results/continue-session-resumed.png" });
    await page.getByLabel("Message project").fill("@claude Add a regression test");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect
      .poll(async () =>
        (await calls()).find((c) => c.prompt?.includes("Add a regression test")),
      )
      .toMatchObject({
        cwd: repo,
        args: expect.arrayContaining(["--resume=claude-idle-1"]),
      });
    const resumed = (await calls()).find((c) => c.prompt?.includes("Add a regression test"));
    expect(resumed.args).not.toContain("--fork-session");

    // A new thread with the worktree toggle on forks the live Codex session there.
    await newThread.click();
    await page.getByRole("button", { name: /Project folder/ }).click();
    await page.getByRole("menuitem", { name: "New worktree" }).click();
    await expect(page.getByRole("button", { name: /New worktree/ })).toBeVisible();
    await trigger.click();
    await expect(popup).toContainText("continued in a new worktree");
    await rows.filter({ hasText: "Docs pass" }).click();
    await expect(popup).toHaveCount(0);
    await expect(thread.filter({ hasText: "Tidied." })).toBeVisible();
    // The turn still running in the terminal stays there.
    await expect(thread.filter({ hasText: "Now the changelog" })).toHaveCount(0);
    await expect(
      page.getByText("Forked from a session still open in a terminal"),
    ).toBeVisible();
    await screenshot(page, { path: "test-results/continue-session-forked.png" });
    await page.getByLabel("Message project").fill("@codex Carry on");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect
      .poll(async () => (await calls()).find((c) => c.method === "thread/fork")?.thread)
      .toMatchObject({ threadId: "codex-live-01", lastTurnId: "turn-0" });
    const fork = (await calls()).find((c) => c.method === "thread/fork");
    expect(fork.thread.cwd).toContain(join(data, "worktrees"));
    expect(await readFile(join(fork.thread.cwd, "cache.ts"), "utf8")).toBe(
      "export const guard = 2;\n",
    );

    // Listed again, the Claude session is already a thread; picking it opens that one.
    await newThread.click();
    await trigger.click();
    await expect(rows.filter({ hasText: "cache guard" })).toContainText("in Relay");
    await screenshot(page, { path: "test-results/continue-session-in-relay.png" });
    await rows.filter({ hasText: "cache guard" }).click();
    await expect(thread.filter({ hasText: "Add a regression test" })).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const [project] = await window.relay.projects();
        return (await window.relay.projectChats(project!.id)).length;
      }),
    ).toBe(2);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
