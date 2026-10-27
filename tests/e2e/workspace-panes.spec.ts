import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  openInFileTree,
  openSurface,
} from "../fixtures/navigation";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("chat and the panel are inline panes that can be reordered; Changes opens beside the editor", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-panes-"))),
    repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(join(repo, "src"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "src/a.ts"), "export const a = 1;\n");
  await writeFile(join(repo, "src/b.ts"), "export const b = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  await writeFile(join(repo, "src/a.ts"), "export const a = 2;\n");
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    const adding = page.getByRole("dialog", {
      name: "Add a project",
      exact: true,
    });
    await adding
      .getByRole("button", { name: "Open a folder", exact: true })
      .click();
    await adding
      .getByRole("button", { name: "Choose in Finder…", exact: true })
      .click();
    const toggles = page.getByRole("group", { name: "Workspace panes" });
    const toggle = (name: string) =>
      toggles.getByRole("button", { name: new RegExp(`^${name}\\b`) });
    const order = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".workspace-pane")]
          .filter((p) => !p.hidden)
          .sort((a, b) => Number(a.style.order) - Number(b.style.order))
          .map((p) => p.dataset.pane),
      );

    // Only the chat is open at first.
    await expect(toggles).toBeVisible();
    await expect(page.locator(".pane-header")).toHaveCount(0);
    expect(await order()).toEqual(["chat"]);

    // An empty panel offers its surfaces; opening a file happens inline
    // and is remembered.
    await toggle("Panel").click();
    await expect(
      page
        .locator(".surface-picker")
        .getByRole("button", { name: "Files", exact: true }),
    ).toBeVisible();
    // The picker is no popup, so the app's shortcuts still work beside it.
    const collapsed = page.locator(".titlebar.sidebar-collapsed");
    await page.keyboard.press("ControlOrMeta+b");
    await expect(collapsed).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+b");
    await expect(collapsed).toHaveCount(0);
    await page.keyboard.press("f");
    await openInFileTree(page, "src/b.ts");
    await expect(
      page.locator(".project-inline-editor").getByRole("textbox", {
        name: "src/b.ts",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close files", exact: true })
      .click();
    await openSurface(page, "Files");
    await expect(
      page.locator(".project-inline-editor").getByRole("textbox", {
        name: "src/b.ts",
        exact: true,
      }),
    ).toBeVisible();
    await toggle("Panel").click();

    // Changes isn't a pane of its own: it lists the folder's changes beside
    // the editor, and never pops the remembered file in a modal. A new thread
    // has no Running card to open it from, so it's the editor's own view.
    await openSurface(page, "Files");
    await page
      .getByRole("tablist", { name: "Sidebar" })
      .getByRole("tab", { name: /^Changes/ })
      .click();
    const local = page.locator(".project-file-list").getByRole("region", { name: "Local changes" });
    await expect(local).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await order()).toEqual(["chat", "panel"]);
    await expect(toggle("Changes")).toHaveCount(0);

    // A change opens in the editor with its changes in place.
    await page.locator('.change-select[aria-label$=" src/a.ts"]').click();
    const editor = page.locator(".project-inline-editor");
    await expect(editor.getByRole("textbox", { name: "src/a.ts", exact: true })).toBeVisible();
    await expect(editor.locator(".cm-changedLine")).toContainText("export const a = 2;");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await order()).toEqual(["chat", "panel"]);

    // Drag a header toggle to reorder the panes; the order and the open
    // panes survive a reload.
    await toggle("Panel").dragTo(toggle("Chat"), {
      targetPosition: { x: 2, y: 5 },
    });
    expect(await order()).toEqual(["panel", "chat"]);
    await page.reload();
    await expect(toggles).toBeVisible();
    await expect.poll(order).toEqual(["panel", "chat"]);

    // Only the toggles drag; a pane's header stays put.
    await expect(
      page.locator('[data-pane="panel"] .pane-header'),
    ).not.toHaveAttribute("draggable", "true");

    // Terminals stack as tabs; everything else opens once.
    await openSurface(page, "Terminal");
    await openSurface(page, "Terminal");
    await openSurface(page, "Files");
    const panel = page.locator('[data-pane="panel"]');
    await expect(panel.locator(".pane-tabs").getByRole("tab")).toHaveText([
      "a.ts",
      "Terminal",
      "Terminal 2",
    ]);
    const fileEditor = panel
      .locator(".project-inline-editor")
      .getByRole("textbox", { name: "src/a.ts", exact: true });
    await fileEditor.press("ControlOrMeta+End");
    await fileEditor.pressSequentially("// Keep while Files is hidden");
    const unsaved = panel.getByText("Unsaved changes", { exact: true });
    await expect(unsaved).toBeVisible();
    await panel.getByRole("tab", { name: "Terminal 2", exact: true }).click();
    await expect(panel.locator(".xterm-rows")).toBeVisible();
    await expect(fileEditor).toBeHidden();
    await openSurface(page, "Files");
    await expect(fileEditor).toContainText("Keep while Files is hidden");
    await expect(unsaved).toBeVisible();
    await fileEditor.press("ControlOrMeta+s");
    await expect(unsaved).toHaveCount(0);
    await expect
      .poll(() => readFile(join(repo, "src/a.ts"), "utf8"))
      .toContain("Keep while Files is hidden");
    await panel.getByRole("tab", { name: "Terminal 2", exact: true }).click();
    await panel
      .getByRole("button", { name: "Close terminal 2", exact: true })
      .click();
    await expect(panel.locator(".pane-tabs").getByRole("tab")).toHaveText(["a.ts", "Terminal"]);

    // Zooming the panel hides the other panes and the sidebar without closing
    // them; asking for another pane brings everything back.
    await panel
      .getByRole("button", { name: "Expand panel", exact: true })
      .click();
    expect(await order()).toEqual(["panel"]);
    await expect(collapsed).toHaveCount(1);
    await expect(panel.locator(".pane-tabs").getByRole("tab")).toHaveText(["a.ts", "Terminal"]);
    await toggle("Chat").click();
    await expect.poll(order).toEqual(["panel", "chat"]);
    await expect(collapsed).toHaveCount(0);

    // Closing its last tab closes the panel, instead of leaving the picker.
    await panel
      .getByRole("button", { name: "Close files", exact: true })
      .click();
    await expect.poll(order).toEqual(["panel", "chat"]);
    await panel
      .getByRole("button", { name: "Close terminal", exact: true })
      .click();
    await expect.poll(order).toEqual(["chat"]);

    // The last visible pane cannot be hidden.
    await expect(toggle("Chat")).toBeDisabled();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("each thread keeps the panes it had open", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-panes-"))),
    repo = join(root, "project"),
    bin = join(root, "bin");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(repo);
  await mkdir(bin);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "README.md"), "# Cache\n");
  git("add", ".");
  git("commit", "-qm", "Base");
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
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    const toggles = page.getByRole("group", { name: "Workspace panes" });
    const toggle = (name: string) =>
      toggles.getByRole("button", { name: new RegExp(`^${name}\\b`) });
    const order = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".workspace-pane")]
          .filter((p) => !p.hidden)
          .sort((a, b) => Number(a.style.order) - Number(b.style.order))
          .map((p) => p.dataset.pane),
      );
    const send = async (text: string) => {
      await page.getByLabel("Message project").fill(text);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByText("The cache guard prevents duplicate requests.").first(),
      ).toBeVisible();
    };
    const sidebar = page.locator(".projects-sidebar");
    // Both threads get the fixture's title, so each is renamed once it has.
    const rename = async (title: string) => {
      const current = () =>
        page.evaluate(async () => {
          const project = localStorage.getItem("relay-project-id")!;
          const id = localStorage.getItem("relay-project-chat:" + project);
          const chats = await window.relay.projectChats(project);
          return chats.find((c) => c.id === id);
        });
      await expect
        .poll(async () => (await current())?.title)
        .toBe("Cache guard behavior");
      const id = (await current())!.id;
      await page.evaluate(
        ([id, title]) => window.relay.renameProjectChat(id, title),
        [id, title] as const,
      );
    };
    const thread = (title: string) =>
      sidebar.getByRole("button", { name: new RegExp(title) }).first();

    const front = page
      .locator('[data-pane="panel"] .pane-tabs')
      .locator('[role="tab"][aria-selected="true"]');

    // The first thread is left with History alone.
    await send("hello");
    await rename("First thread");
    await openSurface(page, "History");
    await toggle("Chat").click();
    await expect.poll(order).toEqual(["panel"]);
    await expect(front).toHaveText("History");

    // A new thread starts with the chat alone, then opens Files beside it.
    await page.keyboard.press(`${mod}+N`);
    await expect.poll(order).toEqual(["chat"]);
    // Its panel starts on the picker, without the first thread's History.
    await toggle("Panel").click();
    await expect(page.locator(".surface-picker")).toBeVisible();
    await expect(front).toHaveCount(0);
    await openSurface(page, "Files");
    await expect.poll(order).toEqual(["chat", "panel"]);
    await send("hello again");
    await rename("Second thread");
    // Sent, it keeps the tabs it had as a draft.
    await expect.poll(order).toEqual(["chat", "panel"]);
    await expect(front).toHaveText("Files");

    // After a reload, each comes back as it was left.
    await page.reload();
    await expect(toggles).toBeVisible();
    await expect.poll(order).toEqual(["chat", "panel"]);
    await expect(front).toHaveText("Files");
    await thread("First thread").click();
    await expect.poll(order).toEqual(["panel"]);
    await expect(front).toHaveText("History");
    await thread("Second thread").click();
    await expect.poll(order).toEqual(["chat", "panel"]);
    await expect(front).toHaveText("Files");

    // A thread the panel never saw doesn't take over the last one's tabs.
    await thread("First thread").click();
    await expect(front).toHaveText("History");
    await page.evaluate(async () => {
      const project = localStorage.getItem("relay-project-id")!;
      const chats = await window.relay.projectChats(project);
      const second = chats.find((c) => c.title === "Second thread")!.id;
      for (const key of ["relay-thread-panel", "relay-thread-panel-2"]) {
        const saved = JSON.parse(localStorage.getItem(key) || "[]");
        localStorage.setItem(
          key,
          JSON.stringify(saved.filter(([id]: [string]) => id !== second)),
        );
      }
    });
    await page.reload();
    await expect(front).toHaveText("History");
    await thread("Second thread").click();
    await openSurface(page, "Files");
    const panel = page.locator('[data-pane="panel"]');
    await expect(panel.locator(".pane-tabs").getByRole("tab")).toHaveText(["Files"]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
