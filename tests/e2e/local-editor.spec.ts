import { screenshot } from "../fixtures/screenshot";
import { openSignIn, openInbox, openPull } from "../fixtures/navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixtureServer, newCode } from "../fixtures/gitea";

let app: ElectronApplication,
  page: Page,
  fixture: Awaited<ReturnType<typeof fixtureServer>>,
  repo: string,
  head: string;
const path = "src/hooks/useReview.ts";
test.describe.configure({ mode: "serial" });
const modifier = process.platform === "darwin" ? "Meta" : "Control";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
test.beforeAll(async () => {
  fixture = await fixtureServer();
  repo = await mkdtemp(join(tmpdir(), "relay-editor-repo-"));
  git("init", "--quiet");
  git("config", "user.name", "Relay test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.autocrlf", "false");
  git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
  await mkdir(join(repo, "src/hooks"), { recursive: true });
  await writeFile(join(repo, path), newCode);
  git("add", ".");
  git("commit", "--quiet", "-m", "PR head");
  head = git("rev-parse", "HEAD");
  fixture.setHead(head);
  const data = await mkdtemp(join(tmpdir(), "relay-editor-data-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: { ...env, RELAY_TEST_DATA: data },
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => console.error("EDITOR ERROR", e));
  // Electron handles beforeunload with its native dialog; avoid Playwright's automatic CDP dismissal.
  page.on("dialog", () => {});
  await app.evaluate(({ dialog }, repo) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [repo],
    });
  }, repo);
  await openSignIn(page);
  await page
    .getByLabel("Gitea server", { exact: true })
    .fill(fixture.serverUrl);
  await page
    .getByLabel("Personal access token", { exact: true })
    .fill("test-token");
  await page.getByRole("button", { name: "Connect to Gitea" }).click();
  await openInbox(page);
  await openPull(page, /Make pull request reviews/);
  await expect(page.locator("diffs-container")).toBeVisible();
});
test.afterAll(async () => {
  await app
    ?.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
    })
    .catch(() => {});
  await app?.close();
  await fixture?.close();
});

test("edit the highlighted local file, use keyboard commands and save only to the checkout", async () => {
  await page.getByRole("button", { name: "Edit locally", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Link local folder", exact: true })
    .click();
  const editor = dialog.getByRole("textbox", { name: path, exact: true });
  await expect(editor).toBeVisible();
  await expect
    .poll(() => editor.locator("span[style]").count())
    .toBeGreaterThan(5);
  await editor.press(`${modifier}+End`);
  await editor.press("Enter");
  await editor.pressSequentially("// Local review fix");
  const surface = dialog.locator(".local-edit-code");
  await expect
    .poll(() => surface.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  await expect(dialog.getByRole("status")).toHaveText("Unsaved changes");
  await editor.press(`${modifier}+d`);
  await expect
    .poll(
      async () =>
        ((await editor.textContent())?.match(/Local review fix/g) ?? []).length,
    )
    .toBe(2);
  await editor.press(`${modifier}+z`);
  await expect
    .poll(
      async () =>
        ((await editor.textContent())?.match(/Local review fix/g) ?? []).length,
    )
    .toBe(1);
  await editor.press(`${modifier}+f`);
  await expect(
    dialog.getByPlaceholder("Search", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByPlaceholder("Search", { exact: true })
    .fill("Local review fix");
  await dialog.getByPlaceholder("Search", { exact: true }).press("Escape");
  await editor.press(`${modifier}+r`);
  await expect(
    dialog.getByPlaceholder("Replace", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByPlaceholder("Search", { exact: true })
    .fill("Local review fix");
  await dialog
    .getByPlaceholder("Replace", { exact: true })
    .fill("Local correction");
  await dialog
    .getByRole("button", { name: "Replace All", exact: true })
    .click();
  await expect(editor).toContainText("Local correction");
  await dialog.getByPlaceholder("Replace", { exact: true }).press("Escape");
  await editor.press(`${modifier}+z`);
  await expect(editor).toContainText("Local review fix");
  await page.keyboard.press(`${modifier}+End`);
  const scrollBeforeSave = await surface.evaluate((e) => e.scrollTop);
  await page.keyboard.press(`${modifier}+s`);
  await expect(dialog.getByRole("status")).toHaveText("Saved to local folder");
  expect(await surface.evaluate((e) => e.scrollTop)).toBeCloseTo(
    scrollBeforeSave,
    0,
  );
  const contents = await readFile(join(repo, path), "utf8");
  expect(contents.startsWith(newCode)).toBe(true);
  expect(contents.slice(newCode.length).trim()).toBe("// Local review fix");
  expect(git("diff", "--cached")).toBe("");
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(fixture.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
  await mkdir(resolve("test-results/screenshots"), { recursive: true });
  await screenshot(page, {
    path: resolve("test-results/screenshots/08-local-editor.png"),
  });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("external changes and a new PR head block saves while retaining the buffer", async () => {
  await page.getByRole("button", { name: "Edit locally", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: path, exact: true });
  await expect(editor).toContainText("// Local review fix");
  await editor.press(`${modifier}+End`);
  await editor.press("Enter");
  await editor.pressSequentially("// My unsaved buffer");
  const external = newCode + "\n// Changed in PhpStorm\n";
  await writeFile(join(repo, path), external);
  await dialog
    .getByRole("button", { name: "Save locally", exact: true })
    .click();
  await expect(dialog.getByText(/changed on disk since/)).toBeVisible();
  await expect(editor).toContainText("My unsaved buffer");
  expect(await readFile(join(repo, path), "utf8")).toBe(external);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog.getByText("Keep your unsaved edits?")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Reload local file", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Reload and discard edits", exact: true })
    .click();
  await expect(editor).toContainText("Changed in PhpStorm");
  await expect(editor).not.toContainText("My unsaved buffer");
  await editor.press(`${modifier}+End`);
  await editor.pressSequentially("// Next fix");
  fixture.setHead("c".repeat(40));
  await editor.press(`${modifier}+s`);
  await expect(dialog.getByText(/PR has new commits/)).toBeVisible();
  expect(await readFile(join(repo, path), "utf8")).toBe(external);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => {
      (globalThis as any).editorCloseWasBlocked = true;
      return 0;
    };
  });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).editorCloseWasBlocked))
    .toBe(true);
  await expect(editor).toContainText("Next fix");
  fixture.setHead(head);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Discard edits", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(await readFile(join(repo, path), "utf8")).toBe(external);
});

test("indentation, line comments and CRLF survive real editing", async () => {
  await writeFile(join(repo, path), newCode.replace(/\n/g, "\r\n"));
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.getByRole("button", { name: "Edit locally", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: path, exact: true });
  await expect(editor).toBeVisible();
  await editor.press(`${modifier}+End`);
  await editor.press("Enter");
  await editor.pressSequentially("function fix() {");
  await editor.press("Enter");
  await editor.pressSequentially("return 1;");
  await editor.press(`${modifier}+/`);
  await editor.press(`${modifier}+/`);
  await editor.press(`${modifier}+s`);
  await expect(dialog.getByRole("status")).toHaveText("Saved to local folder");
  const saved = await readFile(join(repo, path), "utf8");
  expect(saved).toContain("function fix() {\r\n  return 1;");
  expect(saved.replace(/\r\n/g, "")).not.toContain("\n");
  await screenshot(page, {
    path: resolve("test-results/screenshots/09-local-editor-dark.png"),
  });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
});
