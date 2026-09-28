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

test("queues and steers during a turn, stops cleanly, and resumes without consuming a paused queue", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-chat-queue-")),
  );
  const repo = join(root, "project"),
    bin = join(root, "bin"),
    capture = join(root, "agent.jsonl");
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
        RELAY_AGENT_CAPTURE: capture,
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
    const prompt = page.getByLabel("Message project");
    await prompt.fill("wait for cancellation");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCSS("background-color", "rgb(237, 57, 73)");
    await prompt.fill("Check the cache key first");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toHaveCSS("background-color", "rgb(170, 168, 229)");
    await screenshot(page.locator(".composer-tools"), {
      path: "test-results/chat-composer-actions.png",
    });
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const queue = page.getByRole("region", { name: "Queued messages" });
    await expect(queue).toContainText("Check the cache key first");
    await prompt.fill("Then explain the invalidation");
    await prompt.press("Enter");
    await expect(queue.locator(".queued-message")).toHaveCount(2);
    await prompt.fill("Keep this draft too");
    await queue
      .getByRole("button", { name: "Cancel and return to the composer" })
      .last()
      .click();
    await expect(prompt).toContainText("Keep this draft too");
    await expect(prompt).toContainText("Then explain the invalidation");
    await expect(queue.locator(".queued-message")).toHaveCount(1);
    await prompt.fill("Then explain the invalidation");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(queue.locator(".queued-message")).toHaveCount(2);
    // Dragging reorders the queue, both below and above another message.
    const order = () => queue.locator(".queued-message > p").allTextContents();
    const queued = queue.locator(".queued-message");
    const below = (await queued.last().boundingBox())!.height - 4;
    await queued.first().dragTo(queued.last(), {
      targetPosition: { x: 20, y: below },
    });
    await expect
      .poll(order)
      .toEqual(["Then explain the invalidation", "Check the cache key first"]);
    await queued.last().dragTo(queued.first(), {
      targetPosition: { x: 20, y: 4 },
    });
    await expect
      .poll(order)
      .toEqual(["Check the cache key first", "Then explain the invalidation"]);
    await expect(page.getByLabel("Follow-up delivery")).toHaveCount(0);
    await screenshot(page, { path: "test-results/chat-queued.png" });
    await screenshot(queue, { path: "test-results/chat-queue-detail.png" });
    await expect(queue.locator(".chat-queue-hint")).toBeVisible();
    await queue
      .getByRole("button", { name: "Steer now", exact: true })
      .first()
      .click();
    await expect(queue.locator(".queued-message")).toHaveCount(1);
    await expect
      .poll(async () => (await readFile(capture, "utf8")).includes('"steer"'))
      .toBe(true);
    // Escape that closes the command menu doesn't arm the stop button.
    const armed = page.getByRole("button", {
      name: "Press Escape again to stop",
      exact: true,
    });
    await prompt.fill("/");
    await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "Commands" })).toHaveCount(
      0,
    );
    await expect(armed).toHaveCount(0);
    await prompt.fill("");
    // One Escape only arms it, and it disarms on its own.
    await page.keyboard.press("Escape");
    await expect(armed).toHaveText("esc");
    await screenshot(page.locator(".composer-tools"), {
      path: "test-results/chat-stop-armed.png",
    });
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();
    await expect(queue.locator(".queued-message")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(
      page.getByText("Stopped · partial output kept", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("An error occurred in Effect.tryPromise"),
    ).toHaveCount(0);
    await expect(queue).toContainText("Paused");
    await expect(
      page.getByRole("button", { name: "Resume answer", exact: true }),
    ).toBeVisible();
    await screenshot(page, { path: "test-results/chat-stopped.png" });
    await page
      .getByRole("button", { name: "Resume answer", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    await expect(queue).toContainText("Paused");
    await expect(queue.locator(".queued-message")).toHaveCount(1);
    await queue.getByRole("button", { name: "Send now", exact: true }).click();
    await expect(queue).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    const calls = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.filter((c) => c.thread).map((c) => c.method)).toEqual([
      "thread/start",
      "thread/resume",
    ]);
    expect(calls.find((c) => c.interrupt).interrupt.turnId).toBe(
      "fixture-turn",
    );
    expect(calls.filter((c) => c.turn).at(-1).turn.input[0].text).toContain(
      "Then explain the invalidation",
    );
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => !relaySeen(w)),
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
