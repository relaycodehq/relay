import { openSignIn, openInbox } from "../fixtures/navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixtureServer, HEAD } from "../fixtures/gitea";
let app: ElectronApplication,
  page: Page,
  fixture: Awaited<ReturnType<typeof fixtureServer>>,
  dataDir: string;
const screenshots = resolve("test-results/screenshots");
test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
  fixture = await fixtureServer();
  dataDir = await mkdtemp(join(tmpdir(), "relay-e2e-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    RELAY_TEST_DATA: dataDir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ["tests/fixtures/launch.cjs"], env });
  page = await app.firstWindow();
  page.on("console", (m) => {
    if (m.type() === "error") console.error("BROWSER_CONSOLE", m.text());
  });
  page.on("pageerror", (e) => console.error("RENDERER ERROR", e));
});
test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
});
test("native app: connect, lazy review, inline threads, drafts, restart, large diff", async () => {
  await expect(
    page.getByRole("heading", { name: "Your project. Your conversation." }),
  ).toBeVisible();
  await page.screenshot({ path: join(screenshots, "01-connect.png") });
  await openSignIn(page);
  await page
    .getByLabel("Gitea server", { exact: true })
    .fill(fixture.serverUrl);
  await page
    .getByLabel("Personal access token", { exact: true })
    .fill("test-token");
  await page.getByRole("button", { name: "Connect to Gitea" }).click();
  await openInbox(page);
  await expect(
    page.getByRole("button", { name: /Make pull request reviews/ }),
  ).toBeVisible();
  expect(fixture.requests.some((r) => r.path.includes("/raw/"))).toBe(false);
  await page.getByRole("button", { name: /Make pull request reviews/ }).click();
  await expect(page.locator("diffs-container")).toBeVisible();
  const requestsPane = page.getByRole("region", {
    name: "Pull requests",
    exact: true,
  });
  const filesPane = page.getByRole("region", {
    name: "Changed files",
    exact: true,
  });
  await expect(
    requestsPane.getByRole("textbox", { name: "Search pull requests" }),
  ).toBeVisible();
  await expect(
    filesPane.getByRole("textbox", { name: "Filter files" }),
  ).toBeVisible();
  const requestsBox = (await requestsPane.boundingBox())!;
  const filesBox = (await filesPane.boundingBox())!;
  expect(requestsBox.x + requestsBox.width).toBeLessThanOrEqual(filesBox.x);
  expect(filesBox.x + filesBox.width).toBeLessThanOrEqual(
    (await page.getByRole("main").boundingBox())!.x,
  );
  await page
    .getByRole("button", { name: "Hide changed files", exact: true })
    .click();
  await expect(filesPane).toHaveCount(0);
  await expect(requestsPane).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle changed files", exact: true })
    .click();
  await expect(filesPane).toBeVisible();
  await expect(
    page.getByText("Could we check response.ok before decoding?", {
      exact: false,
    }),
  ).toBeVisible();
  await expect
    .poll(() => fixture.requests.filter((r) => r.path.includes("/raw/")).length)
    .toBe(2);
  await expect
    .poll(() => page.locator("[data-line] span[style]").count())
    .toBeGreaterThan(5);
  await page.screenshot({ path: join(screenshots, "02-review.png") });
  await page.getByRole("button", { name: "Viewed V" }).click();
  await expect(
    page.getByRole("combobox", { name: "Current file" }),
  ).toHaveValue("src/components/ReviewPane.tsx");
  await page
    .getByRole("combobox", { name: "Current file" })
    .selectOption("src/hooks/useReview.ts");
  await expect(
    page.getByRole("heading", { name: "One file closer." }),
  ).toBeVisible();
  await expect(page.locator("diffs-container")).toHaveCount(0);
  await expect(page.getByText("1 of 72 reviewed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Saved locally" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Improve session expiry/ }).click();
  await expect(page.locator("diffs-container")).toBeVisible();
  await expect(page.getByText("0 of 72 reviewed")).toBeVisible();
  await page.getByRole("button", { name: /Make pull request reviews/ }).click();
  await expect(
    page.getByRole("heading", { name: "One file closer." }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Make pull request reviews/ }).click();
  await expect(
    page.getByRole("heading", { name: "One file closer." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand file", exact: true }).click();
  await expect(page.locator("diffs-container")).toBeVisible();
  const line = page.locator('[data-column-number="20"]').last();
  await line.click();
  await expect(
    page.getByRole("button", { name: "Comment", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Line comment", exact: true })
    .fill("Handle failed HTTP responses before decoding.");
  await page.getByRole("button", { name: "Add draft", exact: true }).click();
  await expect(page.getByText("Pending review")).toBeVisible();
  await page.screenshot({ path: join(screenshots, "03-comment.png") });
  await page.getByRole("button", { name: /Finish review/ }).click();
  await page.getByLabel("Review summary").fill("Please handle the error path.");
  await page
    .getByRole("button", { name: "Submit review", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    fixture.requests.some(
      (r) => r.method === "POST" && r.path.endsWith("/reviews"),
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Reply", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Reply to line comment" })
    .fill("Agreed, this should preserve the error state.");
  await page.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(
    page.getByText("Agreed, this should preserve the error state."),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Current file" })
    .selectOption("src/large.ts");
  await expect(page.locator("diffs-container")).toBeVisible();
  await expect
    .poll(() => page.locator("[data-line]").count())
    .toBeGreaterThan(5);
  expect(await page.locator("[data-line]").count()).toBeLessThan(800);
  await expect(
    page.getByText("Large file · fast text view keeps memory low"),
  ).toBeVisible();
  const memory = await app.evaluate(async ({ app }) =>
    app.getAppMetrics().map((m) => ({ type: m.type, memory: m.memory })),
  );
  console.log("MEMORY_METRICS", JSON.stringify(memory));
  console.log("LIVE_CODE_ROWS", await page.locator("[data-line]").count());
  await page.screenshot({ path: join(screenshots, "04-large-diff.png") });
  await page
    .getByRole("combobox", { name: "Current file" })
    .selectOption("assets/logo.png");
  await expect(
    page.getByRole("heading", { name: "Binary or Git LFS file" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Current file" })
    .selectOption("src/hooks/useReview.ts");
  await page.getByRole("button", { name: "Expand file", exact: true }).click();
  await expect(page.locator("diffs-container")).toBeVisible();
  await page.screenshot({
    path: join(screenshots, "05-dark.png"),
    animations: "disabled",
  });
  const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  expect(JSON.stringify(state)).not.toContain("test-token");
});

test("navigation, file pagination, stale reviews and line bookmarks", async () => {
  await page
    .getByRole("button", { name: "Assigned to me", exact: true })
    .click();
  await expect
    .poll(() => fixture.requests.some((r) => r.query.assigned === "true"))
    .toBe(true);
  await page
    .getByRole("textbox", { name: "Search pull requests" })
    .fill("session");
  await expect(
    page.getByRole("button", { name: /Improve session expiry/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Make pull request reviews/ }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search pull requests" }).fill("");
  await page.getByRole("button", { name: "Open PR by URL ⌘K" }).click();
  await page
    .getByLabel("Gitea pull request URL")
    .fill(fixture.serverUrl + "/Web/web-store/pulls/7/files");
  await page
    .getByRole("button", { name: "Open pull request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Filter files" }).fill("file-63");
  await expect(page.getByRole("button", { name: /file-63.tsx/ })).toBeVisible();
  await expect
    .poll(() =>
      fixture.requests.some(
        (r) => r.path.endsWith("/files") && r.query.page === "2",
      ),
    )
    .toBe(true);
  await page.getByRole("textbox", { name: "Filter files" }).fill("");
  await page
    .getByRole("combobox", { name: "Current file" })
    .selectOption("src/lib/cache.ts");
  await expect(page.locator("diffs-container")).toBeVisible();
  await page.locator('[data-column-number="20"]').last().click();
  await page.getByRole("button", { name: "Mark for later" }).click();
  await expect(page.getByText("Marked for later · lines 20–20")).toBeVisible();
  await page.getByRole("button", { name: /Finish review/ }).click();
  await page.getByLabel("Review summary").fill("Saved review summary");
  await page.getByRole("button", { name: "Keep reviewing" }).click();
  await page.getByRole("button", { name: /Finish review/ }).click();
  await expect(page.getByLabel("Review summary")).toHaveValue(
    "Saved review summary",
  );
  fixture.setHead("c".repeat(40));
  const before = fixture.requests.filter(
    (r) => r.method === "POST" && r.path.endsWith("/reviews"),
  ).length;
  await page
    .getByRole("button", { name: "Submit review", exact: true })
    .click();
  await expect(
    page.getByText(
      "A new commit arrived. Refresh and review it before submitting.",
    ),
  ).toBeVisible();
  expect(
    fixture.requests.filter(
      (r) => r.method === "POST" && r.path.endsWith("/reviews"),
    ).length,
  ).toBe(before);
  await page.getByRole("button", { name: "Keep reviewing" }).click();
  await page.getByRole("button", { name: "Refresh pull requests" }).click();
  await expect(page.getByText("0 of 72 reviewed")).toBeVisible();
  await page.getByRole("button", { name: "Unified diff" }).click();
  await expect(page.locator("diffs-container")).toBeVisible();
  await page.getByRole("button", { name: "Wrap long lines" }).click();
  await page.getByRole("button", { name: "Show unchanged lines" }).click();
  await expect(page.locator('[data-column-number="1"]').first()).toBeVisible();
  await page.getByRole("separator", { name: "Resize file list" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("separator", { name: "Resize file list" }),
  ).toHaveAttribute("aria-valuenow", "292");
});

test("viewed advances across file pages, skips read files and stops at completion", async () => {
  fixture.setHead(HEAD);
  const ref = { owner: "Web", name: "web-store", number: 7 };
  const paths = await page.evaluate(async (ref) => {
    const first = await window.relay.files(ref, 1);
    const second = await window.relay.files(ref, 2);
    const files = [...first.items, ...second.items];
    const pull = await window.relay.pull(ref);
    const progress = await window.relay.progress(ref);
    progress.read = Object.fromEntries(
      files
        .filter((_, i) => ![49, 51, 71].includes(i))
        .map((f) => [f.filename, `${pull.merge_base}:${pull.head.sha}`]),
    );
    await window.relay.saveProgress(ref, progress);
    return files.map((f) => f.filename);
  }, ref);
  await page.reload();
  await page.getByRole("button", { name: /Make pull request reviews/ }).click();
  const currentFile = page.getByRole("combobox", { name: "Current file" });
  await currentFile.selectOption(paths[49]);
  await expect(
    page.getByRole("button", { name: "Load more files" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Viewed V" }).click();
  await expect(currentFile).toHaveValue(paths[51]);
  // Unmarking stays put; marking via the keyboard follows the same path as clicking.
  await currentFile.selectOption(paths[49]);
  await page.getByRole("button", { name: "Viewed V" }).click();
  await expect(currentFile).toHaveValue(paths[49]);
  await page
    .getByRole("heading", {
      name: "Make pull request reviews faster and more reliable",
    })
    .click();
  await page.keyboard.press("v");
  await expect(currentFile).toHaveValue(paths[51]);
  await page.keyboard.press("v");
  await expect(currentFile).toHaveValue(paths[71]);
  await page.keyboard.press("v");
  await expect(currentFile).toHaveValue(paths[71]);
  await expect(
    page.getByRole("heading", { name: "All files reviewed." }),
  ).toBeVisible();
  await expect(page.getByText("72 of 72 reviewed")).toBeVisible();
});

test("Codex handoff validates the checkout and safely carries the comment", async () => {
  const { execFileSync } = await import("node:child_process");
  const { writeFile, chmod } = await import("node:fs/promises");
  const repoDir = await mkdtemp(join(tmpdir(), "relay-checkout-"));
  const git = (args: string[]) =>
    execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8" }).trim();
  git(["init", "--quiet"]);
  git(["config", "user.name", "Relay test"]);
  git(["config", "user.email", "test@example.invalid"]);
  await writeFile(join(repoDir, "README.md"), "Test repository\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "Initial commit"]);
  git(["remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git"]);
  const head = git(["rev-parse", "HEAD"]);
  const binDir = await mkdtemp(join(tmpdir(), "relay-test-bin-"));
  await writeFile(join(binDir, "codex"), "#!/bin/sh\nexit 0\n");
  await chmod(join(binDir, "codex"), 0o700);
  const capturePath = join(binDir, "terminal-args.txt");
  for (const terminal of ["xdg-terminal-exec", "x-terminal-emulator"]) {
    await writeFile(
      join(binDir, terminal),
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${capturePath}'\n`,
    );
    await chmod(join(binDir, terminal), 0o700);
  }
  await app.evaluate((_electron, binDir) => {
    process.env.PATH = binDir + ":" + process.env.PATH;
  }, binDir);
  fixture.setHead(head);
  await app.evaluate(({ dialog, shell }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    shell.openPath = async (path) => {
      (globalThis as any).relayCapturedTerminal = path;
      return "";
    };
  }, repoDir);
  // Keep the real IPC, filesystem, Git validation and script creation; intercept only OS terminal launch.
  const ref = { owner: "Web", name: "web-store", number: 7 };
  const local = await page.evaluate((r) => window.relay.linkFolder(r), ref);
  expect(local?.head).toBe(head);
  const comment =
    "Handle Bob's input $(touch should-not-exist) `echo unsafe`\nKeep user data.";
  await page.evaluate(
    async ({ ref, head, comment }) =>
      window.relay.launchCodex(
        ref,
        head,
        "src/lib/cache.ts",
        20,
        "additions",
        comment,
      ),
    { ref, head, comment },
  );
  let commandPath: string;
  if (process.platform === "darwin")
    commandPath = await app.evaluate(
      () => (globalThis as any).relayCapturedTerminal as string,
    );
  else {
    await expect
      .poll(async () => readFile(capturePath, "utf8").catch(() => ""))
      .toContain(".command");
    commandPath = (await readFile(capturePath, "utf8"))
      .trim()
      .split("\n")
      .at(-1)!;
  }
  const script = await readFile(commandPath, "utf8");
  // Every argument is shell-quoted, the executable path included.
  expect(script).toContain("'--sandbox' 'workspace-write'");
  expect(script).toContain("'--ask-for-approval' 'on-request'");
  expect(script).not.toContain(comment);
  execFileSync("/bin/sh", ["-n", commandPath]);
  const prompt = await readFile(
    commandPath.replace(".command", ".txt"),
    "utf8",
  );
  expect(prompt).toContain(comment);
  expect(prompt).toContain(head);
  await writeFile(join(repoDir, "README.md"), "Changed\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "Different commit"]);
  await expect(
    page.evaluate(
      async ({ ref, head }) =>
        window.relay.launchCodex(ref, head, "a.ts", 1, "additions", "Fix this"),
      { ref, head },
    ),
  ).rejects.toThrow("different commit");
});

test("saved account reconnects after a full desktop restart", async () => {
  const bootstrap = await page.evaluate(() => window.relay.bootstrap());
  test.skip(
    !bootstrap.account?.persistent,
    "System credential storage is unavailable on this desktop",
  );
  await app.close();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
    ),
  ) as Record<string, string>;
  app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: { ...env, RELAY_TEST_DATA: dataDir },
  });
  page = await app.firstWindow();
  await expect(
    page.getByRole("button", { name: /Make pull request reviews/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Make room for a better review." }),
  ).toHaveCount(0);
});

test("sidebars hide independently, preserve the review and remain recoverable after reload", async () => {
  const workspace = page.getByRole("complementary", { name: "Workspace" });
  const files = page.getByRole("region", {
    name: "Changed files",
    exact: true,
  });
  const requestsToggle = page.getByRole("button", {
    name: "Toggle pull requests",
    exact: true,
  });
  const filesToggle = page.getByRole("button", {
    name: "Toggle changed files",
    exact: true,
  });
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page
    .getByRole("button", { name: "Needs my review", exact: true })
    .click();
  await page.getByRole("button", { name: /Make pull request reviews/ }).click();
  const currentFile = page.getByRole("combobox", { name: "Current file" });
  await currentFile.selectOption("src/hooks/useReview.ts");
  await expect(currentFile).toHaveValue("src/hooks/useReview.ts");
  await expect(page.locator("diffs-container")).toBeVisible();
  const path = await currentFile.inputValue();
  const filesWidth = (await files.boundingBox())!.width;
  const startingDiffWidth = (await page.getByRole("main").boundingBox())!.width;
  const rawRequests = fixture.requests.filter((r) =>
    r.path.includes("/raw/"),
  ).length;

  await page
    .getByRole("button", { name: "Hide pull requests", exact: true })
    .click();
  await expect(workspace).toHaveCount(0);
  await expect(files).toBeVisible();
  await expect(requestsToggle).toHaveAttribute("aria-pressed", "false");
  expect((await files.boundingBox())!.x).toBe(0);
  expect((await files.boundingBox())!.width).toBe(filesWidth);
  await page.screenshot({ path: join(screenshots, "06-files-only.png") });

  await page
    .getByRole("button", { name: "Hide changed files", exact: true })
    .click();
  await expect(files).toHaveCount(0);
  await expect(workspace).toHaveCount(0);
  await expect(filesToggle).toHaveAttribute("aria-pressed", "false");
  await expect(currentFile).toHaveValue(path);
  expect((await page.getByRole("main").boundingBox())!.width).toBeGreaterThan(
    startingDiffWidth + filesWidth,
  );
  expect(fixture.requests.filter((r) => r.path.includes("/raw/")).length).toBe(
    rawRequests,
  );
  await page.screenshot({ path: join(screenshots, "07-review-only.png") });

  await page.reload();
  await expect(currentFile).toHaveValue(path);
  await expect(workspace).toHaveCount(0);
  await expect(files).toHaveCount(0);
  await expect(requestsToggle).toBeVisible();
  await expect(filesToggle).toBeVisible();
  await page.keyboard.press(`${modifier}+f`);
  await expect(workspace).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search pull requests" }),
  ).toBeFocused();
  await expect(files).toHaveCount(0);
  await page
    .getByRole("button", { name: "All pull requests", exact: true })
    .click();
  await expect(files).toHaveCount(0);
  await page.keyboard.press(`${modifier}+Shift+b`);
  await expect(workspace).toHaveCount(0);
  await page.keyboard.press(`${modifier}+b`);
  await expect(files).toBeVisible();
  await expect(workspace).toHaveCount(0);
  await requestsToggle.click();
  await expect(workspace).toBeVisible();
  await expect(filesToggle).toHaveAttribute("aria-pressed", "true");
  await expect(requestsToggle).toHaveAttribute("aria-pressed", "true");
});
