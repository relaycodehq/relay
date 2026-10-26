import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openSurface } from "../fixtures/navigation";
import { screenshot } from "../fixtures/screenshot";

test("the editor's Changes view opens changed files inline, deleted ones read-only, commits, and History opens a commit's version", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-editor-changes-"))),
    repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(bin);
  await writeFile(join(repo, "src/a.ts"), "export const a = 1;\nexport const keep = 0;\n");
  await writeFile(join(repo, "src/gone.ts"), "export const gone = true;\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
  await writeFile(join(repo, "src/a.ts"), "export const a = 2;\nexport const keep = 0;\n");
  await rm(join(repo, "src/gone.ts"));
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
    page.on("dialog", () => {});
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page.getByLabel("Message project").fill("hello");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await openSurface(page, "Files");

    const sidebar = page.locator(".project-file-list");
    await sidebar.getByRole("tab", { name: /^Changes/ }).click();
    await expect(sidebar.getByRole("tab", { name: /^Changes/ })).toContainText("2");

    // A changed file opens with what changed shown inline.
    await sidebar.getByRole("button", { name: "Modified src/a.ts" }).click();
    const editor = page.getByRole("textbox", { name: "src/a.ts" });
    await expect(editor).toContainText("export const a = 2;");
    await expect(page.locator(".cm-deletedChunk", { hasText: "export const a = 1;" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show changes since HEAD" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // A deleted one shows its last version, read-only, and comes back with Restore.
    await sidebar.getByRole("button", { name: "Deleted src/gone.ts" }).click();
    const deleted = page.getByRole("region", { name: "Deleted file" });
    await expect(deleted.getByRole("textbox", { name: "src/gone.ts, deleted" })).toContainText(
      "export const gone = true;",
    );
    await screenshot(page, { path: "test-results/screenshots/editor-changes.png" });
    await deleted.getByRole("button", { name: "Restore" }).click();
    await expect
      .poll(() => readFile(join(repo, "src/gone.ts"), "utf8").catch(() => ""))
      .toBe("export const gone = true;\n");
    await expect(page.getByRole("textbox", { name: "src/gone.ts", exact: true })).toBeVisible();

    // Committing from the list beside the editor.
    await sidebar.getByRole("checkbox", { name: "Stage src/a.ts" }).click();
    await expect(sidebar.getByRole("checkbox", { name: "Unstage src/a.ts" })).toBeVisible();
    await sidebar.getByLabel("Commit message").fill("Bump a");
    await sidebar.getByRole("button", { name: "Commit staged changes" }).click();
    await expect.poll(() => git("log", "-1", "--format=%s").trim()).toBe("Bump a");

    // A commit's file opens read-only as the commit left it, its changes in place.
    const short = git("rev-parse", "--short=7", "HEAD").trim();
    await openSurface(page, "History");
    await page.getByRole("option", { name: /Bump a/ }).click();
    await page.getByRole("region", { name: "Commit" }).getByRole("button", { name: /src\/a\.ts/ }).click();
    const version = page.getByRole("region", { name: "File version" });
    await expect(version.getByRole("textbox", { name: `src/a.ts at ${short}` })).toContainText(
      "export const a = 2;",
    );
    await expect(version.locator(".cm-deletedChunk", { hasText: "export const a = 1;" })).toBeVisible();
    await expect(version.locator(".editor-bar-state")).toHaveText(`${short} · read-only`);
    await expect(page.locator(".editor-tabs [role=tab]", { hasText: short })).toBeVisible();
    await screenshot(page, { path: "test-results/screenshots/editor-commit-version.png" });
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
});
