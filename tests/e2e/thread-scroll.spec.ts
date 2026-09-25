import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ChatMessage, ProjectChat } from "../../shared/projects";

const lorem =
  "Relay keeps the thread pinned while answers stream in and remembers where the reader left off. ";
/** A thread longer than the 80 messages shown at first. Answers vary in
 * length, so the heights estimated for messages off screen are wrong. */
function thread(projectId: string, title: string, count: number) {
  const id = randomUUID(),
    start = Date.now() - count * 60_000;
  const messages: ChatMessage[] = Array.from({ length: count }, (_, i) => ({
    id: `${title.toLowerCase()}-${i}`,
    role: i % 2 ? "assistant" : "user",
    provider: "codex",
    status: "complete",
    body:
      i % 2
        ? Array.from(
            { length: 1 + ((i * 7) % 9) },
            (_, p) =>
              `Answer ${i}, part ${p + 1}. ${lorem.repeat(1 + (p % 3))}`,
          ).join("\n\n")
        : `Question ${i}: ${lorem}`,
    created: start + i * 60_000,
    ended: start + i * 60_000 + 5_000,
    version: 1,
  }));
  const chat: ProjectChat = {
    id,
    projectId,
    title,
    scope: { kind: "project" },
    created: start,
    updated: start + count * 60_000,
    messages,
  };
  return chat;
}

/** The message at the top of the thread's view, and where it starts. */
const topOfView = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector(".project-messages")!;
    const top = view.getBoundingClientRect().top;
    for (const m of view.querySelectorAll<HTMLElement>("[data-message-id]")) {
      const box = m.getBoundingClientRect();
      if (box.bottom > top)
        return { id: m.dataset.messageId, offset: Math.round(box.top - top) };
    }
  });

/** Where a message starts, from the top of the thread's view. */
const offsetOf = (page: Page, id: string) =>
  page
    .locator(`[data-message-id="${id}"]`)
    .evaluate(
      (m) =>
        m.getBoundingClientRect().top -
        document.querySelector(".project-messages")!.getBoundingClientRect()
          .top,
    )
    .then(Math.round);

/** Scrolls the way a reader does, a wheel step at a time, then lets it settle. */
async function wheel(page: Page, pixels: number) {
  const box = (await page.locator(".project-messages").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  for (let done = 0; done < Math.abs(pixels); done += 300) {
    await page.mouse.wheel(0, Math.sign(pixels) * 300);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(500);
}

test("reopens a long thread where the reader left it, before or after paging back", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-thread-scroll-")),
  );
  const repo = join(root, "project"),
    data = join(root, "data"),
    bin = join(root, "bin");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    // The fixture agent stands in for both CLIs, so nothing real starts.
    await mkdir(bin);
    const agent =
      `#!${process.execPath}\n` +
      (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"));
    for (const name of ["codex", "claude"])
      await writeFile(join(bin, name), agent, { mode: 0o700 });
    await mkdir(join(data, "project-chats"), { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    const projectId = randomUUID();
    const long = thread(projectId, "Long", 240),
      short = thread(projectId, "Short", 6);
    for (const chat of [long, short])
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
        chats: [long, short].map(({ messages: _, ...summary }) => summary),
      }),
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
        PATH: bin + ":" + env.PATH,
        RELAY_TEST_DATA: data,
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 900 });
    const open = async (title: string) => {
      await page.locator(".sb-thread", { hasText: title }).click();
      await expect(
        page
          .locator(`[data-message-id="${title.toLowerCase()}-0"], .load-more`)
          .first(),
      ).toBeAttached();
      await page.waitForTimeout(600);
    };
    await open("Long");

    // Read a few screens up, go to another thread and come back.
    await wheel(page, -6000);
    const reading = await topOfView(page);
    await open("Short");
    await open("Long");
    expect(await topOfView(page)).toEqual(reading);

    // Page back from the top: the message being read stays where it was.
    await page.evaluate(() => {
      document.querySelector(".project-messages")!.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    const before = (await topOfView(page))!;
    await page.getByRole("button", { name: "Earlier messages" }).click();
    await page.waitForTimeout(500);
    expect(await offsetOf(page, before.id!)).toBe(before.offset);

    // Read among the earlier messages; the thread reopens there too.
    await wheel(page, -3000);
    const earlier = await topOfView(page);
    expect(Number(earlier!.id!.split("-")[1])).toBeLessThan(160);
    await open("Short");
    await open("Long");
    expect(await topOfView(page)).toEqual(earlier);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("lets the reader scroll up while an answer streams", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-stream-scroll-")),
  );
  const repo = join(root, "project"),
    data = join(root, "data"),
    bin = join(root, "bin");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    await mkdir(bin);
    const agent =
      `#!${process.execPath}\n` +
      (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"));
    for (const name of ["codex", "claude"])
      await writeFile(join(bin, name), agent, { mode: 0o700 });
    await mkdir(join(data, "project-chats"), { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    const projectId = randomUUID();
    const chat = thread(projectId, "Streaming", 12);
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
        chats: [chat].map(({ messages: _, ...summary }) => summary),
      }),
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
        PATH: bin + ":" + env.PATH,
        RELAY_TEST_DATA: data,
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.locator(".sb-thread", { hasText: "Streaming" }).click();
    await expect(
      page.locator('[data-message-id="streaming-11"]'),
    ).toBeAttached();
    await page.waitForTimeout(500);
    const fromBottom = () =>
      page.evaluate(() => {
        const e = document.querySelector(".project-messages")!;
        return Math.round(e.scrollHeight - e.scrollTop - e.clientHeight);
      });

    const send = async () => {
      const prompt = page.getByRole("textbox").last();
      await prompt.fill("fixture stream long");
      await prompt.press("Enter");
      await expect(
        page.getByText("Paragraph 2.", { exact: false }),
      ).toBeVisible();
    };
    await send();

    // A trackpad scrolls in small steps. Each should take the reader up,
    // not get pulled back by the next piece of the answer.
    const box = (await page.locator(".project-messages").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, -8);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(200);
    const afterSmall = await fromBottom();
    console.log("distance from bottom after 240px of small steps:", afterSmall);

    // Once up, what the reader looks at must stay put while the answer grows.
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(100);
    const anchor = await topOfView(page);
    const drift: number[] = [];
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(25);
      drift.push((await offsetOf(page, anchor!.id!)) - anchor!.offset);
    }
    console.log("anchor", anchor, "drift", JSON.stringify(drift));
    // Back down to the end: the thread follows the answer again.
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(300);
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();
    const trailing: number[] = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(50);
      trailing.push(await fromBottom());
    }
    console.log("following again", JSON.stringify(trailing));
    expect(Math.max(...trailing)).toBeLessThan(2);
    expect(afterSmall).toBeGreaterThan(150);
    expect(Math.max(...drift.map(Math.abs))).toBeLessThan(2);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
