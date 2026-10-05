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

test("restores per-project composer settings, answers native approvals, and implements a plan in Build mode", async () => {
  test.setTimeout(100000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-composer-modes-")),
  );
  const fixture = await fixtureServer();
  const bin = join(root, "bin"),
    capture = join(root, "capture.jsonl");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(bin);
    const script = await readFile(
      resolve("tests/fixtures/room-agent.cjs"),
      "utf8",
    );
    for (const name of ["codex", "claude"])
      await fakeCli(join(bin, name), script);
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
          RELAY_TEST_DATA: join(root, "data"),
          RELAY_TEST_HEADED: "0",
          RELAY_TEST_NATIVE_STORAGE: "0",
          RELAY_AGENT_CAPTURE: capture,
        },
      });
    app = await launch();
    let page = await app.firstWindow();
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
    }, fixture.serverUrl);
    for (const name of ["web-store", "personal-project"]) {
      const repo = join(root, name);
      await mkdir(repo);
      execFileSync("git", ["init", "-q", "-b", "main", repo]);
      await writeFile(join(repo, "README.md"), "# Fixture project\n");
      execFileSync("git", ["-C", repo, "add", "."]);
      execFileSync("git", [
        "-C",
        repo,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-qm",
        "Initial",
      ]);
      await app.evaluate(({ dialog }, repo) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [repo],
        });
      }, repo);
      await page.evaluate(async () => {
        await window.relay.addProject();
      });
    }
    await page.reload();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    // A project's name only folds its row; its new thread opens it.
    await page
      .getByRole("button", { name: "New thread in Web Store", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Runtime mode", exact: true }),
    ).toHaveText("Full access");
    await page
      .getByRole("combobox", { name: "Runtime mode", exact: true })
      .click();
    await expect(page.getByRole("option")).toHaveCount(4);
    await screenshot(page, { path: "test-results/composer-runtime-menu.png" });
    await page.getByRole("option", { name: /Auto-accept edits/ }).click();
    await page
      .getByRole("button", { name: "Mode: Build", exact: true })
      .click();
    await expect(page.getByRole("menuitemradio")).toHaveCount(3);
    await page.getByRole("menuitemradio", { name: /^Plan/ }).click();
    await page.getByRole("button", { name: "Fast mode", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Reasoning effort", exact: true })
      .click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    // A project's name only folds its row; its new thread opens it.
    await page
      .getByRole("button", {
        name: "New thread in Personal Project",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Runtime mode", exact: true }),
    ).toHaveText("Full access");
    await expect(
      page.getByRole("button", { name: "Mode: Build", exact: true }),
    ).toBeVisible();
    // A project's name only folds its row; its new thread opens it.
    await page
      .getByRole("button", { name: "New thread in Web Store", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Runtime mode", exact: true }),
    ).toHaveText("Auto-accept edits");
    await expect(
      page.getByRole("button", { name: "Mode: Plan", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Reasoning effort", exact: true }),
    ).toHaveText("High");
    await expect(
      page.getByRole("button", { name: "Fast mode", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByRole("combobox", { name: "Runtime mode", exact: true }),
    ).toHaveText("Auto-accept edits");
    await expect(
      page.getByRole("button", { name: "Mode: Plan", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page.getByLabel("Message project").fill("fixture request approval");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const approval = page.getByRole("region", { name: "Run this command?" });
    await expect(approval).toBeVisible();
    await expect(approval).toContainText("npm test");
    await expect(
      approval.getByRole("button", { name: "Decline", exact: true }),
    ).toBeVisible();
    await expect(
      approval.getByRole("button", { name: "Always", exact: true }),
    ).toBeVisible();
    await approval
      .getByRole("button", { name: "More approval options" })
      .click();
    await expect(page.getByRole("menuitem", { name: "Cancel" })).toBeVisible();
    await screenshot(page, { path: "test-results/composer-approval.png" });
    await page.keyboard.press("Escape");
    await approval.getByRole("button", { name: "Once", exact: true }).click();
    await expect(approval).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Message project").fill("fixture ask question");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const questions = page.getByRole("region", {
      name: "Codex needs your input",
    });
    await expect(questions).toBeVisible();
    await expect(
      questions.getByRole("button", { name: "Continue", exact: true }),
    ).toBeDisabled();
    await screenshot(page, {
      path: "test-results/composer-planning-question.png",
    });
    await questions.getByRole("button", { name: /Small change/ }).click();
    await expect(
      page.getByRole("button", { name: "Implement plan", exact: true }),
    ).toBeVisible();
    await screenshot(page, { path: "test-results/composer-proposed-plan.png" });
    await page
      .getByRole("button", { name: "Implement plan", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Mode: Build", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    const calls = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      calls
        .filter(
          (c) =>
            c.turn &&
            !c.turn.input[0].text.startsWith("Generate a short title"),
        )
        .at(-1).turn.collaborationMode.mode,
    ).toBe("default");
    // Also exercise the bundled ESM SDK inside the actual Electron main process.
    await page
      .getByLabel("Message project")
      .fill("@claude fixture request approval");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    // Codex answered last, so the switch warns and Codex writes a handoff note.
    const switching = page.getByRole("dialog", {
      name: "Switch to Claude?",
      exact: true,
    });
    await expect(switching).toBeVisible();
    await screenshot(page, { path: "test-results/agent-switch-dialog.png" });
    await switching.getByLabel("Don’t show this again").check();
    await switching
      .getByRole("button", { name: "Switch to Claude", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({
        hasText: "Switched from Codex to Claude",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show note", exact: true }).click();
    await screenshot(page, { path: "test-results/agent-handoff-row.png" });
    const claude = page.getByRole("region", { name: "Allow Bash?" });
    await expect(claude).toBeVisible();
    await claude.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(claude).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => !relaySeen(w)),
      ),
    ).toBe(true);
    // Plan was for the thread it started; the project's next one starts in
    // Build, still on its runtime mode.
    await page
      .getByRole("button", { name: "New thread in Web Store", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Mode: Build", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Runtime mode", exact: true }),
    ).toHaveText("Auto-accept edits");
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
