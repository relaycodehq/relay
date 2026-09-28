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

test("shows the context window and compacts the Codex session", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-context-window-")),
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
    await prompt.fill("Explain the cache guard");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toHaveCount(0);
    const meter = page.getByRole("button", {
      name: "Context window, 75% used",
    });
    await expect(meter).toBeVisible();
    await expect(meter).toHaveAttribute("data-pace", "warn");
    await meter.hover();
    const popup = page.locator(".context-meter-popup");
    await expect(popup).toContainText("194k / 258k");
    await expect(popup).toContainText("Total processed412k");
    await page.screenshot({ path: "test-results/context-window-popup.png" });
    await popup.screenshot({
      path: "test-results/context-window-popup-detail.png",
    });
    await popup
      .getByRole("button", { name: "Compact context", exact: true })
      .click();
    await expect(
      page.getByText("Context compacted", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Context window, 7% used" }),
    ).toBeVisible();
    await expect
      .poll(async () => (await readFile(capture, "utf8")).includes('"compact"'))
      .toBe(true);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: "test-results/context-window-compacted.png",
    });
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
