import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "../fixtures/electron";
import { mkdtemp, mkdir, readFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { screenshot } from "../fixtures/screenshot";

test("holds a steer for a moment, so × takes it back before the agent gets it", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-steer-hold-")));
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
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data"),
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
    const prompt = page.getByLabel("Message project");
    const queue = page.getByRole("region", { name: "Queued messages" });
    const steers = async () =>
      (await readFile(capture, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((call) => call.steer).length;
    const steerKey = process.platform === "darwin" ? "Meta+Enter" : "Control+Enter";

    await prompt.fill("Start; wait for cancellation");
    await prompt.press("Enter");
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();

    const mine = (text: string) =>
      page.getByRole("article", { name: "Your message" }).filter({ hasText: text });
    // Shown as the steer it becomes, not as a queued message.
    await prompt.fill("Wrong thread, sorry");
    await prompt.press(steerKey);
    const held = mine("Wrong thread, sorry");
    await expect(held.getByRole("status", { name: "Not sent yet" })).toBeVisible();
    await expect(queue).toHaveCount(0);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await screenshot(held, {
        path: `test-results/screenshots/steer-hold-${colorScheme}.png`,
        animations: "disabled",
      });
    }
    await held
      .getByRole("button", { name: "Cancel and return to the composer" })
      .click();
    await expect(held).toHaveCount(0);
    await expect(prompt).toContainText("Wrong thread, sorry");

    // One left alone goes once its moment is over.
    await prompt.fill("Use the other cache");
    await prompt.press(steerKey);
    const kept = mine("Use the other cache");
    await expect(kept.getByRole("status", { name: "Not sent yet" })).toBeVisible();
    await expect.poll(steers).toBe(1);
    await expect(kept).toHaveCount(1);
    await expect(
      kept.getByRole("button", { name: "Cancel and return to the composer" }),
    ).toHaveCount(0);
    expect(await steers()).toBe(1);
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
