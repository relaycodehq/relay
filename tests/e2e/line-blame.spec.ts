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
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixtureServer } from "../fixtures/gitea";
let app: ElectronApplication,
  page: Page,
  fixture: Awaited<ReturnType<typeof fixtureServer>>,
  root: string,
  data: string,
  base: string,
  head: string;
const path = "src/hooks/useReview.ts";
const context = Array.from(
  { length: 80 },
  (_, i) => `export const context${i} = ${i};\n`,
).join("");
const before =
  "export const retained = 'Alice';\nexport const changed = 'Before';\nexport const removed = 'Old';\n" +
  context +
  "export const tail = 'Before';\n";
const after =
  "export const retained = 'Alice';\nexport const changed = 'After';\nexport const inserted = 'New';\n" +
  context +
  "export const tail = 'After';\n";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  fixture = await fixtureServer({ code: { before, after } });
  root = await mkdtemp(join(tmpdir(), "relay-blame-ui-repo-"));
  data = await mkdtemp(join(tmpdir(), "relay-blame-ui-data-"));
  git("init", "--quiet");
  git("config", "user.name", "Alice Original");
  git("config", "user.email", "alice@example.invalid");
  git("remote", "add", "origin", `${fixture.serverUrl}/Web/web-store.git`);
  await mkdir(join(root, "src/hooks"), { recursive: true });
  await writeFile(join(root, path), before);
  git("add", ".");
  git("commit", "--quiet", "-m", "Create the original review helper");
  base = git("rev-parse", "HEAD");
  await writeFile(join(root, path), after);
  git("config", "user.name", "Bob Reviewer");
  git("config", "user.email", "bob@example.invalid");
  git("add", ".");
  git("commit", "--quiet", "-m", "Improve the review helper");
  head = git("rev-parse", "HEAD");
  fixture.setBase(base);
  fixture.setHead(head);
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
  page.on("pageerror", (e) => console.error("BLAME UI", e));
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
  }, root);
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
});
test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
  await Promise.all(
    [root, data]
      .filter(Boolean)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const tooltip = () => page.getByRole("tooltip", { name: "Line history" });
const number = (side: string, line: number) =>
  page.locator(
    `.diff-wrapper [data-${side}] [data-column-number="${line}"] [data-line-number-content]`,
  );
test("line-number tooltips explain linking and attribute the correct split/unified revision on demand", async () => {
  await number("additions", 2).hover();
  await expect(tooltip()).toContainText(
    "Link this repository to a local folder",
  );
  await page
    .getByRole("button", { name: "Link local folder", exact: true })
    .click();
  await page.getByRole("button", { name: "Choose repository folder" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog" })
    .click();
  // Moving from code to its own gutter must work without crossing another row.
  await page.locator('.diff-wrapper [data-additions] [data-line="2"]').hover();
  await expect(tooltip()).toHaveCount(0);
  await number("additions", 2).hover();
  await expect(tooltip()).toContainText("Bob Reviewer");
  await expect(tooltip()).toContainText(head.slice(0, 8));
  await expect(tooltip()).toContainText("Improve the review helper");
  await expect(tooltip()).toContainText("PR head");
  await tooltip().hover();
  await expect(tooltip()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip()).toHaveCount(0);
  await number("deletions", 2).hover();
  await expect(tooltip()).toContainText("Alice Original");
  await expect(tooltip()).toContainText(base.slice(0, 8));
  await expect(tooltip()).toContainText("Before this PR");
  await number("additions", 1).hover();
  await expect(tooltip()).toContainText("Alice Original");
  await expect(tooltip()).toContainText("Line 1 · PR head");
  await number("additions", 1).click();
  await expect(page.locator(".selection-toolbar")).toContainText(
    "Head · line 1",
  );
  await expect(tooltip()).toHaveCount(0);
  await page.getByRole("button", { name: "Clear selected lines" }).click();
  await page.getByRole("button", { name: "Unified diff" }).click();
  const old = page.locator(
    '.diff-wrapper [data-column-number="3"][data-line-type="change-deletion"] [data-line-number-content]',
  );
  const next = page.locator(
    '.diff-wrapper [data-column-number="3"][data-line-type="change-addition"] [data-line-number-content]',
  );
  await old.hover();
  await expect(tooltip()).toContainText("Alice Original");
  await next.hover();
  await expect(tooltip()).toContainText("Bob Reviewer");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await mkdir(resolve("test-results/screenshots"), { recursive: true });
    await screenshot(page, {
      animations: "disabled",
      path: resolve(`test-results/screenshots/22-line-blame-${theme}.png`),
    });
  }
  await page.getByRole("button", { name: "Side by side diff" }).click();
  await page
    .getByRole("button", { name: "Show unchanged lines", exact: true })
    .click();
  await page.locator(".diff-wrapper .diff-code-view").evaluate((element) => {
    element.scrollTop = 600;
  });
  // Expansion can adjust the virtualizer's scroll anchor after the first frame.
  // Re-enter the intended row once it settles; stale hover targets must close.
  await expect(async () => {
    await number("additions", 40).hover();
    await expect(tooltip()).toContainText("Line 40 · PR head", {
      timeout: 1200,
    });
  }).toPass({ timeout: 8000 });
  await expect(tooltip()).toContainText("Alice Original");
  await page
    .getByRole("button", { name: "Next file · J", exact: true })
    .click();
  await expect(tooltip()).toHaveCount(0);
  await page
    .getByRole("button", { name: "Previous file · K", exact: true })
    .click();
  expect(git("status", "--porcelain")).toBe("");
  expect(fixture.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
});
test("local editor uses committed history and does not assign an author to a different local buffer", async () => {
  await writeFile(join(root, path), "// Local insertion\n" + after);
  await page.getByRole("button", { name: "Edit locally", exact: true }).click();
  const editor = page.getByRole("dialog", { name: /Edit locally/ });
  const gutter = (side: string, line: number) =>
    editor.locator(
      `[data-${side}] [data-column-number="${line}"] [data-line-number-content]`,
    );
  await gutter("deletions", 2).hover();
  await expect(tooltip()).toContainText("Bob Reviewer");
  await gutter("additions", 3).hover();
  await expect(tooltip()).toContainText(
    "This local version differs from the PR",
  );
  await expect(tooltip()).not.toContainText("Bob Reviewer");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  expect(await readFile(join(root, path), "utf8")).toBe(
    "// Local insertion\n" + after,
  );
  expect(git("diff", "--cached")).toBe("");
});
