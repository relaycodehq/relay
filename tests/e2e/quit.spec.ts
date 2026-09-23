import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
  ),
) as Record<string, string>;

test("keeping unsaved code edits cancels a quit without shutting Relay down", async () => {
  const data = await mkdtemp(join(tmpdir(), "relay-quit-data-"));
  const repo = await mkdtemp(join(tmpdir(), "relay-quit-repo-"));
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=Relay test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "Initial",
  ]);
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: { ...env, RELAY_TEST_DATA: data },
  });
  try {
    const page = await app.firstWindow();
    // Electron shows its own unload prompt; keep Playwright from dismissing it.
    page.on("dialog", () => {});
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
      // "Keep editing" in the unsaved-edits prompt.
      dialog.showMessageBoxSync = () => {
        (globalThis as any).keptEditing = true;
        return 0;
      };
    }, repo);
    const project = await page.evaluate(() => window.relay.addProject());
    const chat = await page.evaluate(
      (id) => window.relay.createProjectChat(id, { kind: "project" }),
      project!.id,
    );
    // Stands in for the local editor's guard while it holds unsaved edits.
    await page.evaluate(() =>
      addEventListener("beforeunload", (event) => {
        event.preventDefault();
        event.returnValue = "";
      }),
    );
    // Chromium only asks before unload once the page has had a user gesture.
    await page.mouse.click(5, 5);
    await app.evaluate(({ app }) => app.quit());
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).keptEditing))
      .toBe(true);
    const failure = await page.evaluate(
      ({ chatId, id }) =>
        window.relay
          .sendProjectChat(chatId, {
            id,
            body: "Later",
            sendAt: Date.now() + 60 * 60_000,
            choice: { model: "", fast: false, reasoningEffort: "" },
            provider: "codex",
            runtimeMode: "full-access",
            interactionMode: "default",
          })
          .then(
            () => null,
            (error: Error) => error.message,
          ),
      { chatId: chat.id, id: randomUUID() },
    );
    expect(failure).toBeNull();
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close();
    await rm(data, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});
