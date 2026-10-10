import { screenshot } from "../fixtures/screenshot";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

/** Relay with fake Codex and Claude on its PATH. */
async function launch(
  root: string,
  withOpenRouter = false,
  openCodeQuirk?: string,
) {
  const bin = join(root, "bin");
  await mkdir(bin);
  const agent = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["codex", "claude"]) await fakeCli(join(bin, name), agent);
  if (withOpenRouter || openCodeQuirk)
    await fakeCli(
      join(bin, "opencode"),
      (await readFile(resolve("tests/fixtures/opencode-server.cjs"), "utf8"))
        .replaceAll('"zen"', '"openrouter"')
        .replaceAll('"Zen"', '"OpenRouter"')
        .replaceAll("zen/", "openrouter/"),
    );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  return electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      RELAY_AGENT_CAPTURE: join(root, "agent.jsonl"),
      RELAY_AGENT_NO_TITLE: "1",
      ...(openCodeQuirk ? { RELAY_OPENCODE_QUIRK: openCodeQuirk } : {}),
    },
  });
}

/** Relay on a new project whose src/queue.ts has an uncommitted change. */
async function openProject(withOpenRouter = false, openCodeQuirk?: string) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-deep-review-")),
  );
  const repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(join(repo, "src"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "src", "queue.ts"), "export const queue = [];\n");
  git("add", ".");
  git("commit", "-qm", "Start");
  await writeFile(join(repo, "src", "queue.ts"), "export const queue = [1];\n");
  const app = await launch(root, withOpenRouter, openCodeQuirk);
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dir],
    });
  }, repo);
  await page.evaluate(() => window.relay.addProject());
  return {
    page,
    close: async () => {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("empty OpenCode reviews show failure and retry instead of Done", async () => {
  const { page, close } = await openProject(false, "empty-after-tool");
  try {
    await page.evaluate(async () => {
      const [project] = await window.relay.projects();
      const reviewer = {
        provider: "opencode",
        choice: {
          model: "openrouter/pickle",
          reasoningEffort: "",
          fast: false,
        },
        prompt: "",
      };
      localStorage.setItem(
        `deep-review-setup:${project!.id}`,
        JSON.stringify({
          kind: "uncommitted",
          base: "",
          reviewers: [reviewer, reviewer],
          lead: {
            provider: "codex",
            choice: {
              model: "gpt-5.6-sol",
              reasoningEffort: "medium",
              fast: false,
            },
          },
          runChecks: false,
        }),
      );
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start deep review", exact: true })
      .click();
    const panes = page.locator(".deep-review-pane");
    await expect(panes).toHaveCount(2);
    await expect(panes.locator(".deep-review-pane-status")).toHaveText([
      "Didn't finish",
      "Didn't finish",
    ]);
    await expect(panes.locator(".agent-error-message")).toHaveCount(2);
    await expect(panes.first()).toContainText(
      "OpenCode stopped without a final answer",
    );
    await expect(panes.first()).toContainText("1 tool call failed");
    await expect(panes.locator(".deep-review-pane-status.done")).toHaveCount(0);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(panes.locator(".agent-error-message")).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: "Try again", exact: true }),
    ).toBeEnabled();
    await screenshot(page, { path: "test-results/opencode-empty-review.png" });
  } finally {
    await close();
  }
});

test("shares OpenRouter favorites between deep review reviewers and the lead", async () => {
  const { page, close } = await openProject(true);
  try {
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    const reviewer = page.getByRole("button", {
      name: "Reviewer 1 model",
      exact: true,
    });
    const selected = await reviewer.textContent();
    await reviewer.click();
    await page.getByRole("button", { name: "OpenCode", exact: true }).click();
    await page.getByRole("button", { name: /^OpenRouter\s+1$/ }).click();
    await page.getByRole("button", { name: "Add Pickle to favorites" }).click();
    await expect(
      page.getByRole("button", { name: "Remove Pickle from favorites" }),
    ).toBeVisible();
    await page.getByLabel("Search models", { exact: true }).press("Escape");
    await expect(reviewer).toHaveText(selected!);

    await page
      .getByRole("button", { name: "Reviewer 2 model", exact: true })
      .click();
    await page.getByRole("button", { name: "OpenCode", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Remove Pickle from favorites" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Add OpenCode default to favorites" })
      .click();
    await page.getByLabel("Search models", { exact: true }).press("Escape");

    await page.getByRole("button", { name: "Lead model", exact: true }).click();
    await page.getByRole("button", { name: "OpenCode", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Remove Pickle from favorites" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Remove OpenCode default from favorites",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Remove Pickle from favorites" })
      .click();
    await page.getByLabel("Search models", { exact: true }).press("Escape");
    await page.reload();
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Reviewer 1 model", exact: true })
      .click();
    await page.getByRole("button", { name: "OpenCode", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add Pickle to favorites" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Remove OpenCode default from favorites",
      }),
    ).toBeVisible();
    await screenshot(page, {
      path: "test-results/deep-review-model-favorites.png",
    });
  } finally {
    await close();
  }
});

test("reviews uncommitted changes with two agents, then fixes a finding with the lead", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-deep-review-")),
  );
  const repo = join(root, "project"),
    capture = join(root, "agent.jsonl");
  const fixture = await fixtureServer();
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  let app: ElectronApplication | undefined;
  try {
    await mkdir(join(repo, "src"), { recursive: true });
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
    await writeFile(
      join(repo, "src", "queue.ts"),
      "export const queue = [];\n",
    );
    git("add", ".");
    git("commit", "-qm", "Start");
    await writeFile(
      join(repo, "src", "queue.ts"),
      "export const queue = [1];\n",
    );
    app = await launch(root);
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

    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Deep review of project" }),
    ).toBeVisible();
    await expect(page.getByText("1 file changed on main")).toBeVisible();
    // Two reviewers by default, and a lead.
    await expect(page.locator(".deep-review-reviewers > li")).toHaveCount(2);
    await expect(
      page.getByRole("group", { name: "Lead", exact: true }),
    ).toBeVisible();
    await page.getByLabel("What to focus on").fill("the queue");
    await screenshot(page, { path: "test-results/deep-review-setup.png" });
    await page
      .getByRole("button", { name: "Start deep review", exact: true })
      .click();

    await expect(page.locator(".deep-review-request")).toContainText(
      "Uncommitted changes",
    );
    const panes = page.locator(".deep-review-pane");
    await expect(panes).toHaveCount(2);
    await expect(panes.first()).toContainText("/code-review high");
    await expect(panes.nth(1)).toContainText("/review");

    // The lead's summary shows each finding as its priority, above the list.
    const report = page.locator(".deep-review-report");
    await expect(report).toBeVisible({ timeout: 20000 });
    await expect(
      page
        .getByText("Reordering the queue can drop a message", {
          exact: false,
        })
        .first(),
    ).toBeVisible();
    await expect(report.locator(".deep-review-task")).toHaveCount(1);
    await expect(report).toContainText("queue.ts");
    await expect(report).toContainText("L3");
    await expect(page.locator(".deep-review-dropped")).toContainText(
      "Not kept · 1",
    );
    // The summary names each finding by its priority.
    const tag = page.locator(
      ".project-message.assistant button.deep-review-priority",
    );
    await expect(tag).toHaveText("P1");
    // Dismissing a finding and taking it back leaves the summary as it was drawn.
    const drawn = await tag.elementHandle();
    await report.getByRole("button", { name: /^Dismiss / }).click();
    await report.getByRole("button", { name: "Undo" }).click();
    await expect(report.locator(".deep-review-task")).toHaveAttribute(
      "data-status",
      "open",
    );
    expect(await drawn!.evaluate((el) => el.isConnected)).toBe(true);
    // The reviewers fold away once the lead has reported, and open again.
    await expect(panes).toHaveCount(0);
    await screenshot(page, { path: "test-results/deep-review-findings.png" });
    await page.getByRole("button", { name: /Council/ }).click();
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(1)).toContainText(
      "Queue reorder can drop a message",
    );
    await screenshot(page, { path: "test-results/deep-review-council.png" });
    await page.getByRole("button", { name: /Council/ }).click();

    await report
      .getByRole("button", { name: "Fix all 1", exact: true })
      .click();
    await expect(
      page.getByText("Fix this finding from the review", { exact: false }),
    ).toBeVisible();
    await expect(report.getByLabel("Fixed")).toBeVisible({ timeout: 20000 });
    await screenshot(page, { path: "test-results/deep-review-fixed.png" });
    // The next review starts without this one's focus.
    await page
      .getByRole("button", { name: "New thread", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    await expect(page.getByLabel("What to focus on")).toHaveValue("");

    const records = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.find((r) => r.review)?.review.target).toEqual({
      type: "uncommittedChanges",
    });
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a message sent after a deep review failed to start gets a thread of its own", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-deep-review-")),
  );
  const repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(repo);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "README.md"), "# Queue\n");
  git("add", ".");
  git("commit", "-qm", "Start");
  // main has no commits that aren't on other, so its review can't start.
  git("branch", "other");
  const app = await launch(root);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    await page.getByRole("radio", { name: "Branch" }).click();
    await page
      .getByRole("button", { name: "Start deep review", exact: true })
      .click();
    await expect(
      page.getByText("main has no commits that aren't on other."),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Clear Deep review", exact: true })
      .click();
    await page.getByLabel("Message project").fill("Explain this project");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    // The question went to a Repository thread, not the review's.
    const scopes = await page.evaluate(async () => {
      const [project] = await window.relay.projects();
      const chats = await window.relay.projectChats(project!.id);
      return chats.filter((c) => !c.empty).map((c) => c.scope.kind);
    });
    expect(scopes).toEqual(["project"]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reviews another branch into main from a checkout on main", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-deep-review-")),
  );
  const repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(repo);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "README.md"), "# Queue\n");
  git("add", ".");
  git("commit", "-qm", "Start");
  git("switch", "-qc", "device-panel");
  await writeFile(join(repo, "panel.ts"), "export const panel = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Add the panel");
  git("switch", "-q", "main");
  const app = await launch(root);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    await page.getByRole("radio", { name: "Branch" }).click();
    // The checked-out branch first, into the only other one.
    const head = page.getByRole("button", { name: "Branch to review" });
    const base = page.getByRole("button", { name: "Base branch" });
    await expect(head).toHaveText("main");
    await expect(base).toHaveText("device-panel");
    await head.click();
    await page.getByRole("option", { name: "device-panel" }).click();
    await expect(head).toHaveText("device-panel");
    await expect(base).toHaveText("main");
    await screenshot(page, {
      path: "test-results/deep-review-other-branch.png",
    });
    await page
      .getByRole("button", { name: "Start deep review", exact: true })
      .click();

    await expect(page.locator(".deep-review-request")).toContainText(
      "device-panel → main",
    );
    // Reviewed in a worktree of its own, so Claude runs its own review there.
    await expect(page.locator(".deep-review-request")).toContainText(
      "Reviewed and fixed in",
    );
    const panes = page.locator(".deep-review-pane");
    await expect(panes.first()).toContainText("/code-review high");
    await screenshot(page, {
      path: "test-results/deep-review-other-branch-started.png",
    });
    expect(git("branch", "--show-current").trim()).toBe("main");
    expect(git("worktree", "list")).toContain("deep-reviews");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the next findings wait until the lead has finished a fix", async () => {
  const { page, close } = await openProject();
  try {
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    // Codex takes a moment over each fix, long enough to ask for another.
    await page.getByRole("button", { name: "Lead model" }).click();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await page
      .getByRole("option", { name: "GPT-5.6-Sol", exact: true })
      .click();
    await page.getByLabel("What to focus on").fill("fixture two findings");
    await page
      .getByRole("button", { name: "Start deep review", exact: true })
      .click();
    const report = page.locator(".deep-review-report");
    await expect(report.locator(".deep-review-task")).toHaveCount(2, {
      timeout: 20000,
    });
    await report.getByRole("button", { name: "Fix selected (1)" }).click();
    await expect(report.getByText("Fixing…")).toBeVisible();
    const other = report.getByRole("button", { name: "Fix the other 1" });
    await expect(other).toBeDisabled();
    await expect(report.getByLabel("Fixed")).toBeVisible({ timeout: 20000 });
    await expect(other).toBeEnabled();
  } finally {
    await close();
  }
});

test("follow-up findings get a fresh report and fix controls after the old batch is solved", async () => {
  const { page, close } = await openProject();
  try {
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    await page.getByRole("button", { name: "Lead model" }).click();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await page
      .getByRole("option", { name: "GPT-5.6-Sol", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start deep review", exact: true })
      .click();
    const reports = page.locator(".deep-review-report");
    await expect(reports).toHaveCount(1, { timeout: 20000 });
    await reports
      .getByRole("button", { name: "Fix all 1", exact: true })
      .click();
    await expect(reports.getByLabel("Fixed")).toBeVisible({ timeout: 20000 });
    await page.evaluate(async () => {
      const [project] = await window.relay.projects();
      const [summary] = await window.relay.projectChats(project!.id);
      const chat = await window.relay.projectChat(summary!.id);
      const review = chat.deepReview!;
      await window.relay.sendProjectChat(chat.id, {
        id: crypto.randomUUID(),
        body: "@codex fixture followup findings",
        provider: review.lead.provider,
        choice: review.lead.choice,
        runtimeMode: review.runtimeMode,
        interactionMode: "default",
      });
    });
    await expect(reports).toHaveCount(2, { timeout: 20000 });
    const old = reports.first(),
      fresh = reports.nth(1);
    await expect(old.getByLabel("Fixed")).toHaveCount(1);
    await expect(fresh.locator(".deep-review-task")).toHaveCount(2);
    await expect(fresh).toContainText(
      "A busy supervisor is incorrectly treated as dead",
    );
    await expect(fresh).toContainText(
      "Read-only snapshot directories prevent staging cleanup",
    );
    await expect(
      fresh.getByRole("button", { name: "Fix all 2", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".project-message.assistant pre")).toHaveCount(0);
    await fresh.scrollIntoViewIfNeeded();
    await screenshot(page, { path: "test-results/deep-review-followup.png" });
    await page.reload();
    await expect(reports).toHaveCount(2);
    await fresh.getByRole("checkbox").nth(1).uncheck();
    await fresh.getByRole("button", { name: "Fix selected (1)" }).click();
    await expect(fresh.getByLabel("Fixed")).toHaveCount(1, { timeout: 20000 });
    await fresh.getByRole("button", { name: "Fix the other 1" }).click();
    await expect(fresh.getByLabel("Fixed")).toHaveCount(2, { timeout: 20000 });
    await expect(old.getByLabel("Fixed")).toHaveCount(1);
    await screenshot(page, {
      path: "test-results/deep-review-followup-fixed.png",
    });
  } finally {
    await close();
  }
});

test("the focus note keeps the send key set for messages", async () => {
  const { page, close } = await openProject();
  try {
    await page.evaluate(() =>
      localStorage.setItem("relay-send-key", "mod-enter"),
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    const focus = page.getByLabel("What to focus on");
    await focus.fill("the queue");
    // Enter adds a line here, as in the composer; ⌘/Ctrl+Enter starts.
    await focus.press("Enter");
    await focus.pressSequentially("and its tests");
    await expect(focus).toHaveValue("the queue\nand its tests");
    await focus.press("ControlOrMeta+Enter");
    await expect(page.locator(".deep-review-request")).toContainText(
      /the queue\s+and its tests/,
    );
    await expect(page.locator(".deep-review-report")).toBeVisible({
      timeout: 20000,
    });
  } finally {
    await close();
  }
});

test("a reviewer runs the prompt you typed, and the setup waits by Start next time", async () => {
  const { page, close } = await openProject();
  try {
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    const second = page.getByLabel("Prompt for reviewer 2");
    // Each line starts on the agent's own review.
    await expect(page.getByLabel("Prompt for reviewer 1")).toHaveValue(
      "/code-review",
    );
    await expect(second).toHaveValue("/review");
    await second.click();
    await expect(
      page.getByRole("listbox", { name: "Codex prompts" }),
    ).toBeVisible();
    await screenshot(page, {
      path: "test-results/deep-review-prompt-menu.png",
    });
    await second.fill("Only look for dropped messages in the queue");
    await screenshot(page, { path: "test-results/deep-review-prompt.png" });
    await page
      .getByRole("button", { name: "Start deep review", exact: true })
      .click();

    const panes = page.locator(".deep-review-pane");
    await expect(panes).toHaveCount(2);
    await expect(panes.first()).toContainText("/code-review high");
    await expect(panes.nth(1)).toContainText(
      "Only look for dropped messages in the queue",
    );
    await expect(panes.nth(1)).toContainText("This review covers");

    // The next review starts from this setup, shown by Start and kept under More.
    await page
      .getByRole("button", { name: "New thread", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Deep review", exact: true })
      .click();
    await expect(page.getByLabel("Prompt for reviewer 2")).toHaveValue(
      "Only look for dropped messages in the queue",
    );
    const shown = page.locator(".deep-review-setups button[aria-pressed]");
    await expect(shown).toHaveAttribute("aria-pressed", "true");
    await expect(shown).not.toHaveText("Naming…", { timeout: 20000 });
    await page.getByRole("button", { name: "All review setups" }).click();
    await expect(page.locator(".deep-review-setups-row")).toHaveCount(1);
    await screenshot(page, { path: "test-results/deep-review-setups.png" });
  } finally {
    await close();
  }
});
