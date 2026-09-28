import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("shows Claude's subagents by the composer and opens each one's run", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-agents-")));
  const repo = join(root, "project"),
    bin = join(root, "bin");
  const fixture = await fixtureServer();
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    await mkdir(bin);
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    execFileSync("git", [
      "-C",
      repo,
      "remote",
      "add",
      "origin",
      fixture.serverUrl + "/Web/web-store.git",
    ]);
    await fakeCli(
      join(bin, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
    await fakeCli(
      join(bin, "claude"),
      await readFile(resolve("tests/fixtures/subagent-claude.cjs"), "utf8"),
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
      // Quitting while an agent still runs asks first; a failed run shouldn't hang on it.
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    }, repo);
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
    }, fixture.serverUrl);
    await page.reload();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page.getByLabel("Message project").fill("@claude Fan out");
    await page.getByLabel("Message project").press("Enter");
    // Claude's turn ends at once; its agents keep working in the background.
    await expect(
      page.getByText("Three agents are on it.", { exact: true }),
    ).toBeVisible();
    const chip = page.locator(".subagents-chip");
    await expect(chip).toHaveAccessibleName("3 subagents: 0 done, 3 working");
    await expect(chip).toHaveText("0/3");
    // The first to report back moves the count, between turns.
    await expect(chip).toHaveText("1/3");
    await page.screenshot({ path: "test-results/subagents-indicator.png" });

    // The card previews the agent pointed at: its brief and its latest calls.
    await chip.hover();
    const card = page.getByRole("dialog", { name: "Subagents" });
    await expect(card).toContainText("1 of 3 done");
    await card
      .getByRole("button", { name: /Check the phone's turn view/ })
      .hover();
    await expect(card).toContainText("Opus 5.5 · 2 calls");
    await expect(card).toContainText(
      "It reads turns through shared/agent-trace.ts",
    );
    await expect(card).toContainText("Running vitest");
    await card.screenshot({ path: "test-results/subagents-card.png" });

    // Its run covers the conversation, read-only, and can be stopped.
    await card.getByRole("button", { name: "Open its run" }).click();
    const run = page.getByRole("dialog", {
      name: "Agent: Check the phone's turn view",
    });
    await expect(run).toContainText("Claude's brief");
    await expect(run).toContainText(
      "The phone nests subagent calls the same way, through readTurn.",
    );
    await expect(run).toContainText(
      "Read-only. Agents take instructions from Claude, not from you.",
    );
    await page.screenshot({ path: "test-results/subagents-run.png" });
    await run.getByRole("button", { name: "Stop agent" }).click();
    await expect(run).toContainText(
      "Stopped. Claude hears it was and carries on without it.",
    );
    await expect(run.getByRole("button", { name: "Stop agent" })).toHaveCount(
      0,
    );

    // The others started with it are a tab away; a finished one shows its report.
    await run.getByRole("button", { name: "Find where turns render" }).click();
    const report = page.getByRole("dialog", {
      name: "Explore agent: Find where turns render",
    });
    await expect(report).toContainText("Reported to Claude");
    await expect(report).toContainText(
      "and nestSubagents folds a subagent's calls under its row.",
    );
    await page.screenshot({ path: "test-results/subagents-report.png" });

    // Escape goes back to the conversation, which kept its place.
    await page.keyboard.press("Escape");
    await expect(report).toHaveCount(0);
    await expect(
      page.getByText("Three agents are on it.", { exact: true }),
    ).toBeVisible();
    await expect(chip).toHaveText("2/3");
    // Once the last one reports, the indicator goes.
    await expect(chip).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
