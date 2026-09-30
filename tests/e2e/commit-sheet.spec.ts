import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("the commit sheet notices files committed in the background", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-commit-")));
  const repo = join(root, "project"),
    origin = join(root, "origin.git"),
    data = join(root, "data");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", origin);
  await writeFile(join(repo, "README.md"), "# Base\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  git("push", "-qu", "origin", "main");
  for (const f of ["a.txt", "b.txt", "c.txt"])
    await writeFile(join(repo, f), `${f}\n`);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
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

    const open = async () => {
      await page.locator(".git-actions-main").click();
      const sheet = page.getByRole("dialog", { name: "Commit & push" });
      await expect(sheet).toBeVisible();
      return sheet;
    };

    // Part of the selection lands elsewhere; the rest still commits.
    let sheet = await open();
    await expect(sheet.getByText("3 of 3 files")).toBeVisible();
    git("add", "a.txt");
    git("commit", "-qm", "Agent took a");
    await expect(sheet.getByRole("status")).toHaveText(
      "1 file was committed while this was open: Agent took a",
    );
    await expect(sheet.getByText("2 of 2 files")).toBeVisible();
    await sheet.getByLabel("Commit message").fill("Mine");
    await sheet.getByRole("button", { name: /^Commit & push/ }).click();
    await expect(sheet).toBeHidden();
    expect(git("log", "--format=%s", "-3")).toBe("Mine\nAgent took a\nBase");
    expect(git("show", "--name-only", "--format=", "HEAD")).toBe(
      "b.txt\nc.txt",
    );
    expect(git("rev-list", "--count", "@{upstream}..HEAD")).toBe("0");

    // Everything lands elsewhere: the sheet offers the push that's left.
    await writeFile(join(repo, "d.txt"), "d\n");
    sheet = await open();
    await expect(sheet.getByText("1 of 1 file")).toBeVisible();
    git("add", "d.txt");
    git("commit", "-qm", "Agent took d");
    await expect(sheet.getByRole("status")).toHaveText(
      "Already committed while this was open: Agent took d",
    );
    await expect(sheet.getByLabel("Commit message")).toBeHidden();
    await sheet.getByRole("button", { name: "Push", exact: true }).click();
    await expect(sheet).toBeHidden();
    expect(git("rev-list", "--count", "@{upstream}..HEAD")).toBe("0");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
