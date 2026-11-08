import { screenshot } from "../fixtures/screenshot";
import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "../fixtures/electron";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("a message sent while a stopped agent winds down shows until it lands", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-send-after-stop-")),
  );
  const repo = join(root, "project"),
    bin = join(root, "bin"),
    gate = join(root, "gate"),
    release = join(gate, "release");
  const fixture = await fixtureServer();
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    await mkdir(bin);
    await mkdir(gate);
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
    const env = relayEnv();
    app = await electron.launch({
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data"),
        // The agent lets go of a stopped turn only once this file is written.
        RELAY_FIXTURE_STOP_RELEASE: release,
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
    await prompt.press("Enter");
    // Stopped before the agent has its turn, there's nothing to wind down.
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Stop answer", exact: true })
      .click();
    await prompt.fill("Carry on with the cache key");
    await prompt.press("Enter");
    const sending = page.locator(".held-send");
    await expect(sending).toContainText("Carry on with the cache key");
    await expect(sending).toContainText("Sends once the agent has stopped…");
    await screenshot(page, { path: "test-results/send-after-stop.png" });
    await writeFile(release, "");
    await expect(sending).toHaveCount(0);
    await expect(
      page.locator(".project-message").filter({
        hasText: "Carry on with the cache key",
      }),
    ).toHaveCount(1);
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
