import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openInFileTree, openSurface } from "../fixtures/navigation";
import { screenshot } from "../fixtures/screenshot";

test("editor tabs pin, close in bulk, reopen and copy their path from their menu", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-tabs-"))),
    repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(bin);
  for (const name of ["a", "b", "c"])
    await writeFile(join(repo, `src/${name}.ts`), `export const ${name} = 1;\n`);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
  await fakeCli(join(bin, "codex"), await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"));
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
    for (const name of ["a", "b", "c"])
      await openInFileTree(page, `src/${name}.ts`, { keep: true });
    const tabs = page.locator(".editor-tabs [role=tab]");
    await expect(tabs).toHaveText([/^a\.ts/, /^b\.ts/, /^c\.ts/]);
    const menu = page.getByRole("menu", { name: "Tab actions" });
    const tabMenu = async (name: string) => {
      await page.locator(".editor-tabs").getByRole("tab", { name: new RegExp(`^${name}`) }).click({ button: "right" });
      await expect(menu).toBeVisible();
    };

    // A pinned tab moves first and trades its × for a pin.
    await tabMenu("b.ts");
    await screenshot(page, { path: "test-results/screenshots/editor-tab-menu.png" });
    await menu.getByRole("menuitem", { name: "Pin Tab" }).click();
    await expect(tabs).toHaveText([/^b\.ts/, /^a\.ts/, /^c\.ts/]);
    await expect(page.getByRole("button", { name: "Unpin b.ts" })).toBeVisible();

    // Close Others leaves the pinned tab; ⌘⇧T brings the closed one back.
    await tabMenu("a.ts");
    await menu.getByRole("menuitem", { name: "Close Others" }).click();
    await expect(tabs).toHaveText([/^b\.ts/, /^a\.ts/]);
    await page.getByRole("textbox", { name: "src/a.ts" }).click();
    await page.keyboard.press("ControlOrMeta+Shift+T");
    await expect(tabs).toHaveText([/^b\.ts/, /^a\.ts/, /^c\.ts/]);

    // Close All keeps unsaved edits and the pinned tab, and says so.
    await page.getByRole("textbox", { name: "src/c.ts" }).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("// edited");
    await tabMenu("a.ts");
    await expect(menu.getByRole("menuitem", { name: /Close All/ })).toContainText("1 unsaved stays");
    await menu.getByRole("menuitem", { name: /Close All/ }).click();
    await expect(tabs).toHaveText([/^b\.ts/, /^c\.ts/]);

    // Copy Path puts the file's absolute path on the clipboard.
    await tabMenu("c.ts");
    await menu.getByRole("menuitem", { name: "Copy Path" }).click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(join(repo, "src/c.ts"));
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
});
