import { screenshot } from "../fixtures/screenshot";
import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

const oauth = (email: string, kind: string) =>
  JSON.stringify({
    oauthAccount: { emailAddress: email, organizationType: kind },
  });

test("picks the account in Settings, switches it from the model picker, and runs the thread's turn signed in as it", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-accounts-")));
  const repo = join(root, "project"),
    bin = join(root, "bin"),
    data = join(root, "data"),
    claudeHome = join(root, "claude-home"),
    capture = join(root, "capture.jsonl");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  await mkdir(repo);
  await mkdir(bin);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "README.md"), "# Accounts\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  const agent = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["codex", "claude"]) await fakeCli(join(bin, name), agent);
  // The usual sign-in, and a second account Relay signed in earlier.
  await mkdir(join(claudeHome, "projects"), { recursive: true });
  await writeFile(
    join(claudeHome, ".claude.json"),
    oauth("you@personal.dev", "claude_max"),
  );
  const work = join(data, "agent-accounts", "claude", "work");
  await mkdir(work, { recursive: true });
  await writeFile(
    join(work, ".claude.json"),
    oauth("you@company.dev", "claude_team"),
  );
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      agentAccounts: {
        accounts: [
          { provider: "claude", id: "default", label: "Personal" },
          { provider: "claude", id: "work", label: "Work" },
        ],
      },
    }),
  );
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
      CODEX_HOME: join(root, "codex-home"),
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

    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .click();
    await page.getByRole("button", { name: "AI models", exact: true }).click();
    const accounts = page.getByRole("region", { name: "Your agents" });
    await expect(accounts.getByText("you@personal.dev")).toBeVisible();
    await expect(accounts.getByText("Team · you@company.dev")).toBeVisible();
    const inUse = accounts.locator(".accounts-row[data-in-use]");
    await expect(inUse).toContainText("Personal");
    // The whole line picks it, not just the radio.
    await accounts.getByText("Team · you@company.dev").click();
    await expect(inUse).toContainText("Work");
    await screenshot(page, {
      path: "test-results/agent-accounts-settings.png",
    });
    await page.getByRole("button", { name: "Back to app" }).click();

    // The picker's footer shows the thread's account and switches it.
    await page.getByLabel("Message project").fill("@claude hello");
    await page
      .getByRole("button", { name: "Choose model and provider" })
      .click();
    const tabs = page.getByRole("radiogroup", { name: "Claude account" });
    await expect(tabs.getByRole("radio", { name: /Work/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await screenshot(page, { path: "test-results/agent-accounts-picker.png" });
    await page.keyboard.press("Escape");
    // Hidden from the bar until the toolbar shows it.
    await expect(
      page.getByRole("button", { name: /Claude account:/ }),
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await readFile(capture, "utf8").catch(() => ""))
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .find((r) => r.provider === "claude" && r.prompt?.includes("hello"))
            ?.claudeConfig,
      )
      .toBe(work);
    // Settings' pick now belongs to the thread; switching in use leaves it be.
    const projectId = await page.evaluate(
      async () => (await window.relay.projects())[0].id,
    );
    await expect
      .poll(async () =>
        page.evaluate(
          async (id) => (await window.relay.projectChats(id))[0]?.accounts,
          projectId,
        ),
      )
      .toEqual({ claude: "work" });
  } finally {
    await app.close();
  }
});
