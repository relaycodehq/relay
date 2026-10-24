import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "../fixtures/electron";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import { screenshot } from "../fixtures/screenshot";

const lorem =
  "Relay keeps the thread pinned while answers stream in and remembers where the reader left off. ";

test("⌘F finds words in the thread, older messages mounted back", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-find-")));
  const repo = join(root, "project"),
    data = join(root, "data");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    await mkdir(join(data, "project-chats"), { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    const projectId = randomUUID(),
      count = 200,
      start = Date.now() - count * 60_000;
    // Far past the 80 messages mounted at first, and once near the end.
    const marked = new Set([3, 185]);
    const messages: ChatMessage[] = Array.from({ length: count }, (_, i) => ({
      id: `m-${i}`,
      role: i % 2 ? "assistant" : "user",
      provider: "codex",
      status: "complete",
      body: marked.has(i)
        ? `Message ${i} names the **Zeph**yr build. ${lorem.repeat(4)}`
        : `Message ${i}. ${lorem.repeat(1 + (i % 4))}`,
      created: start + i * 60_000,
      ended: start + i * 60_000 + 5_000,
      version: 1,
    }));
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId,
      title: "Findable",
      scope: { kind: "project" },
      created: start,
      updated: start + count * 60_000,
      messages,
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
        chats: [{ ...chat, messages: undefined }],
      }),
    );
    app = await electron.launch({
      env: { ...relayEnv(), RELAY_TEST_DATA: data },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.locator(".sb-thread", { hasText: "Findable" }).click();
    await expect(page.locator('[data-message-id="m-199"]')).toBeVisible();
    await expect(page.locator('[data-message-id="m-3"]')).toHaveCount(0);

    await page.getByRole("textbox").last().click();
    await page.keyboard.press("ControlOrMeta+f");
    const input = page.getByLabel("Find in thread");
    await expect(input).toBeFocused();
    // Across the bold, and found in a message that wasn't mounted.
    await input.fill("zephyr build");
    const counter = page.locator(".thread-find .find-bar-count");
    await expect(counter).toHaveText("2 of 2");
    await expect(page.locator('[data-message-id="m-3"]')).toHaveCount(1);
    await expect(page.locator('[data-message-id="m-185"]')).toBeInViewport();
    const highlighted = () =>
      page.evaluate(() =>
        [...(CSS.highlights.get("relay-thread-find-current") ?? [])].map((r) =>
          (r as Range).toString(),
        ),
      );
    expect(await highlighted()).toEqual(["Zephyr build"]);

    await input.press("Shift+Enter");
    await expect(counter).toHaveText("1 of 2");
    await expect(page.locator('[data-message-id="m-3"]')).toBeInViewport();
    await screenshot(page, { path: join(tmpdir(), "relay-thread-find.png") });

    await input.press("Escape");
    await expect(input).toHaveCount(0);
    expect(await highlighted()).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
