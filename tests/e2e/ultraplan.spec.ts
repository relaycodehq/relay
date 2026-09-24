import { test, expect, _electron as electron } from "@playwright/test";
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

/** Relay with fake Codex and Claude on its PATH, on a new project. */
async function openProject() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-ultraplan-")),
  );
  const repo = join(root, "project"),
    bin = join(root, "bin"),
    capture = join(root, "agent.jsonl");
  await mkdir(join(repo, "src"), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "src", "queue.ts"), "export const queue = [];\n");
  git("add", ".");
  git("commit", "-qm", "Start");
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
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      PATH: bin + ":" + env.PATH,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      RELAY_AGENT_CAPTURE: capture,
      RELAY_AGENT_NO_TITLE: "1",
    },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, repo);
  await page
    .getByRole("button", { name: "Add project folder", exact: true })
    .click();
  return {
    page,
    repo,
    calls: async () =>
      (await readFile(capture, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    close: async () => {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("plans with a council: the lead's brief, three read-only thinkers, then its plan", async () => {
  test.setTimeout(90000);
  const { page, repo, calls, close } = await openProject();
  try {
    await page
      .getByRole("button", { name: "Mode: Build", exact: true })
      .click();
    await expect(page.getByRole("menuitemradio")).toHaveCount(3);
    await page.screenshot({ path: "test-results/ultraplan-mode-menu.png" });
    await page.getByRole("menuitemradio", { name: /^Ultraplan/ }).click();
    await expect(
      page.getByRole("button", { name: "Mode: Ultraplan", exact: true }),
    ).toBeVisible();

    // The council is fixed: three thinkers, each with a job.
    const members = page.locator(".ultraplan-member");
    await expect(members).toHaveCount(3);
    await expect(members).toContainText([
      "Skeptic",
      "Codebase scout",
      "Other route",
    ]);
    await expect(page.locator(".ultraplan-ring")).toHaveCount(1);
    await page.getByRole("radio", { name: "Same brief", exact: true }).click();
    await expect(members.locator("strong")).toHaveCount(0);
    await page
      .getByRole("radio", { name: "Different angles", exact: true })
      .click();
    await page
      .getByLabel("Message project")
      .fill("Plan retries for the queue.");
    await page.screenshot({ path: "test-results/ultraplan-composer.png" });
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();

    // Follow-ups go to the lead in Plan mode, not to another council.
    await expect(
      page.getByRole("button", { name: "Mode: Plan", exact: true }),
    ).toBeVisible();
    const council = page.getByRole("region", {
      name: "Ultraplan",
      exact: true,
    });
    await expect(council).toBeVisible();
    // It folds away once the lead has planned, and the plan can be built.
    await expect(council).toContainText("3 thinkers · planned", {
      timeout: 45000,
    });
    await expect(
      page.getByRole("button", { name: "Implement plan", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/ultraplan-planned.png" });
    await council
      .getByRole("button", { name: /Ultraplan/, expanded: false })
      .click();
    // Every stage is done, and the lead's brief shows inside the council.
    await expect(
      council
        .getByRole("list", { name: "Stages" })
        .locator('li[data-state="done"]'),
    ).toHaveCount(3);
    await expect(council.locator(".ultraplan-brief")).toContainText(
      "The cache guard prevents duplicate requests.",
    );
    for (const n of [1, 2, 3])
      await expect(
        council.getByRole("region", { name: new RegExp(`^Thinker ${n}:`) }),
      ).toContainText("Done");
    await page.screenshot({
      path: "test-results/ultraplan-council.png",
      fullPage: true,
    });
    // The brief shows only inside the council: the thread holds the request
    // and the lead's plan.
    await expect(
      page.locator(".project-message.assistant > header"),
    ).toHaveCount(1 + 3);

    const records = await calls();
    const codexPlan = records.filter(
      (r) => r.turn && r.turn.collaborationMode?.mode === "plan",
    );
    // The brief and the plan both run in Plan mode.
    expect(codexPlan).toHaveLength(2);
    expect(JSON.stringify(codexPlan[1].turn)).toContain("The council is back");
    const thinker = records.find(
      (r) => r.method === "thread/start" && r.thread?.sandbox === "read-only",
    );
    expect(thinker.thread).toMatchObject({
      cwd: repo,
      approvalPolicy: "never",
    });
  } finally {
    await close();
  }
});
