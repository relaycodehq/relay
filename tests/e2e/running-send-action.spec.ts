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
import { screenshot } from "../fixtures/screenshot";

test("the running-action setting steers with the send key and button, keeps an explicit queue shortcut and survives reload", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-running-action-")),
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
        ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
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
    await page.setViewportSize({ width: 1200, height: 720 });
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
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    const behavior = settings.getByRole("region", {
      name: "While an agent is running",
      exact: true,
    });
    const openSettings = async () => {
      await page.getByRole("button", { name: "Open settings", exact: true }).click();
      await settings
        .getByRole("navigation", { name: "Settings categories" })
        .getByRole("button", { name: "Keyboard shortcuts" })
        .click();
    };
    await openSettings();
    await expect(
      behavior.getByRole("button", { name: "Queue", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await behavior.getByRole("button", { name: "Steer", exact: true }).click();
    await expect(behavior).toContainText(
      "steers the current answer immediately",
    );
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await screenshot(settings, {
        path: `test-results/screenshots/running-send-action-${colorScheme}.png`,
        animations: "disabled",
      });
    }
    await settings.getByRole("button", { name: "Back to app" }).click();
    const prompt = page.getByLabel("Message project");
    const send = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    const queue = page.getByRole("region", { name: "Queued messages" });
    const calls = async () =>
      (await readFile(capture, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((call) => !/relay-helper-/.test(call.cwd));
    const steers = async () =>
      (await calls()).filter((call) => call.steer).length;
    const interruptions = async () =>
      (await calls()).filter((call) => call.interrupt).length;
    const lastSteer = async () =>
      (await calls()).filter((call) => call.steer).at(-1)?.steer.input[0].text;
    // Steer is selected, but idle Enter starts an ordinary answer.
    await prompt.fill("Start normally; wait for cancellation");
    await prompt.press("Enter");
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await steers()).toBe(0);
    // A running Enter hands this message to the active turn without stopping it.
    await prompt.fill("Steer with Enter; wait for cancellation");
    await expect(send).toHaveAttribute("title", /^Steer answer/);
    await prompt.press("Enter");
    await expect.poll(steers).toBe(1);
    await expect.poll(lastSteer).toContain("Steer with Enter");
    await expect(queue).toHaveCount(0);
    await prompt.fill("Steer with the button; wait for cancellation");
    await send.click();
    await expect.poll(steers).toBe(2);
    await expect.poll(lastSteer).toContain("Steer with the button");
    await expect(queue).toHaveCount(0);
    // The alternate shortcut explicitly queues instead of steering.
    await prompt.fill("An explicitly queued follow-up");
    await prompt.press(
      process.platform === "darwin" ? "Meta+Enter" : "Control+Enter",
    );
    await expect(queue).toContainText("An explicitly queued follow-up");
    await expect(queue.locator(".chat-queue-hint")).toContainText(
      process.platform === "darwin"
        ? "⌘↵ to queue · ↵ to steer"
        : "Ctrl+Enter to queue · Enter to steer",
    );
    expect(await steers()).toBe(2);
    // Switching back to Queue updates the already-mounted composer and hints.
    await openSettings();
    await behavior.getByRole("button", { name: "Queue", exact: true }).click();
    await settings.getByRole("button", { name: "Back to app" }).click();
    await prompt.fill("A follow-up with Queue selected");
    await expect(send).toHaveAttribute("title", /^Queue message/);
    await prompt.press("Enter");
    await expect(queue.locator(".queued-message")).toHaveCount(2);
    await expect(queue.locator(".chat-queue-hint")).toContainText(
      process.platform === "darwin"
        ? "↵ to queue · ⌘↵ to steer"
        : "Enter to queue · Ctrl+Enter to steer",
    );
    expect(await steers()).toBe(2);
    await openSettings();
    await behavior.getByRole("button", { name: "Steer", exact: true }).click();
    await settings.getByRole("button", { name: "Back to app" }).click();
    await page.reload();
    await expect(queue).toBeVisible();
    await openSettings();
    await expect(
      behavior.getByRole("button", { name: "Steer", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await settings.getByRole("button", { name: "Back to app" }).click();
    // A queued message's explicit Steer now button steers the same way.
    await queue
      .getByRole("button", { name: "Steer now", exact: true })
      .first()
      .click();
    await expect.poll(steers).toBe(3);
    await expect.poll(lastSteer).toContain("An explicitly queued follow-up");
    await expect(queue.locator(".queued-message")).toHaveCount(1);
    await expect(queue).toContainText("A follow-up with Queue selected");
    expect(await interruptions()).toBe(0);
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
