import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { writeStoredCodexSession } from "../fixtures/codex-store";
import { screenshot } from "../fixtures/screenshot";

test("/resume chatgpt imports a saved desktop chat, forks on send and reopens the same thread", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-resume-app-")),
  );
  const repo = join(root, "project");
  const home = join(root, "codex");
  const bin = join(root, "bin");
  const capture = join(root, "capture.jsonl");
  await mkdir(repo);
  await mkdir(bin);
  execFileSync("git", ["init", "-q", repo]);
  const agent = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["claude", "codex"]) await fakeCli(join(bin, name), agent);
  const id = "desktop-chat-01";
  const { path: history } = await writeStoredCodexSession(
    home,
    repo,
    id,
    [
      {
        prompt: "How does the release script work?",
        answer: "It signs the build; publishing is a separate step.",
      },
    ],
    { name: "Inspect release script", ago: 60 * 86_400_000 },
  );
  await writeStoredCodexSession(
    home,
    repo,
    "terminal-chat-01",
    [{ prompt: "Only from the CLI", answer: "Terminal answer" }],
    { originator: "codex-tui", name: "CLI chat" },
  );
  await writeStoredCodexSession(home, repo, "missing-chat-01", [], {
    name: "Deleted history",
  });
  await writeStoredCodexSession(home, root, "other-chat-01", [
    { prompt: "Another project", answer: "Other answer" },
  ]);
  const original = await readFile(history);
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
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      RELAY_AGENT_CAPTURE: capture,
      CODEX_HOME: home,
      CLAUDE_CONFIG_DIR: join(root, "claude"),
    },
  });
  let diagnostics = "";
  app.process().stderr?.on("data", (chunk) => {
    diagnostics += String(chunk);
  });
  app.process().stdout?.on("data", (chunk) => {
    diagnostics += String(chunk);
  });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => {
      diagnostics += error.message;
    });
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    const composer = page.getByLabel("Message project");
    const popup = page.getByRole("listbox", { name: "Commands" });
    const rows = popup.getByRole("option");
    await composer.fill("/resume codex terminal");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("CLI chat");
    await composer.fill("/resume chatgpt");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Inspect release script");
    await expect(rows).toContainText("from the Codex app, continues as a copy");
    await screenshot(page, {
      path: join(tmpdir(), "relay-resume-chatgpt-picker.png"),
    });
    await rows.click();
    await expect(popup).toHaveCount(0);
    await expect(
      page.getByText("It signs the build; publishing is a separate step.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Forked from a Codex app session · the app keeps the original",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await readFile(history)).toEqual(original);
    await screenshot(page, {
      path: join(tmpdir(), "relay-resume-chatgpt-imported.png"),
    });

    await composer.fill("@codex Carry on with the release");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const calls = async () =>
      (await readFile(capture, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    await expect
      .poll(
        async () =>
          (await calls()).find((c) => c.method === "thread/fork")?.thread,
      )
      .toMatchObject({ threadId: id, lastTurnId: "turn-0" });
    await expect
      .poll(async () => (await calls()).find((c) => c.turn)?.turn.input)
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining("Carry on with the release"),
          }),
        ]),
      );
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "New thread", exact: true })
      .first()
      .click();
    await composer.fill("/resume chatgpt");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("in Relay");
    await rows.click();
    await expect(
      page
        .locator(".project-message")
        .filter({ hasText: "Carry on with the release" }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const [project] = await window.relay.projects();
        return (await window.relay.projectChats(project!.id)).length;
      }),
    ).toBe(1);
  } catch (error) {
    const page = app.windows()[0];
    if (page && !page.isClosed()) {
      console.error(await page.locator("body").innerText());
      await page.screenshot({
        path: join(tmpdir(), "relay-resume-chatgpt-failure.png"),
      });
    }
    console.error(diagnostics);
    throw error;
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
