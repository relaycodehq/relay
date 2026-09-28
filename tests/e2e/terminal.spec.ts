import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("a thread's terminal runs in its folder and follows the thread", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-terminal-")));
  const repo = join(root, "project"),
    bin = join(root, "bin"),
    data = join(root, "data");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  await mkdir(repo);
  await mkdir(bin);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "README.md"), "# Cache\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const toggle = process.platform === "darwin" ? "Meta+J" : "Control+Backquote";
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();

    const button = page.getByRole("button", { name: "Terminal", exact: true });
    const drawer = page.getByRole("region", { name: "Terminal" });
    const screen = drawer.locator(".xterm-rows");
    const run = async (command: string) => {
      await page.keyboard.type(command);
      await page.keyboard.press("Enter");
    };

    // An unsent thread in the checkout opens its shell there.
    await button.click();
    await expect(drawer).toBeVisible();
    await expect(drawer.locator(".terminal-drawer-cwd")).toHaveText("project");
    await run("echo relay-$((40+2)) npm-vars-$(env | grep -c ^npm_) && pwd");
    await expect(screen).toContainText("relay-42 npm-vars-0");
    await expect(screen).toContainText(repo);

    // A server started in it is listed as the terminal's.
    await run(
      `${JSON.stringify(process.execPath)} -e "require('http').createServer().listen(0);setInterval(()=>{},1000)"`,
    );
    const running = page.getByRole("complementary", {
      name: "Running processes",
    });
    await expect(
      running.locator('li[title*="In a Relay terminal"]'),
    ).toHaveCount(1, { timeout: 20000 });
    await page.screenshot({ path: "test-results/terminal-draft.png" });

    // The first message makes the thread, which keeps the draft's shell.
    await page.getByLabel("Message project").fill("hello");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests."),
    ).toBeVisible();
    await expect(drawer).toBeVisible();
    await expect(screen).toContainText("relay-42");
    await expect(running.locator('li[title*="Terminal · "]')).toHaveCount(1, {
      timeout: 20000,
    });

    // The shortcut hides it; the screen is still there when it comes back.
    await drawer.locator(".xterm-screen").click();
    await page.keyboard.press(toggle);
    await expect(drawer).toBeHidden();
    await page.keyboard.press(toggle);
    await expect(drawer).toBeVisible();
    await expect(screen).toContainText("relay-42");
    // Stopping it in the terminal takes it off the list.
    await page.keyboard.press("Control+C");
    await expect(running.locator('li[title*="Terminal · "]')).toHaveCount(0, {
      timeout: 20000,
    });

    // A new thread in a worktree has no folder until its first message.
    await page.getByLabel("Message project").click();
    await page.keyboard.press(`${mod}+N`);
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: /Project folder/ }).click();
    await page.getByRole("menuitem", { name: "New worktree" }).click();
    await expect(button).toBeDisabled();
    await page.getByLabel("Message project").fill("fixture edit files");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByText("needed no change")).toBeVisible();

    // Then its terminal opens in the worktree.
    await expect(button).toBeEnabled();
    await button.click();
    await expect(drawer.locator(".terminal-drawer-where")).toHaveText(
      "worktree",
    );
    await run("pwd");
    await expect(screen).toContainText(
      join(data, "worktrees", "project", "fixture-edit-files"),
    );
    await page.screenshot({ path: "test-results/terminal-worktree.png" });

    // A reloaded window finds the shell still running, with what it printed.
    await run("echo before-$((6*7))-reload");
    await expect(screen).toContainText("before-42-reload");
    await page.reload();
    await button.click();
    await expect(screen).toContainText("before-42-reload");
    await run("echo after-$((6*7))-reload");
    await expect(screen).toContainText("after-42-reload");
  } finally {
    await app.close();
  }
});
