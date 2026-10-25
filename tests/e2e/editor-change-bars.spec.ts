import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
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
import { screenshot } from "../fixtures/screenshot";

const lines = (...text: string[]) => text.map((l) => `${l}\n`).join("");
const committed = Array.from(
  { length: 12 },
  (_, i) => `const line${i + 1} = ${i + 1};`,
);

test("the Files editor marks changes against HEAD in its gutter, not as a diff", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-bars-"))),
    repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(bin);
  await writeFile(join(repo, "src/app.ts"), lines(...committed));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
  // On disk before opening: a line inserted after 2, line 6 changed, line 10 gone.
  const edited = [...committed];
  edited.splice(9, 1);
  edited[5] = "const line6 = 600;";
  edited.splice(2, 0, "// inserted");
  await writeFile(join(repo, "src/app.ts"), lines(...edited));
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
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
    await page.getByLabel("Message project").fill("hello");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await openSurface(page, "Files");
    await openInFileTree(page, "src/app.ts");
    const editor = page.locator(".project-inline-editor");
    const textbox = editor.locator('[contenteditable="true"]');
    await expect(textbox).toBeFocused();

    // What each line's change cell draws: a bar's colour, and whether a
    // notch marks removed lines; matched to line numbers by height.
    const marks = () =>
      editor.locator(".cm-editor").evaluate((root) => {
        const numbers = [
          ...root.querySelectorAll<HTMLElement>(".cm-lineNumbers [data-column-number]"),
        ].map((cell) => [cell.getBoundingClientRect().top, cell.dataset.columnNumber!] as const);
        const lineAt = (top: number) =>
          numbers.find(([at]) => Math.abs(at - top) < 2)?.[1];
        const seen: Record<string, string> = {};
        for (const [, n] of numbers) seen[n] = "";
        for (const cell of root.querySelectorAll<HTMLElement>(
          ".cm-change-gutter .cm-gutterElement",
        )) {
          const line = lineAt(cell.getBoundingClientRect().top);
          if (!line) continue;
          const style = getComputedStyle(cell);
          const before = getComputedStyle(cell, "::before");
          const after = getComputedStyle(cell, "::after");
          const notch = [before, after].some(
            (s) => s.content !== "none" && s.clipPath !== "none",
          );
          const bar = /gradient\((\w+\([^)]*\))/.exec(style.backgroundImage)?.[1] ?? "";
          seen[line] = [bar, notch ? "notch" : ""].join(" ").trim();
        }
        return seen;
      });
    // No deleted rows: the editor shows the file as it is.
    await expect(editor.locator(".cm-deletedChunk")).toHaveCount(0);
    await expect(textbox).toContainText("const line11 = 11;");
    await expect(textbox).not.toContainText("const line10");
    await expect
      .poll(async () => Object.values(await marks()).filter(Boolean).length)
      .toBe(4);
    const seen = await marks();
    const added = seen["3"];
    const modified = seen["7"];
    expect(added).toMatch(/^(rgb|color|oklch)/);
    expect(modified).toMatch(/^(rgb|color|oklch)/);
    expect(modified).not.toBe(added);
    expect(seen["10"]).toBe("notch");
    expect(seen["11"]).toBe("notch");
    for (const n of ["1", "2", "4", "8"]) expect(seen[n]).toBe("");

    // Typing a line at the end bars it as it appears.
    for (let i = 1; i < 11; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("const extra = 13;");
    await expect.poll(async () => (await marks())["12"]).toBe(added);
    await screenshot(page, {
      path: "test-results/screenshots/editor-change-bars.png",
    });

    // Blame follows an unchanged line to where it sits in HEAD; a changed one has none.
    const tooltip = page.getByRole("tooltip", { name: "Line history" });
    await editor.locator('.cm-lineNumbers [data-column-number="8"]').hover();
    await expect(tooltip).toContainText("Fixture Author");
    await editor.locator('.cm-lineNumbers [data-column-number="3"]').hover();
    await expect(tooltip).toContainText("not committed yet");
    await page.keyboard.press("Escape");

    // Saved, the file still differs from HEAD.
    await page.keyboard.press("ControlOrMeta+s");
    await expect(editor.locator(".editor-bar-state")).toHaveText("Saved");
    expect(await readFile(join(repo, "src/app.ts"), "utf8")).toContain(
      "const extra = 13;",
    );
    expect((await marks())["3"]).toBe(added);

    // Showing the changes puts HEAD's removed lines inline, in the same
    // editor; hiding them again keeps the edits.
    const compare = editor.getByRole("button", {
      name: "Show changes since HEAD",
      exact: true,
    });
    await compare.click();
    await expect(
      editor.locator(".cm-deletedChunk", { hasText: "const line10 = 10;" }),
    ).toBeVisible();
    await compare.click();
    await expect(editor.locator(".cm-deletedChunk")).toHaveCount(0);
    await expect(textbox).toContainText("const extra = 13;");
    await expect.poll(async () => (await marks())["7"]).toBe(modified);
    // The round trip kept the undo history.
    await editor.locator(".cm-line").first().click();
    await expect(textbox).toBeFocused();
    await expect(async () => {
      await page.keyboard.press("ControlOrMeta+z");
      await expect(textbox).not.toContainText("const extra = 13;", {
        timeout: 200,
      });
    }).toPass({ timeout: 5000 });
    await page.keyboard.press("ControlOrMeta+s");
    await expect(editor.locator(".editor-bar-state")).toHaveText("Saved");

    // Committed, the file is HEAD again: no bars, and it still saves.
    git("commit", "-qam", "Edits");
    await expect
      .poll(async () => Object.values(await marks()).filter(Boolean).length)
      .toBe(0);
    await editor.locator(".cm-line").first().click();
    await page.keyboard.press("Home");
    await page.keyboard.type("// after");
    await expect.poll(async () => (await marks())["1"]).toBe(modified);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(editor.locator(".editor-bar-state")).toHaveText("Saved");
  } finally {
    await app.close().catch(() => {});
  }
});
