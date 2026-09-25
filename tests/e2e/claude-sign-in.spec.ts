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

test("an expired Claude login offers its sign-in command in the thread's terminal", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-claude-sign-in-")),
  );
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
  const agent =
    `#!${process.execPath}\n` +
    (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"));
  for (const name of ["codex", "claude"])
    await writeFile(join(bin, name), agent, { mode: 0o700 });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      PATH: bin + ":" + env.PATH,
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
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
    await page.reload();

    await page.getByLabel("Message project").fill("@claude fixture signed out");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByText("Claude is signed out.")).toBeVisible();
    const signIn = page.getByRole("button", {
      name: "Sign in to Claude in the terminal",
    });
    const drawer = page.getByRole("region", { name: "Terminal" });
    const screen = drawer.locator(".xterm-rows");
    await expect(drawer).toBeHidden();

    // Typed at the prompt for the user to run, not run for them.
    await signIn.click();
    await expect(drawer).toBeVisible();
    await expect(screen).toContainText(`${join(bin, "claude")} auth login`);
    await page.screenshot({ path: "test-results/claude-sign-in.png" });
    await page.keyboard.press("Control+U");
    await page.keyboard.type("echo prompt-$((40+2))");
    await page.keyboard.press("Enter");
    await expect(screen).toContainText("prompt-42");

    // A command holding the shell would read the line, so it isn't typed.
    await page.keyboard.type("sleep 30");
    await page.keyboard.press("Enter");
    await signIn.click();
    await expect(page.getByText("The terminal is busy.")).toBeVisible();
    await expect(screen).not.toContainText("auth login");
  } finally {
    await app.close();
  }
});
