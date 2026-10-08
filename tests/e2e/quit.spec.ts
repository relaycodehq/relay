import {
  test,
  expect,
  chromium,
  _electron as electron,
} from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const electronPath = createRequire(import.meta.url)("electron") as string;

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

test("dev IPC keeps unsaved edits on cancellation, then quits cleanly on retry", async () => {
  const data = await mkdtemp(join(tmpdir(), "relay-dev-quit-"));
  const launch = join(data, "launch.cjs");
  await writeFile(
    launch,
    `
    const { dialog } = require('electron');
    dialog.showMessageBoxSync = () => {
      process.send({type:'test:kept-editing'});
      return 0;
    };
    process.on('message', message => {
      if(message.type === 'test:discard') {
        dialog.showMessageBoxSync = () => 1;
        process.send({type:'test:discard-ready'});
      }
    });
    require(${JSON.stringify(join(process.cwd(), "tests/fixtures/launch.cjs"))});
  `,
  );
  const child = spawn(electronPath, ["--remote-debugging-port=0", launch], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...env,
      RELAY_TEST_DATA: data,
      RELAY_DEV_STALE: join(data, "stale.json"),
    },
  });
  const messages: string[] = [];
  let debugUrl = "";
  child.on("message", (message) =>
    messages.push((message as { type: string }).type),
  );
  child.stdout!.resume();
  child.stderr!.on("data", (data) => {
    const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) debugUrl = match[1]!;
  });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    await expect.poll(() => debugUrl).toMatch(/^ws:\/\//);
    browser = await chromium.connectOverCDP(debugUrl);
    await expect.poll(() => messages).toContain("relay:dev-ready");
    const page = browser.contexts()[0]!.pages()[0]!;
    // Electron owns the unload dialog; don't let CDP dismiss it.
    page.on("dialog", () => {});
    await page.waitForLoadState();
    await page.evaluate(() => {
      (window as any).unsavedBuffer = "keep this edit";
      addEventListener("beforeunload", (event) => {
        event.preventDefault();
        event.returnValue = "";
      });
    });
    await page.mouse.click(5, 5);
    child.send({ type: "relay:dev-stop" });
    await expect.poll(() => messages).toContain("relay:dev-cancelled");
    expect(messages).toContain("test:kept-editing");
    expect(await page.evaluate(() => (window as any).unsavedBuffer)).toBe(
      "keep this edit",
    );
    expect(child.exitCode).toBeNull();
    child.send({ type: "test:discard" });
    await expect.poll(() => messages).toContain("test:discard-ready");
    const exited = new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );
    child.send({ type: "relay:dev-stop" });
    expect(await exited).toBe(0);
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null && !child.signalCode) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }
    await rm(data, { recursive: true, force: true });
  }
});
