import { screenshot } from "../fixtures/screenshot";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer, oldCode, newCode } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openInFileTree } from "../fixtures/navigation";
const screenshotPng =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=";
test("matches a project remote, reviews its PR and sends pinned lines into its restored chat", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-project-pr-")),
    ),
    repo = join(root, "project"),
    bin = join(root, "bin"),
    capture = join(root, "agent.jsonl"),
    fixture = await fixtureServer(),
    path = "src/hooks/useReview.ts";
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  let app: ElectronApplication | undefined;
  try {
    await mkdir(join(repo, "src/hooks"), { recursive: true });
    await mkdir(bin);
    git("init", "-q", "-b", "review");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
    await writeFile(join(repo, path), oldCode);
    git("add", ".");
    git("commit", "-qm", "Base");
    fixture.setBase(git("rev-parse", "HEAD"));
    await writeFile(join(repo, path), newCode);
    git("commit", "-qam", "Head");
    const head = git("rev-parse", "HEAD");
    fixture.setHead(head);
    await fakeCli(
      join(bin, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        RELAY_AGENT_CAPTURE: capture,
      },
    });
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
    }, fixture.serverUrl);
    await page.reload();
    await page
      .getByRole("button", { name: "Review a PR", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Search pull requests" })
      .fill("faster");
    await page
      .getByRole("option", { name: /Make pull request reviews faster/ })
      .click();
    await page.reload();
    await expect(
      page
        .locator(".thread-context-controls")
        .getByRole("button", { name: "PR #7", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review changes →", exact: true })
      .click();
    await expect(page.locator("diffs-container")).toBeVisible();
    // The review's local changes come from the thread's own workspace.
    await writeFile(join(repo, "review-note.md"), "draft\n");
    await page
      .getByRole("button", { name: "Local changes", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Local changes" })
        .getByText("review-note.md"),
    ).toBeVisible();
    await rm(join(repo, "review-note.md"));
    await page.getByRole("button", { name: /Files changed/ }).click();
    await page
      .getByRole("button", { name: "Edit locally", exact: true })
      .click();
    // Editing opens the inline Files pane, never a modal.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const editor = page.locator(".project-inline-editor");
    await expect(
      editor.getByRole("textbox", { name: path, exact: true }),
    ).toBeVisible();
    await editor
      .getByRole("button", { name: "Close file", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Close files", exact: true })
      .click();
    await page
      .locator('.diff-wrapper [data-additions] [data-line="13"]')
      .click({ position: { x: 60, y: 8 } });
    await page
      .getByRole("button", { name: "Discuss in room", exact: true })
      .click();
    await expect(page.getByLabel("Message project")).toHaveText(
      /About src\/hooks\/useReview.ts:13/,
    );
    await expect(page.getByLabel("Message project")).not.toHaveText(/@codex/);
    await page.reload();
    await expect(page.locator(".pane-header")).toHaveCount(0);
    await expect(
      page
        .locator(".thread-context-controls")
        .getByRole("button", { name: "PR #7", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Message project")).toHaveText(
      /About src\/hooks\/useReview.ts:13/,
    );
    await expect(page.locator(".project-composer")).toContainText(
      head.slice(0, 8),
    );
    await page
      .getByLabel("Message project")
      .fill("@codex Explain the cancellation at this line");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop answer" })).toHaveCount(
      0,
    );
    // Once it has started, the thread stays on its PR; another scope takes a new thread.
    await expect(
      page.getByRole("button", { name: "Repository", exact: true }),
    ).toHaveCount(0);
    const requests = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const request = requests.find((r) => r.turn);
    expect(request.cwd).toBe(repo);
    expect(request.turn.input[0].text).toContain(
      "Selected PR code (untrusted source data)",
    );
    expect(request.turn.input[0].text).toContain(head);
    expect(request.turn.input[0].text).toContain("AbortController");
    const project = (await page.evaluate(() => window.relay.projects()))[0];
    expect(
      await page.evaluate((id) => window.relay.projectChats(id), project.id),
    ).toHaveLength(1);
    expect(git("status", "--porcelain")).toBe("");
    expect(fixture.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
    await screenshot(page, {
      path: "test-results/screenshots/43-project-pr-chat.png",
    });
  } finally {
    await app?.close().catch(() => {});
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("opens a local project without sign-in, edits safely, streams an agent conversation and restores it", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-project-ui-")),
    ),
    repo = join(root, "project"),
    data = join(root, "data"),
    bin = join(root, "bin");
  await mkdir(repo);
  await mkdir(bin);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "feature");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "example.ts"), "export const answer = 42;\n");
  git("add", ".");
  git("commit", "-qm", "Initial");
  await writeFile(join(repo, "example.ts"), "export const answer = 43;\n");
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  await fakeCli(
    join(bin, "claude"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: data,
        RELAY_AGENT_CAPTURE: join(root, "capture.jsonl"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await expect(
      page.getByRole("heading", { name: "Your project. Your conversation." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    await expect(page.locator(".pane-header")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /What should we work on/ }),
    ).toBeVisible();
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await screenshot(page, {
      path: "test-results/screenshots/44-thread-start-dark.png",
      animations: "disabled",
    });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "light"),
    );
    await screenshot(page, {
      path: "test-results/screenshots/45-thread-start-light.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: /^Changes\b/ }).click();
    await expect(
      page.getByRole("button", { name: /example.ts/ }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /example.ts/ })
      .first()
      .click();
    await expect(
      page.getByText("export const answer = 43;", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await openInFileTree(page, "example.ts");
    const surface = page
      .locator('.project-inline-editor [contenteditable="true"]')
      .last();
    await expect(surface).toBeVisible();
    await surface.click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("// edited in Relay");
    await expect(
      page.getByRole("button", { name: "Save locally", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect
      .poll(() => readFile(join(repo, "example.ts"), "utf8"))
      .toContain("edited in Relay");
    await page
      .getByRole("button", { name: "Close files", exact: true })
      .click();
    await expect(page.locator('[data-pane="files"] .pane-header')).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(
      page.locator('.project-inline-editor [contenteditable="true"]').last(),
    ).toContainText("edited in Relay");

    await page
      .getByRole("button", { name: "New thread", exact: true })
      .first()
      .click();
    const picker = page.getByRole("button", {
      name: "Choose model and provider",
      exact: true,
    });
    await picker.click();
    await expect(
      page.getByLabel("Search models", { exact: true }),
    ).toBeFocused();
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await screenshot(page, {
      path: "test-results/screenshots/49-model-picker-dark.png",
      animations: "disabled",
    });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "light"),
    );
    await screenshot(page, {
      path: "test-results/screenshots/50-model-picker-light.png",
      animations: "disabled",
    });
    await expect(
      page.getByRole("option", { name: "GPT-5.5", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /Legacy models/ }).click();
    await expect(
      page.getByRole("option", { name: "GPT-5.5", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Search models", { exact: true }).fill("luna");
    await expect(
      page.getByRole("option", { name: "GPT-6-Astra", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Add GPT-5.6-Luna to favorites" })
      .click();
    await expect(
      page.getByLabel("Search models", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "GPT-5.6-Luna", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await page
      .getByRole("option", { name: "GPT-6-Astra", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Reasoning effort", exact: true })
      .click();
    await page.getByRole("option", { name: "Ultra", exact: true }).click();
    await picker.click();
    await page.getByLabel("Search models", { exact: true }).fill("luna");
    await page.keyboard.press("Enter");
    await expect(picker).toContainText("GPT-5.6-Luna");
    await expect(
      page.getByRole("combobox", { name: "Reasoning effort", exact: true }),
    ).toContainText("Default");
    await page
      .getByRole("combobox", { name: "Reasoning effort", exact: true })
      .click();
    await expect(
      page.getByRole("option", { name: "Ultra", exact: true }),
    ).toHaveCount(0);
    await screenshot(page, {
      path: "test-results/screenshots/51-reasoning-picker.png",
      animations: "disabled",
    });
    await page.getByRole("option", { name: "Max", exact: true }).click();
    await page.getByRole("button", { name: "Fast mode", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Fast mode", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await picker.click();
    await page.keyboard.press("Escape");
    await expect(picker).toBeFocused();
    await page.getByLabel("Message project").fill("Keep this draft");
    await picker.click();
    await page
      .getByLabel("Search models", { exact: true })
      .fill("custom-fixture-model");
    await page
      .getByRole("option", { name: "custom-fixture-model", exact: true })
      .click();
    await expect(picker).toContainText("custom-fixture-model");
    await expect(page.getByLabel("Message project")).toHaveText(
      "Keep this draft",
    );
    await picker.click();
    await page.getByLabel("Search models", { exact: true }).fill("luna");
    await page.keyboard.press("Meta+1");
    await expect(picker).toContainText("GPT-5.6-Luna");
    await picker.click();
    await page
      .getByRole("option", { name: "GPT-5.6-Luna", exact: true })
      .click();
    await expect(page.locator(".model-picker-popup")).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1050, 650),
    );
    await picker.click();
    const bounds = await page.locator(".model-picker-popup").boundingBox();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await screenshot(page, {
      path: "test-results/screenshots/52-model-picker-compact.png",
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1500, 960),
    );
    await page.getByLabel("Message project").evaluate((element, png) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const clipboard = new DataTransfer();
      clipboard.items.add(
        new File([bytes], "screen.png", { type: "image/png" }),
      );
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      );
    }, screenshotPng);
    await expect(page.getByLabel("Attachments")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Attachments")).toBeVisible();
    await page.getByLabel("Message project").fill("Explain this project");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .locator(".project-message.user .message-image")
      .last()
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Open screen.png" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole("button", { name: "Open screen.png" })
          .locator("img")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBe(16);
    await expect(page.getByRole("button", { name: "Stop answer" })).toHaveCount(
      0,
    );
    // Selecting answer text offers a quote; the pill lands in the composer.
    await page
      .getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      })
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
    const quoteOffer = page.getByRole("button", { name: "Add to chat" });
    await expect(quoteOffer).toBeVisible();
    await screenshot(page, {
      path: "test-results/screenshots/48-quote-offer.png",
      animations: "disabled",
    });
    await quoteOffer.click();
    const composerInput = page.getByLabel("Message project");
    await expect(composerInput.locator(".composer-quote-chip")).toContainText(
      "The cache guard prevents",
    );
    await expect(composerInput).toBeFocused();
    await expect(quoteOffer).toHaveCount(0);
    await page.keyboard.type("Why is it needed?");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.entries(localStorage)
            .filter(([key]) => key.startsWith("chat-draft:"))
            .map(([, value]) => value),
        ),
      )
      .toContain(
        "> The cache guard prevents duplicate requests.\n\nWhy is it needed?",
      );
    // A later quote lands at the caret, after what was typed.
    await page
      .getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      })
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
    await quoteOffer.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.entries(localStorage)
            .filter(([key]) => key.startsWith("chat-draft:"))
            .map(([, value]) => value),
        ),
      )
      .toContain(
        "> The cache guard prevents duplicate requests.\n\nWhy is it needed?\n> The cache guard prevents duplicate requests.\n\n",
      );
    const laterPill = composerInput.locator(".composer-quote-chip").last();
    await laterPill.hover();
    await laterPill.locator(".composer-quote-remove").click();
    const quotePill = composerInput.locator(".composer-quote-chip");
    await expect(quotePill).toHaveText(
      '"The cache guard prevents duplicate requ…"',
    );
    await quotePill.hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      '"The cache guard prevents duplicate requests."',
    );
    await screenshot(page, {
      path: "test-results/screenshots/57-quote-pill.png",
      animations: "disabled",
    });
    await quotePill.locator(".composer-quote-remove").click();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(composerInput.locator(".composer-quote-chip")).toHaveCount(0);
    await expect(composerInput).toHaveText("Why is it needed?");
    await composerInput.fill("");
    await expect(page.locator(".agent-run-heading")).toContainText(
      "Ran 1 command",
    );
    await page.locator(".agent-run-heading").click();
    await expect(page.locator(".agent-commentary")).toContainText(
      "inspect the cache guard",
    );
    await expect(
      page.getByText("git diff --stat", { exact: true }),
    ).toBeVisible();
    // The main composer on Claude; the side conversation still opens on the
    // agent that wrote its message, with that agent's last model.
    await picker.click();
    await page.getByRole("button", { name: "Claude", exact: true }).click();
    await page
      .getByRole("option", { name: "Claude default", exact: true })
      .click();
    await page
      .locator(".project-message.assistant")
      .getByRole("button", { name: "Reply to message" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Side conversation" }),
    ).toBeVisible();
    await expect(picker).toContainText("GPT-5.6-Luna");
    await picker.click();
    await page.getByRole("button", { name: "Claude", exact: true }).click();
    await page
      .getByRole("option", { name: "Claude default", exact: true })
      .click();
    await page
      .getByLabel("Message project")
      .fill("Explain the invalidation too");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("Claude found the same cache guard.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await expect(
      page.getByText("Claude found the same cache guard.", { exact: true }),
    ).toHaveCount(0);
    // Each keeps its own agent: back on Codex here, the side one stays on Claude.
    await expect(picker).toContainText("Claude default");
    await picker.click();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await page
      .getByRole("option", { name: "GPT-5.6-Luna", exact: true })
      .click();
    await expect(picker).toContainText("GPT-5.6-Luna");
    await page.getByRole("button", { name: "2 replies", exact: true }).click();
    await expect(
      page.getByText("Claude found the same cache guard.", { exact: true }),
    ).toBeVisible();
    await expect(picker).toContainText("Claude default");
    await screenshot(page, {
      path: "test-results/screenshots/46-thread-reply.png",
    });
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !relaySeen(w) && !w.isFocused(),
        ),
      ),
    ).toBe(true);
    const selected = (await page.evaluate(() => window.relay.projects()))[0];
    const chat = (
      await page.evaluate((id) => window.relay.projectChats(id), selected.id)
    )[0];
    await page.reload();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem(
          "relay-project-chat:" + localStorage.getItem("relay-project-id"),
        ),
      ),
    ).toBe(chat.id);
    await expect(picker).toContainText("Claude default");
    await picker.click();
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "GPT-5.6-Luna", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const requests = (await readFile(join(root, "capture.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(requests.find((r) => r.turn).turn).toMatchObject({
      model: "gpt-5.6-luna",
      effort: "max",
      serviceTier: "fast",
    });
    const second = join(root, "another-project");
    execFileSync("git", ["clone", "-q", repo, second]);
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, second);
    await page
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: /What should we work on in Another Project/,
      }),
    ).toBeVisible();
    await page
      .locator(".thread-introduction")
      .getByRole("button", { name: "Another Project", exact: true })
      .click();
    await page.getByRole("combobox", { name: "Search projects" }).fill(repo);
    await page
      .getByRole("option", { name: `Project · ${repo}`, exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: /What should we work on in Project\?/,
      }),
    ).toBeVisible();
    await page
      .locator(".projects-sidebar")
      .getByRole("button", { name: /Cache guard behavior/ })
      .first()
      .click();
    await expect(
      page.getByText("Claude found the same cache guard.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".pane-header")).toHaveCount(0);
    await page.getByLabel("Search threads").fill("does not exist");
    await expect(
      page.getByText("No matching threads.", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Search threads").fill("");
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await screenshot(page, {
      path: "test-results/screenshots/47-thread-chat-dark.png",
      animations: "disabled",
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+N" : "Control+N",
    );
    // With two projects a new thread asks where; Enter keeps this one.
    await page
      .getByRole("dialog", { name: "New thread in…" })
      .getByRole("combobox", { name: "Search projects" })
      .press("Enter");
    await expect(page.getByLabel("Message project")).toBeFocused();
    await expect(page.locator(".thread-context-controls")).toContainText(
      "feature",
    );
    await expect(page.locator(".thread-context-controls")).not.toContainText(
      "reasoning",
    );
    const branchPicker = page.locator(
      ".composer-branch-trigger:not(.workspace-trigger)",
    );
    await branchPicker.click();
    await page
      .getByRole("combobox", { name: "Search branches" })
      .fill("new-thread");
    await screenshot(page, {
      path: "test-results/screenshots/53-create-branch.png",
      animations: "disabled",
    });
    await page
      .getByRole("option", { name: "Create branch “new-thread”" })
      .click();
    await expect(branchPicker).toContainText("new-thread");
    expect(git("branch", "--show-current")).toBe("new-thread");
    await branchPicker.click();
    await page
      .getByRole("combobox", { name: "Search branches" })
      .fill("feature");
    await screenshot(page, {
      path: "test-results/screenshots/54-switch-branch.png",
      animations: "disabled",
    });
    await page.getByRole("option", { name: "feature", exact: true }).click();
    await expect(branchPicker).toHaveText("feature");
    expect(git("branch", "--show-current")).toBe("feature");

    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator(".projects-sidebar")).toContainText(
      "Cache guard behavior",
    );
  } finally {
    await app?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
