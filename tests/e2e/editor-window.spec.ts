import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "../fixtures/electron";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openInFileTree, openSurface } from "../fixtures/navigation";

// A workspace's editor popped out into a window of its own: unsaved text
// moves with it, the main window keeps a note instead of a second editor,
// files clicked in the chat open in the window, and it goes back and
// comes back after a restart.
test.setTimeout(180_000);

test("the editor pops out with its unsaved text, saves there, comes back, and reopens after a restart", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-ewin-")));
  const repo = join(root, "project"),
    data = join(root, "data");
  await mkdir(repo);
  await mkdir(join(data, "project-chats"), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "hello.txt"), "hello\n");
  await mkdir(join(repo, "src"));
  await writeFile(join(repo, "src/other.ts"), "export const other = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Base");

  const projectId = randomUUID();
  const now = Date.now();
  const chat = {
    id: randomUUID(),
    projectId,
    title: "Edit things",
    scope: { kind: "project" },
    created: now - 60_000,
    updated: now,
    messages: [
      {
        id: randomUUID(),
        role: "user",
        provider: "codex",
        status: "complete",
        body: "@codex look at the files",
        created: now - 30_000,
        version: 1,
      },
      {
        id: randomUUID(),
        role: "assistant",
        provider: "codex",
        status: "complete",
        body: "Have a look at `src/other.ts` next.",
        created: now,
        ended: now,
        version: 1,
      },
    ],
  };
  await writeFile(
    join(data, "project-chats", chat.id + ".json"),
    JSON.stringify(chat),
  );
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      projects: [
        {
          id: projectId,
          path: repo,
          name: "project",
          repository: null,
          added: 1,
        },
      ],
      chats: [{ ...chat, messages: undefined, provider: "codex" }],
    }),
  );

  const launch = () =>
    electron.launch({ env: { ...relayEnv(), RELAY_TEST_DATA: data } });
  const saved = async () =>
    JSON.parse(await readFile(join(data, "state.json"), "utf8"))
      .editorWindows as { where: string }[] | undefined;
  const onDisk = (file: string) => readFile(join(repo, file), "utf8");
  const editorOf = (app: ElectronApplication) =>
    app
      .windows()
      .find((w) => new URL(w.url()).searchParams.get("editor") === projectId);
  const textbox = (page: Page) =>
    page.locator('.project-inline-editor [contenteditable="true"]');
  const save = async (page: Page) => {
    await textbox(page).click();
    await page.keyboard.press("ControlOrMeta+s");
  };
  const quit = async (app: ElectronApplication) => {
    const closed = app.waitForEvent("close");
    await app.evaluate(({ app }) => app.quit());
    await closed;
  };

  let app = await launch();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.evaluate(() =>
      localStorage.setItem("relay-sidebar-view", "activity"),
    );
    await page.reload();
    await page
      .locator(".sb-card")
      .filter({
        has: page.locator(".sb-card-title", { hasText: "Edit things" }),
      })
      .click();
    await openSurface(page, "Files");
    await openInFileTree(page, "hello.txt");
    await expect(textbox(page)).toContainText("hello");
    await expect(textbox(page)).toBeFocused();

    // An edit that isn't saved: the tab says so.
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("UNSAVED ");
    await expect(page.locator(".editor-tab.unsaved")).toHaveCount(1);

    // Popping out takes the tab and the unsaved text along.
    const opened = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Open editor in new window" })
      .click();
    const own = await opened;
    await expect(own.locator(".editor-tab.active")).toContainText("hello.txt");
    await expect(textbox(own)).toContainText("UNSAVED hello");
    await expect(own.locator(".editor-tab.unsaved")).toHaveCount(1);
    await expect(own.locator(".projects-sidebar")).toHaveCount(0);
    await expect(own).toHaveTitle(/^hello\.txt – project$/i);
    await expect(
      own.getByRole("button", { name: /^Back to the main window/ }),
    ).toBeVisible();
    // Nothing reached the disk by moving.
    expect(await onDisk("hello.txt")).toBe("hello\n");

    // The main window keeps a note, not a second editor.
    const note = page.locator(".editor-elsewhere");
    await expect(note).toContainText("Editing in its own window");
    await expect(page.locator(".files-workspace")).toHaveCount(0);
    await expect(page.locator(".cm-editor")).toHaveCount(0);

    // Saving there writes the file.
    await save(own);
    await expect.poll(() => onDisk("hello.txt")).toBe("UNSAVED hello\n");
    await expect(own.locator(".editor-tab.unsaved")).toHaveCount(0);

    // A file named in the chat opens in that window, which comes forward.
    await page.locator('.chat-file-link[title="src/other.ts"]').click();
    await expect(own.locator(".editor-tab.active")).toContainText("other.ts");
    await expect(own.locator(".window-flash")).toHaveCount(1);
    await expect(note).toBeVisible();
    await expect(page.locator(".cm-editor")).toHaveCount(0);

    // Show window raises it; the note stays.
    await page.getByRole("button", { name: "Show window" }).click();
    await expect(own.locator(".window-flash")).toHaveCount(1);

    // Edit again, and bring it back: the unsaved text returns with it.
    await own.locator(".editor-tab").filter({ hasText: "hello.txt" }).click();
    await textbox(own).click();
    await own.keyboard.press("ControlOrMeta+End");
    await own.keyboard.type("MORE");
    await expect(own.locator(".editor-tab.unsaved")).toHaveCount(1);
    const gone = own.waitForEvent("close");
    await own.getByRole("button", { name: /^Back to the main window/ }).click();
    await gone;
    await expect(note).toHaveCount(0);
    await expect(page.locator(".editor-tab.active")).toContainText("hello.txt");
    await expect(textbox(page)).toContainText("UNSAVED hello");
    await expect(textbox(page)).toContainText("MORE");
    await expect(page.locator(".editor-tab.unsaved")).toHaveCount(1);
    await expect(page.locator(".editor-tab")).toHaveCount(2);
    expect(await onDisk("hello.txt")).toBe("UNSAVED hello\n");
    await expect.poll(saved).toEqual([]);

    // Saved here, popped out once more from the main window's note, and left open.
    await save(page);
    await expect.poll(() => onDisk("hello.txt")).toBe("UNSAVED hello\nMORE");
    const again = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Open editor in new window" })
      .click();
    await again;
    await expect
      .poll(async () => (await saved())?.map((w) => w.where))
      .toEqual([projectId]);

    // Bringing it back from the main window's note asks the window to hand over.
    const comes = editorOf(app)!;
    await comes.locator(".editor-tab.active").click();
    await textbox(comes).click();
    await comes.keyboard.type("!");
    await expect(comes.locator(".editor-tab.unsaved")).toHaveCount(1);
    const closed = comes.waitForEvent("close");
    await page.getByRole("button", { name: "Bring back" }).click();
    await closed;
    await expect(textbox(page)).toContainText("!");
    await expect(page.locator(".editor-tab.unsaved")).toHaveCount(1);
    await save(page);
    await expect.poll(() => onDisk("hello.txt")).toContain("!");

    const last = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Open editor in new window" })
      .click();
    await last;
    await expect
      .poll(async () => (await saved())?.map((w) => w.where))
      .toEqual([projectId]);
    await quit(app);
  } catch (e) {
    // Unsaved edits would hold a normal close open with a dialog.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    throw e;
  }

  // The window left open comes back with Relay, tabs and all.
  app = await launch();
  try {
    await expect.poll(() => app.windows().length).toBe(2);
    const own = editorOf(app)!;
    await expect(own.locator(".editor-tab")).toHaveCount(2);
    await expect(own.locator(".editor-tab.active")).toContainText("hello.txt");
    const page = app
      .windows()
      .find((w) => !new URL(w.url()).searchParams.has("editor"))!;
    await page.setViewportSize({ width: 1500, height: 900 });
    // Closing it by hand puts the editor back and keeps it from reopening.
    const gone = own.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes("editor="))
        ?.close();
    });
    await gone;
    await expect.poll(saved).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
