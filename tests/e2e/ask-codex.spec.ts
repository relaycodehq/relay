import { openSignIn, openInbox } from "../fixtures/navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixtureServer, BASE, HEAD, newCode } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
let app: ElectronApplication,
  page: Page,
  fixture: Awaited<ReturnType<typeof fixtureServer>>;
let root: string, data: string, bin: string, env: Record<string, string>;
const ref = { owner: "Web", name: "web-store", number: 7 };
const file = "src/hooks/useReview.ts";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const launch = async () => {
  app = await electron.launch({ args: ["tests/fixtures/launch.cjs"], env });
  page = await app.firstWindow();
  await app.evaluate(({ dialog, shell }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
    shell.openPath = async (path) => {
      (globalThis as any).questionTerminal = path;
      return "";
    };
  }, root);
};
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  fixture = await fixtureServer();
  root = await mkdtemp(join(tmpdir(), "relay-ask-root-"));
  data = await mkdtemp(join(tmpdir(), "relay-ask-data-"));
  bin = await mkdtemp(join(tmpdir(), "relay-ask-bin-"));
  git("init", "--quiet");
  git("config", "user.name", "Review Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
  await mkdir(join(root, "src/hooks"), { recursive: true });
  await writeFile(join(root, file), newCode);
  git("add", ".");
  git("commit", "--quiet", "-m", "Fixture");
  // Questions may inspect a dirty checkout; their supplied source must still be the PR revision.
  await writeFile(join(root, file), newCode + "\n// local work in progress\n");
  await fakeCli(
    join(bin, "codex"),
    `require('node:fs').writeFileSync(${JSON.stringify(join(bin, "invocation.json"))}, JSON.stringify({cwd:process.cwd(), args:process.argv.slice(2)}));\n`,
  );
  await fakeCli(
    join(bin, "claude"),
    `require('node:fs').writeFileSync(${JSON.stringify(join(bin, "claude-invocation.json"))}, JSON.stringify({cwd:process.cwd(), args:process.argv.slice(2)}));\n`,
  );
  env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  env = { ...env, ...pathWith(env, bin), RELAY_TEST_DATA: data };
  await launch();
  await openSignIn(page);
  await page
    .getByLabel("Gitea server", { exact: true })
    .fill(fixture.serverUrl);
  await page
    .getByLabel("Personal access token", { exact: true })
    .fill("test-token");
  await page.getByRole("button", { name: "Connect to Gitea" }).click();
  await openInbox(page);
  await page.getByRole("button", { name: /Make pull request reviews/ }).click();
  await mkdir(resolve("test-results/screenshots"), { recursive: true });
});
test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
  await Promise.all(
    [root, data, bin]
      .filter(Boolean)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
test("separate models, reasoning effort and Fast toggles persist across restart and stay reachable with hidden sidebars", async () => {
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByRole("button", { name: "AI models", exact: true }).click();
  const pick = async (control: string, option: string) => {
    await page.getByRole("button", { name: control, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  await pick("Grouping model", "GPT-5.6-Sol");
  await page
    .getByRole("combobox", { name: "Grouping reasoning effort", exact: true })
    .click();
  await page.getByRole("option", { name: "Ultra", exact: true }).click();
  // Luna has no Ultra effort, so switching falls back to the default.
  await pick("Grouping model", "GPT-5.6-Luna");
  await expect(
    page.getByRole("combobox", {
      name: "Grouping reasoning effort",
      exact: true,
    }),
  ).toHaveText("Default effort");
  await pick("Grouping model", "GPT-5.6-Sol");
  await page
    .getByRole("combobox", { name: "Grouping reasoning effort", exact: true })
    .click();
  await page.getByRole("option", { name: "Ultra", exact: true }).click();
  await page
    .getByRole("button", { name: "Grouping Fast mode", exact: true })
    .click();
  await pick("Line questions model", "GPT-5.6-Luna");
  await page
    .getByRole("combobox", {
      name: "Line questions reasoning effort",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("option", { name: "Ultra", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "Max", exact: true }).click();
  await page
    .getByRole("button", { name: "Line questions Fast mode", exact: true })
    .click();
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Settings", exact: true })
      .getByRole("status"),
  ).toContainText("Settings saved");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("radio", { name: theme, exact: true }).click();
    await page.screenshot({
      path: resolve(
        `test-results/screenshots/24-settings-${theme.toLowerCase()}.png`,
      ),
    });
  }
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Toggle pull requests", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle changed files", exact: true })
    .click();
  await app.close();
  await launch();
  // Credential storage can be session-only on headless Linux.
  if (
    await page.getByRole("button", { name: "Connect to Gitea" }).isVisible()
  ) {
    await openSignIn(page);
    await page
      .getByLabel("Gitea server", { exact: true })
      .fill(fixture.serverUrl);
    await page
      .getByLabel("Personal access token", { exact: true })
      .fill("test-token");
    await page.getByRole("button", { name: "Connect to Gitea" }).click();
    await openInbox(page);
  }
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByRole("button", { name: "AI models", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Grouping model", exact: true }),
  ).toContainText("GPT-5.6-Sol");
  await expect(
    page.getByRole("button", { name: "Grouping Fast mode", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Line questions model", exact: true }),
  ).toContainText("GPT-5.6-Luna");
  await expect(
    page.getByRole("combobox", {
      name: "Grouping reasoning effort",
      exact: true,
    }),
  ).toHaveText("Ultra");
  await expect(
    page.getByRole("combobox", {
      name: "Line questions reasoning effort",
      exact: true,
    }),
  ).toHaveText("Max");
  await expect(
    page.getByRole("button", { name: "Line questions Fast mode", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+," : "Control+,",
  );
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
});
test("row questions launch safely at the root with old/new revision context and leave review state untouched", async () => {
  test.skip(
    process.platform !== "darwin",
    "Terminal interception in this test uses macOS openPath",
  );
  await page.evaluate((ref) => window.relay.linkFolder(ref), ref);
  await page.reload();
  const progress = await page.evaluate(
    (ref) => window.relay.progress(ref),
    ref,
  );
  await expect(page.locator("diffs-container")).toBeVisible();
  await page
    .locator('.diff-wrapper [data-additions] [data-line="13"]')
    .click({ position: { x: 60, y: 8 } });
  await expect(page.locator(".selection-toolbar")).toContainText(
    "Head · line 13",
  );
  await page.getByRole("button", { name: "Ask Codex", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ask Codex", exact: true });
  await expect(dialog).toContainText("Luna · Max reasoning · Fast");
  await expect(dialog).toContainText("Read-only session");
  await expect(dialog).toContainText(root);
  await expect(dialog).toContainText("checkout differs");
  await dialog.locator("summary").click();
  await expect(dialog.locator("pre")).toContainText("> 13");
  const question =
    "Why Bob's $(touch should-not-exist) `touch unsafe` here?\nExplain callers.";
  await page.getByLabel("Question about selected code").fill(question);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.screenshot({
      path: resolve(`test-results/screenshots/25-ask-codex-${theme}.png`),
    });
  }
  await page.getByRole("button", { name: "Ask in Codex", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const command = await app.evaluate(
    () => (globalThis as any).questionTerminal as string,
  );
  expect((await stat(command)).mode & 0o777).toBe(0o700);
  expect((await stat(command.replace(".command", ".txt"))).mode & 0o777).toBe(
    0o600,
  );
  execFileSync("/bin/sh", [command], { env });
  const captured = JSON.parse(
    await readFile(join(bin, "invocation.json"), "utf8"),
  );
  expect(captured.cwd).toBe(await realpath(root));
  expect(captured.args).toEqual(
    expect.arrayContaining([
      "--sandbox",
      "read-only",
      "--cd",
      await realpath(root),
      "--model",
      "gpt-5.6-luna",
      'service_tier="fast"',
      'model_reasoning_effort="max"',
    ]),
  );
  const prompt = captured.args.at(-1);
  expect(prompt).toContain(question);
  expect(prompt).toContain(HEAD);
  expect(prompt).toContain('"line": 13');
  expect(prompt).not.toContain("// local work in progress");
  await expect(stat(join(root, "should-not-exist"))).rejects.toThrow();
  await expect(stat(join(root, "unsafe"))).rejects.toThrow();
  await expect(stat(command)).rejects.toThrow();
  await page.getByRole("button", { name: "Clear selected lines" }).click();
  await page
    .locator(
      '.diff-wrapper [data-deletions] [data-column-number="13"] [data-line-number-content]',
    )
    .click();
  await page.getByRole("button", { name: "Ask Codex", exact: true }).click();
  await expect(dialog).toContainText("Before this PR");
  await dialog.locator("summary").click();
  await expect(dialog.locator("pre")).toContainText("fetch('/api/pulls/'");
  await page
    .getByLabel("Question about selected code")
    .fill("What did this do before?");
  fixture.setHead("c".repeat(40));
  await page.getByRole("button", { name: "Ask in Codex", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("PR changed");
  fixture.setHead(HEAD);
  await page.getByRole("button", { name: "Ask in Codex", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const oldCommand = await app.evaluate(
    () => (globalThis as any).questionTerminal as string,
  );
  const oldPrompt = await readFile(
    oldCommand.replace(".command", ".txt"),
    "utf8",
  );
  expect(oldPrompt).toContain(BASE);
  expect(oldPrompt).toContain("Before this PR (merge base)");
  expect(await page.evaluate((ref) => window.relay.progress(ref), ref)).toEqual(
    progress,
  );
  expect(await readFile(join(root, file), "utf8")).toBe(
    newCode + "\n// local work in progress\n",
  );
  expect(fixture.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
});

test("line questions can run in a read-only Claude Code session", async () => {
  test.skip(
    process.platform !== "darwin",
    "Terminal interception in this test uses macOS openPath",
  );
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByRole("button", { name: "AI models", exact: true }).click();
  await page
    .getByRole("button", { name: "Line questions model", exact: true })
    .click();
  await page.getByRole("button", { name: "Claude", exact: true }).click();
  await page
    .getByRole("option", { name: "Claude default", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Line questions model", exact: true }),
  ).toContainText("Claude default");
  // Codex's Fast mode does not apply to Claude.
  await expect(
    page.getByRole("button", { name: "Line questions Fast mode", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Settings", exact: true })
      .getByRole("status"),
  ).toContainText("Settings saved");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Clear selected lines" }).click();
  await page
    .locator('.diff-wrapper [data-additions] [data-line="13"]')
    .click({ position: { x: 60, y: 8 } });
  await page.getByRole("button", { name: "Ask Claude", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ask Claude", exact: true });
  await expect(dialog).toContainText("Claude · default model");
  await page.getByLabel("Question about selected code").fill("Who calls this?");
  await page
    .getByRole("button", { name: "Ask in Claude", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const command = await app.evaluate(
    () => (globalThis as any).questionTerminal as string,
  );
  execFileSync("/bin/sh", [command], { env });
  const captured = JSON.parse(
    await readFile(join(bin, "claude-invocation.json"), "utf8"),
  );
  expect(captured.cwd).toBe(await realpath(root));
  // Max effort carries over from Codex because Claude supports it too.
  expect(captured.args.slice(0, -1)).toEqual([
    "--disallowedTools",
    "Edit,Write,NotebookEdit",
    "--effort",
    "max",
  ]);
  expect(captured.args.at(-1)).toContain("Who calls this?");
});
