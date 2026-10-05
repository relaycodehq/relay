import { screenshot } from "../fixtures/screenshot";
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

test("shows a Codex goal above the composer and on its card, and pauses, resumes and clears it", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-goal-")));
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
      await readFile(resolve("tests/fixtures/codex-goal.cjs"), "utf8"),
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
        // Long enough to look at each state.
        RELAY_GOAL_TURNS: "40",
        RELAY_GOAL_TURN_MS: "700",
        RELAY_GOAL_LOG: join(root, "codex.jsonl"),
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
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await mkdir(resolve("test-results/screenshots"), { recursive: true });
    const prompt = page.getByLabel("Message project");
    await prompt.fill(
      "/goal all three fixture files exist and hold their digit",
    );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const strip = page.locator(".goal-strip");
    await expect(strip).toContainText("Pursuing goal");
    await expect(strip).toContainText(
      "all three fixture files exist and hold their digit",
    );
    await expect(strip).toContainText(/\dk tokens/);
    // The thread stays working across the turns Codex starts for the goal.
    await expect(page.getByText("Turn 3 done.", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".sb-status.running")).toHaveAttribute(
      "title",
      /Working on its goal: all three fixture files/,
    );
    await page.getByRole("button", { name: "View activity" }).click();
    await expect(page.locator(".sb-card-state.running")).toContainText("Goal");
    await expect(page.locator(".sb-card-goal")).toContainText(
      "all three fixture files",
    );
    await screenshot(page, {
      path: "test-results/screenshots/goal-running.png",
    });

    await strip.getByRole("button", { name: "Pause" }).click();
    await expect(strip).toContainText("Goal paused");
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0, { timeout: 10000 });
    await expect(strip.getByRole("button", { name: "Resume" })).toBeVisible();
    await expect(page.locator(".queued-message")).toHaveCount(0);
    await screenshot(page, {
      path: "test-results/screenshots/goal-paused.png",
    });

    await strip.getByRole("button", { name: "Resume" }).click();
    await expect(strip).toContainText("Pursuing goal");
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();
    // Resume runs a turn of its own on the composer's settings first.
    const starts = (await readFile(join(root, "codex.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((r) => r.method === "turn/start");
    expect(starts.at(-1).params.input.at(-1).text).toBe(
      "Continue toward the goal.",
    );

    // Stop pauses the goal first, so Codex starts no turn of its own after.
    await page
      .getByRole("button", { name: "Stop answer", exact: true })
      .click();
    await expect(strip).toContainText("Goal paused");
    await expect(strip.getByRole("button", { name: "Clear" })).toBeVisible();
    await strip.getByRole("button", { name: "Clear" }).click();
    await expect(strip).toHaveCount(0, { timeout: 10000 });
    await screenshot(page, {
      path: "test-results/screenshots/goal-cleared.png",
    });
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20 });
  }
});
