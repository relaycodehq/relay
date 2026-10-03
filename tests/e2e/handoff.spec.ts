import { screenshot } from "../fixtures/screenshot";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

test("a worktree thread goes to another computer from its header and comes back from its strip", async () => {
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
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const apps: ElectronApplication[] = [];
  const launch = async (name: string) => {
    const app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, `data-${name}`),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
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
    expect(link).toMatch(/^relay-remote:\/\/pair\?h=127\.0\.0\.1/);

    // A worktree thread on the laptop; the fixture agent edits a file there.
    await laptop.page.getByRole("button", { name: /Project folder/ }).click();
    await laptop.page.getByRole("menuitem", { name: "New worktree" }).click();
    await laptop.page.getByLabel("Message project").fill("fixture edit files");
    await laptop.page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(laptop.page.getByText("needed no change")).toBeVisible();

    // Not paired yet: the header button opens Settings → Computers.
    await laptop.page
      .getByRole("button", { name: "Hand off to another computer" })
      .click();
    const pair = laptop.page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await pair.getByLabel("Pairing link").fill(link);
    await pair.getByRole("button", { name: "Pair", exact: true }).click();
    // The map draws the paired computer, and its card opens below.
    await expect(
      pair.getByRole("group", { name: "Your computers" }).getByRole("button", {
        name: /Connected/,
      }),
    ).toBeVisible({ timeout: 20_000 });
    await screenshot(pair, { path: "test-results/handoff-paired.png" });
    await laptop.page.keyboard.press("Escape");
    await expect(pair).toBeHidden();

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

    const strip = laptop.page.locator(".handoff-strip");
    await expect(strip).toContainText(/finished|Working on/, {
      timeout: 60_000,
    });
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
    await expect(laptop.page.getByLabel("Message project")).toHaveAttribute(
      "data-placeholder",
      /This thread is on /,
    );
    await screenshot(laptop.page, { path: "test-results/handoff-away.png" });

    // The mini has the thread, its agent carried on in a worktree of its own.
    await mini.page.keyboard.press("Escape");
    await mini.page.reload();
    // Titled by the fixture agent's first answer, as on the laptop.
    await expect(
      mini.page.getByRole("button", { name: "Cache guard behavior" }),
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

    // Back again: the strip goes and the composer opens.
    await expect(strip).toContainText("finished", { timeout: 60_000 });
    await strip.getByRole("button", { name: "Bring back" }).click();
    await expect(strip).toBeHidden({ timeout: 60_000 });
    await expect(laptop.page.getByLabel("Message project")).not.toHaveAttribute(
      "data-placeholder",
      /This thread is on /,
    );
    await expect(
      laptop.page.getByText(/Handoff note for /).first(),
    ).toBeVisible();
    await screenshot(laptop.page, { path: "test-results/handoff-back.png" });

    // Away again, but this time the mini can't hand it back: take it back without it.
    await laptop.page
      .getByRole("button", { name: "Hand off to another computer" })
      .click();
    await laptop.page
      .getByRole("menuitem", { name: /Continues in Mini/ })
      .click();
    await expect(strip).toContainText(/finished|Working on/, {
      timeout: 60_000,
    });
    await strip
      .getByRole("button", { name: "Take it back without Mini" })
      .click();
    const confirm = laptop.page.getByRole("dialog", {
      name: "Take it back without Mini?",
    });
    await expect(confirm).toContainText("stays there, on its branch");
    await screenshot(laptop.page, {
      path: "test-results/handoff-abandon-confirm.png",
    });
    await confirm.getByRole("button", { name: "Take it back" }).click();
    await expect(strip).toBeHidden({ timeout: 30_000 });
    await expect(laptop.page.getByLabel("Message project")).not.toHaveAttribute(
      "data-placeholder",
      /This thread is on /,
    );
    await screenshot(laptop.page, {
      path: "test-results/handoff-abandoned.png",
    });

    // The mini hears it and stops owing the thread: its newest copy says so.
    await mini.page.reload();
    await mini.page
      .getByRole("button", { name: "Cache guard behavior" })
      .first()
      .click();
    const released = mini.page.getByText(/took the thread back/);
    await expect(released).toBeVisible({ timeout: 30_000 });
    await screenshot(mini.page, {
      path: "test-results/handoff-abandoned-there.png",
    });
  } finally {
    for (const app of apps) await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
