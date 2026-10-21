import { screenshot } from "../fixtures/screenshot";
import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "../fixtures/electron";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { freePort } from "../fixtures/free-port";

test("a worktree thread goes to another computer from its header, comes back, and carries on here once that computer is gone", async () => {
  test.setTimeout(180_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-handoff-"))),
    bin = join(root, "bin");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
      { cwd, encoding: "utf8" },
    ).trim();
  // One shared remote, cloned by both computers; `me/project` is how they match.
  const origin = join(root, "remote", "me", "project.git");
  await mkdir(origin, { recursive: true });
  git(origin, "init", "--bare", "-q", "-b", "main");
  git(root, "clone", "-q", origin, join(root, "seed"));
  execFileSync("sh", ["-c", "printf '# Cache\\n' > README.md"], {
    cwd: join(root, "seed"),
  });
  git(join(root, "seed"), "add", "-A");
  git(join(root, "seed"), "commit", "-q", "-m", "First");
  git(join(root, "seed"), "push", "-q", "origin", "HEAD:main");
  for (const name of ["laptop", "mini"])
    git(root, "clone", "-q", origin, join(root, name));
  await mkdir(bin);
  for (const cli of ["codex", "claude"])
    await fakeCli(
      join(bin, cli),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
  const env = relayEnv();
  const apps: ElectronApplication[] = [];
  const launch = async (name: string) => {
    const app = await electron.launch({
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, `data-${name}`),
        RELAY_REMOTE_PORT: String(await freePort()),
        // No Tailscale here: loopback stands in for the tailnet.
        RELAY_REMOTE_TAILNET: "127.0.0.1",
      },
    });
    apps.push(app);
    const page = await app.firstWindow();
    await app.evaluate(
      ({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [folder],
        });
      },
      join(root, name),
    );
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    return { app, page };
  };
  try {
    const mini = await launch("mini");
    const laptop = await launch("laptop");

    // The mini accepts connections and shows its link in Settings → Computers.
    const openComputers = async (page: typeof mini.page) => {
      await page.getByRole("button", { name: "Open settings" }).first().click();
      const settings = page.getByRole("region", {
        name: "Settings",
        exact: true,
      });
      await settings
        .getByRole("button", { name: "Computers", exact: true })
        .click();
      return settings;
    };
    const accept = await openComputers(mini.page);
    await accept
      .getByRole("switch", { name: "Accept threads from other computers" })
      .check();
    await accept
      .getByRole("button", { name: "Show pairing link", exact: true })
      .click();
    const link = await accept
      .getByLabel("This computer's pairing link")
      .inputValue();
    // Its tailnet stand-in, after any address on the local network.
    expect(link).toMatch(/^relay-remote:\/\/pair\?h=(?:[^&]*%2C)?127\.0\.0\.1/);

    // A worktree thread on the laptop; the fixture agent edits a file there.
    await laptop.page.getByRole("button", { name: /Current checkout/ }).click();
    await laptop.page
      .getByRole("menuitem", { name: "New worktree", exact: true })
      .click();
    await laptop.page.getByLabel("Message project").fill("fixture edit files");
    await laptop.page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(laptop.page.getByText("needed no change")).toBeVisible();

    // Not paired yet: the header button asks for a computer, and Add a
    // computer pairs one from the link the mini showed.
    await laptop.page
      .getByRole("button", { name: "Hand off to another computer" })
      .click();
    const pick = laptop.page.getByRole("dialog", { name: "Choose a computer" });
    await pick.getByLabel("Computer", { exact: true }).fill(link);
    await pick.getByRole("button", { name: "Check", exact: true }).click();
    // Named after the machine running the test.
    const use = pick.getByRole("button", { name: /^Use / });
    await expect(use).toBeVisible({ timeout: 20_000 });
    await screenshot(pick, { path: "test-results/handoff-paired.png" });
    await use.click();
    await expect(pick).toBeHidden();
    // Picking it opens the hand-off menu; it opens again from the header.
    await laptop.page.keyboard.press("Escape");

    // Now it lists the mini, which has the same repository.
    await laptop.page
      .getByRole("button", { name: "Hand off to another computer" })
      .click();
    const target = laptop.page.getByRole("menuitem", {
      name: /Continues in Mini/,
    });
    await expect(target).toBeVisible({ timeout: 15_000 });
    await screenshot(laptop.page, { path: "test-results/handoff-menu.png" });
    await target.click();

    // Away, the thread follows along live under its composer.
    const live = laptop.page.locator(".handoff-live");
    await expect(live).toContainText("Running on ", { timeout: 60_000 });
    // Settings lists it under the computer it went to.
    await laptop.page
      .getByRole("button", { name: "Open settings" })
      .first()
      .click();
    const listed = laptop.page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await listed
      .getByRole("button", { name: "Computers", exact: true })
      .click();
    await expect(
      listed.getByRole("list", { name: /^Threads on / }),
    ).toContainText("Cache guard behavior", { timeout: 15_000 });
    await screenshot(listed, { path: "test-results/handoff-settings.png" });
    await laptop.page.keyboard.press("Escape");
    await expect(listed).toBeHidden();
    await screenshot(laptop.page, { path: "test-results/handoff-away.png" });

    // The mini has the thread, its agent carried on in a worktree of its own.
    await mini.page.keyboard.press("Escape");
    await mini.page.reload();
    // Titled by the fixture agent's first answer, as on the laptop.
    await expect(
      mini.page.getByRole("button", { name: "Cache guard behavior" }).first(),
    ).toBeVisible({ timeout: 20_000 });
    const miniThread = await mini.page.evaluate(async () => {
      const [project] = await window.relay.projects();
      const chats = await window.relay.projectChats(project!.id);
      return chats.find((c) => c.cameFrom);
    });
    expect(miniThread?.worktree?.path).toBeTruthy();
    expect(
      await readFile(join(miniThread!.worktree!.path!, "src/guard.ts"), "utf8"),
    ).toBe("export const guard = true;\n");

    // Back again: the line goes and the thread says where it was.
    await live.getByRole("button", { name: "Bring back" }).click();
    await expect(live).toBeHidden({ timeout: 60_000 });
    await expect(laptop.page.getByText(/Continued on /).first()).toBeVisible();
    await screenshot(laptop.page, { path: "test-results/handoff-back.png" });

    // Away again, and then the mini is gone: the thread carries on here.
    await laptop.page
      .getByRole("button", { name: "Hand off to another computer" })
      .click();
    await laptop.page
      .getByRole("menuitem", { name: /Continues in Mini/ })
      .click();
    await expect(live).toContainText("Running on ", { timeout: 60_000 });
    await mini.app.close();
    await expect(live).toContainText(" is offline", { timeout: 60_000 });
    await screenshot(laptop.page, {
      path: "test-results/handoff-offline.png",
    });
    await live.getByRole("button", { name: "Run here instead" }).click();
    await expect(live).toBeHidden({ timeout: 30_000 });
    await screenshot(laptop.page, {
      path: "test-results/handoff-run-here.png",
    });
  } finally {
    for (const app of apps) await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
