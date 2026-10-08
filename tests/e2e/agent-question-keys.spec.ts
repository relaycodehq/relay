import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openInFileTree, openSurface } from "../fixtures/navigation";

test("digits typed in the Files editor stay in the editor while the agent asks a question", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-qkeys-"))),
    repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(repo);
  await mkdir(bin);
  await writeFile(join(repo, "notes.md"), "Notes\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
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
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
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
    await page.getByLabel("Message project").fill("fixture ask question");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const questions = page.getByRole("region", {
      name: "Codex needs your input",
    });
    await expect(questions).toBeVisible();

    await openSurface(page, "Files");
    await openInFileTree(page, "notes.md");
    const editor = page.locator(
      '.project-inline-editor [contenteditable="true"]',
    );
    await expect(editor).toBeAttached();
    await page.waitForTimeout(500);
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("a");
    await expect(editor).toContainText("Notesa");
    await page.keyboard.type("1");

    await expect(editor).toContainText("Notesa1");
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => readFile(join(repo, "notes.md"), "utf8"))
      .toBe("Notesa1\n");
    // Still unanswered: the digit was the editor's.
    await expect(questions).toBeVisible();
    // Outside a field, the digit still picks an answer.
    await questions.locator("legend").click();
    await page.keyboard.press("1");
    await expect(questions).toHaveCount(0);
  } finally {
    await app.close();
  }
});
