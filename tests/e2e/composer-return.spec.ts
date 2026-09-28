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
import { fixtureServer } from "../fixtures/gitea";

test("a message cancelled back to its side conversation reopens there with its settings", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-return-")));
  const fixture = await fixtureServer();
  const bin = join(root, "bin"),
    repo = join(root, "web-store");
  const app = await (async () => {
    await mkdir(bin);
    await writeFile(
      join(bin, "codex"),
      `#!${process.execPath}\n` +
        (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
      { mode: 0o700 },
    );
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
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    return electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        // No Claude CLI: its models stay unlisted and nothing reaches it.
        PATH: bin + ":/usr/bin:/bin:/usr/sbin:/sbin",
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
  })();
  try {
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
      .locator(".sb-project-row")
      .getByRole("button", { name: "Web Store", exact: true })
      .click();
    const input = page.getByLabel("Message project");
    const picker = page.getByRole("button", {
      name: "Choose model and provider",
    });
    const traits = page.getByRole("button", {
      name: "Reasoning effort and context window",
    });
    await input.click();
    await input.fill("Where is the cache guard?");
    await input.press("Enter");
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(picker).toContainText("Codex default");
    await page
      .locator(".project-message.assistant")
      .getByRole("button", { name: "Reply to message" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Side conversation" }),
    ).toBeVisible();
    for (const command of [
      "/provider claude",
      "/model claude-sonnet-4-6",
      "/effort high",
    ]) {
      await input.fill(command);
      await input.press("Enter");
    }
    await expect(picker).toContainText("claude-sonnet-4-6");
    await expect(traits).toContainText("High");
    await input.fill("Check the cache key");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: /In 1 hour/ }).click();
    const scheduled = page.getByRole("region", { name: "Scheduled messages" });
    await scheduled
      .getByRole("button", { name: "Cancel and return to the composer" })
      .click();
    await expect(input).toContainText("Check the cache key");
    // Claude's model and effort, not its defaults.
    await expect(picker).toContainText("claude-sonnet-4-6");
    await expect(traits).toContainText("High");
    await input.fill("/provider codex");
    await input.press("Enter");
    await expect(picker).toContainText("Codex default");
    // The thread's own composer never saw the reply's settings.
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await expect(picker).toContainText("Codex default");
  } finally {
    await app.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
