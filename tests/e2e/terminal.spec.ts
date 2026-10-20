import { screenshot } from "../fixtures/screenshot";
import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
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
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: data,
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

    // More shells open as tabs beside it; closing one ends only that shell.
    await drawer
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await expect(drawer.getByRole("tab")).toHaveText([
      "Terminal",
      "Terminal 2",
    ]);
    await run("echo second-$((1+1))");
    await expect(screen).toContainText("second-2");
    await drawer
      .getByRole("button", { name: "Close terminal 2", exact: true })
      .click();
    await expect(drawer.getByRole("tab")).toHaveText(["Terminal"]);
    await expect(screen).toContainText("relay-42 npm-vars-0");
    await drawer.locator(".xterm-screen").click();

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
    await screenshot(page, { path: "test-results/terminal-draft.png" });

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
    await page.getByRole("button", { name: /Current checkout/ }).click();
    await page
      .getByRole("menuitem", { name: "New worktree", exact: true })
      .click();
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
    await screenshot(page, { path: "test-results/terminal-worktree.png" });

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

test("terminal resizing starts at its visible height in a shorter window", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-terminal-resize-")),
  );
  const repo = join(root, "project");
  await mkdir(repo);
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    const button = page.getByRole("button", { name: "Terminal", exact: true });
    const drawer = page.getByRole("region", { name: "Terminal" });
    // A height saved in a taller window is clamped by the layout. The first
    // drag must start at the visible divider, without a dead zone or jump.
    await page.evaluate(() =>
      localStorage.setItem("relay-terminal-height", "1400"),
    );
    await page.reload();
    await button.click();
    await expect(drawer).toBeVisible();
    const divider = page.getByRole("separator", { name: "Resize terminal" });
    const box = (await divider.boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const delta of [10, 40, 80, 40, 10]) {
      await page.mouse.move(x, y + delta);
      await expect
        .poll(async () => (await divider.boundingBox())!.y)
        .toBeCloseTo(box.y + delta, 0);
    }
    await page.mouse.up();
    // Keyboard resizing uses the same visible starting point.
    await divider.press("ArrowDown");
    await expect
      .poll(async () => (await divider.boundingBox())!.y)
      .toBeCloseTo(box.y + 30, 0);
    await divider.dblclick();
    await expect
      .poll(async () => (await drawer.boundingBox())!.height)
      .toBe(260);
  } finally {
    await app.close();
  }
});

test("selecting in the terminal copies, and right-click pastes", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-terminal-clipboard-")),
  );
  const repo = join(root, "project");
  await mkdir(repo);
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
    },
  });
  // The system clipboard is shared with whoever runs the test.
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  const clipboardText = () =>
    app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    const drawer = page.getByRole("region", { name: "Terminal" });
    const screen = drawer.locator(".xterm-rows");
    await expect(drawer).toBeVisible();
    await page.keyboard.type("echo copy-me-$((40+2))");
    await page.keyboard.press("Enter");
    const line = screen.locator("> div", { hasText: /^copy-me-42\s*$/ });
    await expect(line).toBeVisible();

    const box = (await line.boundingBox())!;
    await page.mouse.dblclick(box.x + 4, box.y + box.height / 2);
    await expect.poll(clipboardText).toBe("copy-me-42");

    // With a selection, right-click copies it and lets it go.
    await app.evaluate(({ clipboard }) => clipboard.writeText("stale"));
    await page.mouse.click(box.x + 4, box.y + box.height / 2, {
      button: "right",
    });
    await expect.poll(clipboardText).toBe("copy-me-42");
    await expect(drawer.locator(".xterm-selection div")).toHaveCount(0);

    // Without one, it pastes at the prompt.
    await app.evaluate(({ clipboard }) =>
      clipboard.writeText("echo pasted-$((6*7))"),
    );
    await page.mouse.click(box.x + 4, box.y + box.height / 2, {
      button: "right",
    });
    await page.keyboard.press("Enter");
    await expect(screen).toContainText("pasted-42");
  } finally {
    await app.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      saved,
    );
    await app.close();
  }
});
