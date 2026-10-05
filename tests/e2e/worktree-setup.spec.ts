import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { screenshot } from "../fixtures/screenshot";

// A project's worktree setup, typed in its settings: it runs in a new
// worktree before the first answer, shows what it printed, and a failed one
// runs again from its line.
test.setTimeout(90_000);

test("a worktree's setup runs before the first answer and runs again from its line", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-setup-")));
  const repo = join(root, "shop"),
    bin = join(root, "bin"),
    data = join(root, "data");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  await mkdir(repo);
  await mkdir(bin);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "README.md"), "# Shop\n");
  await writeFile(join(repo, ".gitignore"), ".env\n");
  await writeFile(join(repo, ".worktreeinclude"), ".env\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  await writeFile(join(repo, ".env"), "SECRET=1\n");
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const project = {
    id: randomUUID(),
    path: repo,
    name: "Shop",
    repository: null,
    added: 1,
  };
  await mkdir(data);
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      sidebarView: "threads",
      projects: [project],
      chats: [],
    }),
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
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });

    await page
      .getByRole("button", { name: "Project actions for Shop" })
      .click();
    await page.getByRole("menuitem", { name: "Project settings" }).click();
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("combobox", { name: "Where new threads start" })
      .click();
    await page.getByRole("option", { name: /New worktree/ }).click();
    // Fails the first time, passes once it ran before.
    const marker = join(root, "setup-ran");
    const command = `echo "port +$RELAY_PORT_OFFSET"; [ -f ${marker} ] || { touch ${marker}; echo "registry timed out" >&2; exit 2; }`;
    const field = settings.getByRole("textbox", { name: "Setup command" });
    await field.fill(command);
    await field.blur();
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.relay.projects()).find((p) => p.id === id)?.settings,
          project.id,
        ),
      )
      .toEqual({ workspace: "worktree", worktreeSetup: command });
    await field.scrollIntoViewIfNeeded();
    await screenshot(page, {
      path: "test-results/screenshots/worktree-setup-settings.png",
    });

    await page.getByRole("button", { name: "Back to app" }).click();
    await page.getByRole("button", { name: "New thread in Shop" }).click();
    await page.getByLabel("Message project").fill("fixture edit files");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();

    const row = page.locator(".worktree-command");
    await expect(row).toContainText("Worktree setup failed (exit 2)");
    // The answer came anyway, after setup.
    await expect(page.getByText("needed no change")).toBeVisible();
    await row.getByRole("button", { name: "Show output" }).click();
    const output = row.getByLabel("Setup output");
    await expect(output).toContainText("Copied from the project folder: .env");
    await expect(output).toContainText("port +10");
    await expect(output).toContainText("registry timed out");
    await screenshot(page, {
      path: "test-results/screenshots/worktree-setup-failed.png",
    });

    const folder = join(data, "worktrees", "shop");
    const [leaf] = await readdir(folder);
    expect(await readFile(join(folder, leaf, ".env"), "utf8")).toBe(
      "SECRET=1\n",
    );

    await row.getByRole("button", { name: "Run setup again" }).click();
    await expect(row).toContainText("Worktree set up");
    await expect(
      row.getByRole("button", { name: "Run setup again" }),
    ).toHaveCount(0);
    await screenshot(page, {
      path: "test-results/screenshots/worktree-setup-rerun.png",
    });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
