import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("new threads start on the repository, and not behind an open dialog", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-scope-")));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    for (const name of ["alpha", "beta"]) {
      const repo = join(root, name);
      await mkdir(repo);
      const git = (...args: string[]) =>
        execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
      git("init", "-q", "-b", "main");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.invalid");
      await writeFile(join(repo, "README.md"), "Example");
      git("add", ".");
      git("commit", "-qm", "Initial");
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, repo);
      await page.evaluate(() => window.relay.addProject());
    }
    await page.reload();
    const context = (name: string) =>
      page.locator(".thread-context-button", { hasText: name });
    const newThread = (name: string) =>
      page
        .getByRole("button", { name: `New thread in ${name}`, exact: true })
        .click();
    // In alpha, write a draft, then turn it into a deep review.
    await newThread("Alpha");
    await page.getByLabel("Message project").fill("Check the queue");
    await context("Deep review").click();
    await expect(context("Deep review")).toHaveClass(/selected/);
    await newThread("Beta");
    await expect(context("Repository")).toHaveClass(/selected/);
    // Its draft card goes back to it as it was left...
    await page.getByRole("button", { name: "View activity" }).click();
    await page
      .locator(".sb-card.draft", { hasText: "Check the queue" })
      .click();
    await expect(page.locator(".project-window-title")).toContainText("Alpha");
    await expect(context("Deep review")).toHaveClass(/selected/);
    await page.getByRole("button", { name: "View activity" }).click();
    // ...while a new thread there, from another project, starts afresh.
    await newThread("Beta");
    await newThread("Alpha");
    await expect(page.locator(".project-window-title")).toContainText("Alpha");
    await expect(context("Deep review")).not.toHaveClass(/selected/);
    await expect(context("Repository")).toHaveClass(/selected/);

    // The new-thread shortcut leaves the workspace alone behind a dialog.
    const changes = page
      .getByRole("group", { name: "Workspace panes" })
      .getByRole("button", { name: "Changes", exact: true });
    await changes.click();
    await expect(changes).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Message project").fill("Later");
    await page.getByRole("button", { name: "Send message" }).click({
      button: "right",
    });
    await page.getByRole("menuitem", { name: "Pick a time…" }).click();
    await expect(page.getByLabel("Send at")).toBeVisible();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+N" : "Control+N",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(changes).toHaveAttribute("aria-pressed", "true");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
