import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// A thread popped out into a window of its own: the main window keeps a
// picture of it instead of a second live copy, the window goes back, and
// one left open comes back after a restart.
test.setTimeout(120_000);

test("a thread pops out into its own window and back, and reopens after a restart", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-twin-")));
  const repo = join(root, "project"),
    data = join(root, "data");
  await mkdir(repo);
  await mkdir(join(data, "project-chats"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const projectId = randomUUID();
  const now = Date.now();
  const thread = (title: string, answer: string, at: number) => ({
    id: randomUUID(),
    projectId,
    title,
    scope: { kind: "project" },
    created: at - 60_000,
    updated: at,
    messages: [
      {
        id: randomUUID(),
        role: "user",
        provider: "codex",
        status: "complete",
        body: `@codex ${title}`,
        created: at - 30_000,
        version: 1,
      },
      {
        id: randomUUID(),
        role: "assistant",
        provider: "codex",
        status: "complete",
        body: answer,
        created: at,
        ended: at,
        version: 1,
      },
    ],
  });
  const popped = thread("Pop me out", "Answer in the popped thread", now);
  const other = thread("Stays here", "Answer that stays", now - 60_000);
  for (const c of [popped, other])
    await writeFile(
      join(data, "project-chats", c.id + ".json"),
      JSON.stringify(c),
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
      chats: [popped, other].map(({ messages, ...c }) => ({
        ...c,
        provider: "codex",
      })),
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const launch = () =>
    electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        RELAY_TEST_DATA: data,
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
  const saved = async () =>
    JSON.parse(await readFile(join(data, "state.json"), "utf8"))
      .threadWindows as { chatId: string }[] | undefined;
  const quit = async (app: ElectronApplication) => {
    const closed = app.waitForEvent("close");
    await app.evaluate(({ app }) => app.quit());
    await closed;
  };

  let app = await launch();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() =>
      localStorage.setItem("relay-sidebar-view", "activity"),
    );
    await page.reload();
    const card = (title: string) =>
      page.locator(".sb-card").filter({
        has: page.locator(".sb-card-title", { hasText: title }),
      });
    await card("Pop me out").click();
    await expect(page.getByText("Answer in the popped thread")).toBeVisible();

    const opened = app.waitForEvent("window");
    await page.getByRole("button", { name: "Open in new window" }).click();
    const own = await opened;
    await expect(own.getByText("Answer in the popped thread")).toBeVisible();
    await expect(own.locator(".projects-sidebar")).toHaveCount(0);
    await expect(own).toHaveTitle("Pop me out");
    await expect(
      own.getByRole("button", { name: "Back to the main window" }),
    ).toBeVisible();

    // The main window shows where it went, not a second composer.
    const elsewhere = page.locator(".thread-elsewhere");
    await expect(elsewhere).toContainText("In its own window");
    await expect(elsewhere).toContainText("Pop me out");
    // Its latest answer, quoted in the picture of the window.
    await expect(elsewhere).toContainText("Answer in the popped thread");
    await expect(page.locator(".project-chat")).toHaveCount(0);
    await expect(page.locator(".project-composer")).toHaveCount(0);
    await expect(card("Pop me out")).toContainText("Own window");

    // Its card raises the window and leaves the main window where it was.
    await card("Stays here").click();
    await expect(page.getByText("Answer that stays")).toBeVisible();
    await card("Pop me out").click();
    await expect(page.getByText("Answer that stays")).toBeVisible();
    await expect(page.locator(".thread-elsewhere")).toHaveCount(0);

    // Back: its window closes and the thread opens in the main window.
    const gone = own.waitForEvent("close");
    await own.getByRole("button", { name: "Back to the main window" }).click();
    await gone;
    await expect(page.locator(".thread-elsewhere")).toHaveCount(0);
    await expect(
      page.locator(".project-chat").getByText("Answer in the popped thread"),
    ).toBeVisible();
    await expect(card("Pop me out")).not.toContainText("Own window");
    await expect.poll(saved).toEqual([]);

    // Popped again, through the thread menu this time, and left open.
    const again = app.waitForEvent("window");
    await card("Pop me out").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Open in new window/ }).click();
    await expect(
      (await again).getByText("Answer in the popped thread"),
    ).toBeVisible();
    await expect
      .poll(async () => (await saved())?.map((w) => w.chatId))
      .toEqual([popped.id]);
    await quit(app);
  } catch (e) {
    await app.close().catch(() => {});
    throw e;
  }

  // The window left open comes back with Relay, and stays on the list.
  app = await launch();
  try {
    await expect.poll(() => app.windows().length).toBe(2);
    const own = app
      .windows()
      .find((w) => new URL(w.url()).searchParams.get("thread") === popped.id)!;
    await expect(own.getByText("Answer in the popped thread")).toBeVisible();
    expect((await saved())?.map((w) => w.chatId)).toEqual([popped.id]);

    // Closing it by hand drops it from the list; it doesn't come back next time.
    const gone = own.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes(`thread=${id}`))
        ?.close();
    }, popped.id);
    await gone;
    await expect.poll(saved).toEqual([]);
  } finally {
    await app.close();
  }
});
