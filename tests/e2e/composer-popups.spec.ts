import {
  test,
  expect,
  _electron as electron,
  relayEnv,
} from "../fixtures/electron";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("keeps composer popups in view and leaves keyboard focus in the input", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-popups-")));
  const repo = join(root, "repo"),
    bin = join(root, "bin");
  await mkdir(repo);
  await mkdir(bin);
  await writeFile(join(repo, "README.md"), "Sample project");
  execFileSync("git", ["init", "-q", repo]);
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const env = relayEnv();
  const app = await electron.launch({
    env: { ...env, ...pathWith(env, bin), RELAY_TEST_DATA: join(root, "data") },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(900, 600),
    );
    const input = page.getByLabel("Message project");
    for (const [text, selector] of [
      ["/", ".composer-command-menu"],
      ["@README", ".mention-menu"],
      ["/meme ", ".meme-picker"],
    ]) {
      await input.fill(text);
      const popup = page.locator(selector);
      await expect(popup).toBeVisible();
      await expect(input).toBeFocused();
      await expect
        .poll(async () =>
          popup.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return (
              box.left >= 11 &&
              box.top >= 11 &&
              box.right <= innerWidth - 11 &&
              box.bottom <= innerHeight - 11
            );
          }),
        )
        .toBe(true);
      if (text === "/")
        await page.screenshot({
          path: join(tmpdir(), "relay-composer-popups.png"),
        });
      if (text === "@README") {
        // Even an unborn checkout can peek at a file: no HEAD or original is needed.
        await expect(popup.locator(".mention-peek-code")).toContainText(
          "Sample project",
        );
        await expect(popup.locator(".mention-peek-foot")).toHaveText("1 line");
        await page.screenshot({
          path: join(tmpdir(), "relay-mention-peek.png"),
        });
      }
      await input.press("Escape");
      await expect(popup).toHaveCount(0);
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20 });
  }
});
