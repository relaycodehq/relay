import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openInFileTree, openSurface } from "../fixtures/navigation";
import { screenshot } from "../fixtures/screenshot";

test("the editor splits right, keeps one file in step across splits, and moves tabs between them", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-splits-"))),
    repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(bin);
  await writeFile(join(repo, "src/a.ts"), "export const a = 1;\n");
  await writeFile(join(repo, "src/b.ts"), "export const b = 2;\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
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
    await openInFileTree(page, "src/a.ts");
    const splits = page.locator(".editor-group");
    await expect(splits).toHaveCount(1);

    // Split right shows the same file in a second split.
    await page.getByRole("button", { name: "Split right" }).click();
    await expect(splits).toHaveCount(2);
    const left = splits.nth(0).getByRole("textbox", { name: "src/a.ts" });
    const right = splits.nth(1).getByRole("textbox", { name: "src/a.ts" });
    await expect(right).toBeVisible();

    // Typing in one shows in the other at once, one unsaved file.
    await right.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("export const c = 3;");
    await expect(left).toContainText("export const c = 3;");
    await expect(page.locator(".editor-tab.unsaved")).toHaveCount(2);

    // A file opened now lands in the split last clicked.
    await openInFileTree(page, "src/b.ts");
    await expect(splits.nth(1).locator(".editor-tab.active")).toContainText("b.ts");
    await expect(splits.nth(0).locator(".editor-tab.active")).toContainText("a.ts");
    await screenshot(page, { path: "test-results/screenshots/editor-splits.png" });

    // Dragging b.ts to the left split moves it there.
    await splits
      .nth(1)
      .getByRole("tab", { name: /^b\.ts/ })
      .dragTo(splits.nth(0).getByRole("tablist"));
    await expect(splits.nth(0).getByRole("tab", { name: /^b\.ts/ })).toBeVisible();
    await expect(splits.nth(1).getByRole("tab", { name: /^b\.ts/ })).toHaveCount(0);

    // Saving writes the edit once; closing the right split's last tab closes the split.
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => readFile(join(repo, "src/a.ts"), "utf8"))
      .toBe("export const a = 1;\nexport const c = 3;");
    await splits.nth(1).getByRole("button", { name: "Close a.ts" }).click();
    await expect(splits).toHaveCount(1);
    await expect(page.locator(".editor-tab", { hasText: "a.ts" })).toHaveCount(1);

    // Selected lines go to the composer, the line the selection ends at the start of not among them.
    await splits.nth(0).getByRole("tab", { name: /^a\.ts/ }).click();
    await left.locator(".cm-line").first().click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("Shift+ArrowDown");
    await page.locator(".cm-ask-selection").getByRole("button", { name: /Ask in chat/ }).click();
    await expect(page.locator(".code-ref-toggle")).toHaveAttribute("title", "src/a.ts:1 · Working file");
    await expect(page.locator(".cm-ask-selection")).toHaveCount(0);
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
});
