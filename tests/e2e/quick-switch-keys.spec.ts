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
import { fakeCli, pathWith } from "../fixtures/fake-cli";

const mac = process.platform === "darwin";
const effortUp = mac ? "Meta+Alt+ArrowRight" : "Control+Alt+ArrowRight";
const effortDown = mac ? "Meta+Alt+ArrowLeft" : "Control+Alt+ArrowLeft";
const quickNext = mac
  ? "Control+Meta+ArrowRight"
  : "Control+Alt+Shift+ArrowRight";

test("effort and quick-switch presets step on their own keys", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-quick-")));
  const bin = join(root, "bin");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(bin);
    const script = await readFile(
      resolve("tests/fixtures/room-agent.cjs"),
      "utf8",
    );
    for (const name of ["codex", "claude"])
      await fakeCli(join(bin, name), script);
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
      },
    });
    const page = await app.firstWindow();
    const repo = join(root, "keys-project");
    await mkdir(repo);
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(async () => {
      await window.relay.addProject();
      localStorage.setItem(
        "relay-quick-switch",
        JSON.stringify({
          enabled: true,
          style: "list",
          sound: false,
          presets: [
            { id: "a", provider: "claude", model: "", reasoningEffort: "low" },
            { id: "b", provider: "claude", model: "", reasoningEffort: "max" },
          ],
        }),
      );
    });
    await page.reload();
    await page
      .getByRole("button", { name: "New thread in Keys Project", exact: true })
      .click();
    // The thread starts on Codex; the presets are Claude's.
    const codexEffort = page.getByRole("combobox", {
      name: "Reasoning effort",
      exact: true,
    });
    const claudeEffort = page.getByRole("button", {
      name: "Reasoning effort and context window",
    });
    const model = page.getByRole("button", {
      name: "Choose model and provider",
    });
    const hud = page.locator('.quick-switch-anchor[aria-hidden="false"]');
    await page.getByRole("textbox", { name: "Message project" }).focus();

    const before = await codexEffort.textContent();
    await page.keyboard.press(effortUp);
    await expect(codexEffort).not.toHaveText(before!);
    await expect(hud).toHaveCount(0);

    await page.keyboard.press(quickNext);
    await expect(hud).toHaveCount(1);
    await expect(model).toHaveText(/Claude default/);
    await expect(claudeEffort).toHaveText("Low");
    await page.keyboard.press(quickNext);
    await expect(claudeEffort).toHaveText("Max");

    // Effort still steps on its own with presets set up.
    await page.keyboard.press(effortDown);
    await expect(claudeEffort).toHaveText("Extra high");
    await expect(model).toHaveText(/Claude default/);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
