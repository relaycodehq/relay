import { test, expect, _electron as electron } from "@playwright/test";
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
import { openInFileTree, openSurface } from "../fixtures/navigation";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("chat, changes and files are inline panes that can be reordered", async () => {
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
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
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
    await page
      .getByRole("dialog", { name: "Add a project", exact: true })
      .getByRole("option", { name: "Choose in Finder…", exact: true })
      .click();
    const toggles = page.getByRole("group", { name: "Workspace panes" });
    // Changes carries its line counts after the label.
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
      page.getByRole("menuitem", { name: "Files", exact: true }),
    ).toBeVisible();
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

    // Regression: the Changes pane never pops the remembered file in a modal.
    await toggle("Changes").click();
    await expect(
      page.getByRole("region", { name: "Local changes" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Changes open in the Files pane, next to the diff.
    await page.locator('.change-select[aria-label$=" src/a.ts"]').click();
    await page
      .getByRole("button", { name: "Open in editor", exact: true })
      .click();
    await expect(
      page.locator(".project-inline-editor").getByRole("textbox", {
        name: "src/a.ts",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await order()).toEqual(["chat", "changes", "panel"]);

    // Drag a header toggle to reorder the panes; the order and the open
    // panes survive a reload.
    await toggle("Panel").dragTo(toggle("Chat"), {
      targetPosition: { x: 2, y: 5 },
    });
    expect(await order()).toEqual(["panel", "chat", "changes"]);
    await page.reload();
    await expect(toggles).toBeVisible();
    await expect.poll(order).toEqual(["panel", "chat", "changes"]);

    // So does dragging a pane by its header, anywhere along it.
    await page
      .locator('[data-pane="changes"] .pane-header')
      .dragTo(page.locator('[data-pane="panel"] .pane-header'), {
        targetPosition: { x: 4, y: 20 },
      });
    await expect.poll(order).toEqual(["changes", "panel", "chat"]);

    // Terminals stack as tabs; everything else opens once.
    await openSurface(page, "Terminal");
    await openSurface(page, "Terminal");
    await openSurface(page, "Files");
    const panel = page.locator('[data-pane="panel"]');
    await expect(panel.getByRole("tab")).toHaveText([
      "Files",
      "Terminal",
      "Terminal 2",
    ]);
    await panel.getByRole("tab", { name: "Terminal 2", exact: true }).click();
    await expect(panel.locator(".xterm-rows")).toBeVisible();
    await panel
      .getByRole("button", { name: "Close terminal 2", exact: true })
      .click();
    await expect(panel.getByRole("tab")).toHaveText(["Files", "Terminal"]);

    // The last visible pane cannot be hidden.
    await toggle("Panel").click();
    await toggle("Changes").click();
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
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
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
      sidebar.getByRole("button", { name: new RegExp(title) });

    const front = page
      .locator('[data-pane="panel"]')
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
    await send("hello again");
    await rename("Second thread");
    await openSurface(page, "Files");
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
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
