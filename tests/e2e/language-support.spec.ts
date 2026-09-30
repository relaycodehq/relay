import { screenshot } from "../fixtures/screenshot";
import { openSignIn, openInbox, openPull } from "../fixtures/navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixtureServer } from "../fixtures/gitea";
import {
  languageProject,
  reviewCode,
  reviewPath,
} from "../fixtures/language-project";
let app: ElectronApplication,
  page: Page,
  fixture: Awaited<ReturnType<typeof fixtureServer>>,
  repo: Awaited<ReturnType<typeof languageProject>>;
const modifier = process.platform === "darwin" ? "Meta" : "Control";
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  fixture = await fixtureServer({
    code: {
      before: reviewCode.replace("= 42", '= "Before"'),
      after: reviewCode,
    },
  });
  repo = await languageProject(fixture.serverUrl);
  fixture.setHead(repo.head);
  const data = await mkdtemp(join(tmpdir(), "relay-language-ui-"));
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
  page.on("pageerror", (e) => console.error("LANGUAGE UI", e));
  page.on("dialog", () => {});
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
  }, repo.root);
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
  await page
    .getByRole("button", { name: "Link local folder", exact: true })
    .click();
  await page.getByRole("button", { name: "Choose repository folder" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
});
test.afterAll(async () => {
  await app
    ?.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
    })
    .catch(() => {});
  await app?.close();
  await fixture?.close();
  if (repo) await rm(repo.root, { recursive: true, force: true });
});
const code = () => page.locator(".diff-wrapper [data-additions] [data-line]");
const greet = () =>
  code()
    .locator("[data-char]")
    .filter({ hasText: /^greet$/ })
    .last();
test("existing project errors show in review; hover, Cmd-click and usages preserve the PR", async () => {
  await expect(page.locator(".file-check-status")).toContainText("1 error", {
    timeout: 30000,
  });
  await expect(page.locator(".diagnostic-badge")).toHaveCount(1);
  await expect(page.locator(".inline-diagnostic")).toContainText(
    "Type 'number' is not assignable to type 'string'",
  );
  await expect(greet()).toBeVisible();
  await greet().hover();
  await expect(
    page.getByRole("region", { name: "Symbol information" }),
  ).toContainText("greet");
  await expect(
    page.getByRole("region", { name: "Symbol information" }),
  ).toContainText("friendly greeting");
  await greet().click({ modifiers: [modifier] });
  const peek = page.getByRole("dialog", { name: "Go to definition" });
  await expect(peek.locator(".symbol-code")).toContainText("Hello,");
  await expect(peek.locator(".symbol-preview-heading")).toContainText(
    "src/greeting.ts:2",
  );
  await mkdir(resolve("test-results/screenshots"), { recursive: true });
  await screenshot(page, {
    path: resolve("test-results/screenshots/15-symbol-definition.png"),
  });
  await peek.getByRole("button", { name: "Back to review" }).click();
  await greet().click();
  await page
    .locator(".symbol-actions")
    .getByRole("button", { name: "Find usages" })
    .click();
  const usages = page.getByRole("dialog", { name: "Find usages" });
  await expect(usages.locator(".symbol-summary")).toContainText("4 usages");
  await usages
    .locator(".symbol-location-list")
    .getByRole("button")
    .filter({ hasText: reviewPath })
    .last()
    .click();
  await expect(usages.locator(".symbol-preview-heading")).toContainText(
    reviewPath,
  );
  await screenshot(page, {
    path: resolve("test-results/screenshots/16-symbol-usages.png"),
  });
  await usages.getByRole("button", { name: "Previous symbol" }).click();
  await expect(
    page.getByRole("dialog", { name: "Go to definition" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next symbol", exact: true }).click();
  await expect(usages.locator(".symbol-summary")).toContainText("4 usages");
  await usages.getByRole("button", { name: "Back to review" }).click();
  await expect(page.locator(".file-check-status")).toContainText("1 error");
  expect(fixture.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
});
test("unsaved editor diagnostics and navigation work, then restore disk diagnostics on discard", async () => {
  await page.getByRole("button", { name: "Edit locally", exact: true }).click();
  const editorDialog = page.getByRole("dialog", { name: /Edit locally/ });
  const editor = editorDialog.getByRole("textbox", {
    name: reviewPath,
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor.press(`${modifier}+a`);
  await editor.pressSequentially(reviewCode.replace("= 42", '= "Fixed"'));
  await expect(editorDialog.locator(".editor-checks")).toContainText(
    "No compiler errors",
    { timeout: 30000 },
  );
  expect(await readFile(join(repo.root, reviewPath), "utf8")).toBe(reviewCode);
  const token = editor
    .locator("[data-char]")
    .filter({ hasText: /^greet$/ })
    .last();
  await token.click({ modifiers: [modifier] });
  const peek = page.getByRole("dialog", { name: "Go to definition" });
  await expect(peek.locator(".symbol-code")).toContainText("Hello,");
  await peek.getByRole("button", { name: "Back to editing" }).click();
  await expect(editor).toContainText('"Fixed"');
  await expect(editorDialog.getByRole("status")).toHaveText("Unsaved changes");
  await editor.press(`${modifier}+End`);
  await editor.press("Enter");
  await editor.pressSequentially('const broken: number = "Oops";');
  await expect(editorDialog.locator(".editor-checks")).toContainText(
    "1 error",
    { timeout: 30000 },
  );
  await editorDialog
    .getByText("Problems in this file", { exact: true })
    .click();
  await expect(editorDialog.locator(".diagnostic-message.error")).toContainText(
    "Type 'string' is not assignable to type 'number'",
  );
  await expect(
    editorDialog.locator("[data-marker-range]").first(),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await screenshot(page, {
    path: resolve("test-results/screenshots/17-live-editor-errors.png"),
  });
  await editorDialog.getByRole("button", { name: "Done", exact: true }).click();
  await editorDialog
    .getByRole("button", { name: "Discard edits", exact: true })
    .click();
  await expect(page.locator(".file-check-status")).toContainText("1 error", {
    timeout: 30000,
  });
  expect(await readFile(join(repo.root, reviewPath), "utf8")).toBe(reviewCode);
});
test("disk changes show a local-version warning instead of misaligned inline errors", async () => {
  await writeFile(
    join(repo.root, reviewPath),
    "// Edited elsewhere\n" + reviewCode,
  );
  await expect(page.locator(".file-check-status")).toContainText(
    "Local file differs from PR",
    { timeout: 30000 },
  );
  await expect(page.locator(".inline-diagnostic")).toHaveCount(0);
  await page
    .getByRole("button", { name: "1 error · 0 warnings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Live project checks" });
  await expect(settings.locator(".project-problems")).toContainText(
    reviewPath + ":4",
  );
  await settings.getByRole("checkbox", { name: "Live checks" }).uncheck();
  await settings.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".file-check-status")).toHaveCount(0);
});
test("suggestions have their own totals, labels and icons across checks, file badges and the live editor", async () => {
  const text =
    "/** @deprecated Use current instead. */\nfunction legacy() { return 1; }\nexport function inspect(unused: string) { return legacy(); }\n";
  await writeFile(join(repo.root, reviewPath), text);
  await page
    .getByRole("button", { name: "Live checks off", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Live project checks" });
  await settings.getByRole("checkbox", { name: "Live checks" }).check();
  await expect(settings.locator(".checks-summary")).toContainText(
    "0 errors · 0 warnings · 2 suggestions",
    { timeout: 30000 },
  );
  await expect(
    settings.locator(".checks-summary .diagnostic-icon.info"),
  ).toBeVisible();
  await expect(settings.locator(".project-problem.info")).toHaveCount(2);
  await expect(
    settings.locator(".project-problem.error, .project-problem.warning"),
  ).toHaveCount(0);
  await expect(
    settings.locator(".project-problem .diagnostic-icon.info"),
  ).toHaveCount(2);
  await expect(settings.locator(".checks-suggestions-note")).toContainText(
    "do not block compilation",
  );
  await expect(settings.locator(".project-problem").first()).toContainText(
    "Suggestion · TS6133",
  );
  const rows = await settings.locator(".project-problem > svg").all();
  const positions = await Promise.all(rows.map((r) => r.boundingBox()));
  expect(positions[0]!.x).toBe(positions[1]!.x);
  const checkbox = settings.getByRole("checkbox", { name: "Live checks" });
  const toggleBox = (await checkbox.boundingBox())!;
  const labelBox = (await settings
    .locator(".checks-settings label")
    .boundingBox())!;
  expect(
    Math.abs(
      toggleBox.y + toggleBox.height / 2 - labelBox.y - labelBox.height / 2,
    ),
  ).toBeLessThan(2);
  const filter = settings.getByRole("textbox", { name: "Filter diagnostics" });
  await filter.fill("TS6387");
  await expect(settings.locator(".project-problem")).toHaveCount(1);
  await filter.fill("no-such-diagnostic");
  await expect(
    settings.getByText("No matching problems.", { exact: true }),
  ).toBeVisible();
  await filter.fill("");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await screenshot(page, {
      animations: "disabled",
      path: resolve(
        `test-results/screenshots/21-checks-suggestions-${theme}.png`,
      ),
    });
  }
  await settings.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".diagnostic-badge.info")).toHaveAttribute(
    "aria-label",
    "0 errors · 0 warnings · 2 suggestions",
  );
  await expect(page.locator(".file-check-status")).toContainText(
    "0 errors · 0 warnings · 2 suggestions in local version",
  );
  await page
    .getByRole("button", { name: "Inspect local diagnostics", exact: true })
    .click();
  const editorDialog = page.getByRole("dialog", { name: /Edit locally/ });
  await expect(editorDialog.locator(".editor-checks")).toContainText(
    "0 errors · 0 warnings · 2 suggestions",
  );
  const editor = editorDialog.getByRole("textbox", {
    name: reviewPath,
    exact: true,
  });
  await editor.press(`${modifier}+a`);
  await editor.pressSequentially("export function inspect() { return 1; }\n");
  await expect(editorDialog.locator(".editor-checks")).toContainText(
    "No compiler errors",
    { timeout: 30000 },
  );
  expect(await readFile(join(repo.root, reviewPath), "utf8")).toBe(text);
  await editorDialog.getByRole("button", { name: "Done", exact: true }).click();
  await editorDialog
    .getByRole("button", { name: "Discard edits", exact: true })
    .click();
  await expect(page.locator(".checks-button")).toContainText(
    "0 errors · 0 warnings · 2 suggestions",
    { timeout: 30000 },
  );
  expect(fixture.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
});
