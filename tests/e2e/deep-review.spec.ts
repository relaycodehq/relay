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

/** Relay with fake Codex and Claude on its PATH. */
async function launch(root: string) {
  const bin = join(root, "bin");
  await mkdir(bin);
  const agent =
    `#!${process.execPath}\n` +
    (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"));
  for (const name of ["codex", "claude"])
    await writeFile(join(bin, name), agent, { mode: 0o700 });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  return electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      PATH: bin + ":" + env.PATH,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      RELAY_AGENT_CAPTURE: join(root, "agent.jsonl"),
      RELAY_AGENT_NO_TITLE: "1",
    },
  });
}

/** Relay on a new project whose src/queue.ts has an uncommitted change. */
async function openProject() {
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
  const app = await launch(root);
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dir],
    });
  }, repo);
  await page
    .getByRole("button", { name: "Add project folder", exact: true })
    .click();
  return {
    page,
    close: async () => {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

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
    await page.screenshot({ path: "test-results/deep-review-setup.png" });
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
    await page.screenshot({ path: "test-results/deep-review-findings.png" });
    await page.getByRole("button", { name: /Council/ }).click();
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(1)).toContainText(
      "Queue reorder can drop a message",
    );
    await page.screenshot({ path: "test-results/deep-review-council.png" });
    await page.getByRole("button", { name: /Council/ }).click();

    await report
      .getByRole("button", { name: "Fix all 1", exact: true })
      .click();
    await expect(
      page.getByText("Fix this finding from the review", { exact: false }),
    ).toBeVisible();
    await expect(report.getByLabel("Fixed")).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "test-results/deep-review-fixed.png" });
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
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
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

    await page.getByRole("button", { name: "Repository", exact: true }).click();
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
