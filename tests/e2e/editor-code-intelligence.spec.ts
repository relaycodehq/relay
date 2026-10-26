import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openInFileTree, openSurface } from "../fixtures/navigation";
import { screenshot } from "../fixtures/screenshot";

const clangd = (() => {
  try {
    return execFileSync("which", ["clangd"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();

const files = {
  "greet.h": "#pragma once\n\n/// Says hello to `name`.\nint greet(const char* name);\n",
  "greet.cpp":
    '#include "greet.h"\n#include <cstdio>\n\nint greet(const char* name) {\n  return std::printf("hi %s\\n", name);\n}\n',
  "main.cpp":
    '#include "greet.h"\n\nint main() {\n  int count = 3;\n  for (int i = 0; i < count; i++) greet("relay");\n  return count;\n}\n',
};

test("the editor goes to definitions, shows usages, renames and searches like an IDE", async () => {
  test.skip(!clangd, "needs clangd on PATH");

  test.setTimeout(120_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-lsp-"))),
    repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(repo, { recursive: true });
  await mkdir(bin);
  for (const [name, text] of Object.entries(files))
    await writeFile(join(repo, name), text);
  await writeFile(
    join(repo, "compile_commands.json"),
    JSON.stringify(
      ["main.cpp", "greet.cpp"].map((file) => ({
        directory: repo,
        file: join(repo, file),
        arguments: ["c++", "-std=c++17", "-c", file],
      })),
    ),
  );
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
    await openInFileTree(page, "main.cpp");
    const editor = page.locator(".project-inline-editor");
    const code = editor.getByRole("textbox", { name: "main.cpp", exact: true });
    await expect(code).toBeFocused();
    const front = page.locator(".editor-tabs [role=tab][aria-selected=true]");

    // Hovering a call shows the server's docs for it.
    const call = editor.locator(".cm-line", { hasText: "greet(" }).getByText("greet", { exact: true });
    await expect(async () => {
      await page.mouse.move(0, 0);
      await call.hover();
      await expect(page.locator(".cm-tooltip .hover-card")).toContainText("greet", {
        timeout: 3000,
      });
    }).toPass({ timeout: 45_000 });

    // ⌘-click goes to it in its own file; ⌘[ comes back.
    await call.click({ modifiers: ["ControlOrMeta"] });
    await expect(front).toHaveText(/greet\.(h|cpp)/);
    // Back once the definition's file has taken the caret.
    await expect(
      editor.getByRole("textbox", { name: /^greet\.(h|cpp)$/ }),
    ).toBeFocused();
    await page.keyboard.press("ControlOrMeta+BracketLeft");
    await expect(front).toHaveText(/main\.cpp/);

    // ⌥F7 lists where it's used.
    await editor.locator(".cm-line", { hasText: "greet(" }).getByText("greet", { exact: true }).click();
    await page.keyboard.press("Alt+F7");
    const usages = page.getByRole("dialog", { name: "Usages" });
    await expect(usages.getByRole("option").first()).toBeVisible({ timeout: 20_000 });
    expect(await usages.getByRole("option").count()).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Escape");

    // ⌘-click on a declaration lists where it's used instead, as in PhpStorm.
    await editor
      .locator(".cm-line", { hasText: "int count = 3;" })
      .getByText("count")
      .click({ modifiers: ["ControlOrMeta"] });
    await expect(usages.getByRole("option")).toHaveCount(2, { timeout: 20_000 });
    await page.keyboard.press("Escape");

    // ⇧F6 renames a variable everywhere it's used.
    await editor.locator(".cm-line", { hasText: "int count = 3;" }).getByText("count").click();
    await page.keyboard.press("Shift+F6");
    const rename = page.getByLabel("New name");
    await rename.fill("total");
    await rename.press("Enter");
    await expect(code).toContainText("int total = 3;");
    await expect(code).toContainText("i < total;");
    await expect(code).toContainText("return total;");

    // A type error gets a squiggle from the server.
    await editor.locator(".cm-line", { hasText: "return total;" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type('int bad = "text";');
    await expect(editor.locator(".cm-lintRange-error").first()).toBeVisible({ timeout: 20_000 });
    await screenshot(page, { path: "test-results/screenshots/editor-code-intelligence.png" });
    // F2 goes to the next problem from wherever the caret is.
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("F2");
    await expect(editor.locator(".cm-activeLine")).toContainText("int bad");
    // ⌘⌫ deletes the line, as in PhpStorm.
    await page.keyboard.press("ControlOrMeta+Backspace");
    await expect(code).not.toContainText("int bad");

    // Saved, the file is in local history.
    await page.keyboard.press("ControlOrMeta+s");
    await expect(editor.locator(".editor-bar-state")).toHaveText("Saved");
    expect(await readFile(join(repo, "main.cpp"), "utf8")).toContain("int total = 3;");
    await editor.getByRole("button", { name: "Local history" }).click();
    const history = page.getByRole("dialog", { name: /history/i });
    await expect(history).toBeVisible();
    await expect(history).toContainText(/Saved|save/i);
    await page.keyboard.press("Escape");
    await expect(history).toHaveCount(0);

    // Shift twice finds a file by name.
    await editor.locator(".cm-line").first().click();
    await page.keyboard.press("Shift");
    await page.keyboard.press("Shift");
    const palette = page.getByRole("dialog").filter({ has: page.getByRole("tablist", { name: "Search in" }) });
    await expect(palette).toBeVisible();
    await page.keyboard.type("greet.cpp");
    await expect(palette.getByText("greet.cpp").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(front).toHaveText(/greet\.cpp/);

    // ⌘⇧F searches every file.
    await editor.locator(".cm-line").first().click();
    await page.keyboard.press("ControlOrMeta+Shift+f");
    const find = page.locator(".files-find");
    await expect(find).toBeVisible();
    await page.keyboard.type("printf");
    await expect(find).toContainText("greet.cpp");
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
});
