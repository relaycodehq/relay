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
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { screenshot } from "../fixtures/screenshot";

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

/**
 * The same place, within a pixel: on a 1x screen the view scrolls in whole
 * pixels, and the heights above the message are estimates after a switch,
 * so it can land half a pixel off, which rounds to a pixel.
 */
function expectSamePlace(
  place: Awaited<ReturnType<typeof topOfView>>,
  expected: Awaited<ReturnType<typeof topOfView>>,
) {
  expect(place?.id).toBe(expected!.id);
  expect(Math.abs(place!.offset - expected!.offset)).toBeLessThanOrEqual(1);
}

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
  await settled(page);
}

/** Waits out wheel steps a slow machine applies late. */
async function settled(page: Page) {
  const scrollTop = () =>
    page.evaluate(() => document.querySelector(".project-messages")!.scrollTop);
  await expect
    .poll(async () => {
      const before = await scrollTop();
      await page.waitForTimeout(300);
      return (await scrollTop()) === before;
    })
    .toBe(true);
}

test("holds an opened handoff note in view instead of following the bottom", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-handoff-scroll-")),
  );
  const repo = join(root, "project"),
    data = join(root, "data"),
    bin = join(root, "bin");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    await mkdir(bin);
    const agent = await readFile(
      resolve("tests/fixtures/room-agent.cjs"),
      "utf8",
    );
    for (const name of ["codex", "claude"])
      await fakeCli(join(bin, name), agent);
    await mkdir(join(data, "project-chats"), { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    const projectId = randomUUID();
    const chat = thread(projectId, "Handoff", 4);
    chat.messages[1]!.body = Array.from(
      { length: 12 },
      (_, i) => `Earlier answer ${i}. ${lorem.repeat(3)}`,
    ).join("\n\n");
    chat.messages[2] = {
      ...chat.messages[2]!,
      role: "assistant",
      handoff: { from: "claude", to: "codex" },
      body: Array.from(
        { length: 16 },
        (_, i) => `Handoff note ${i}. ${lorem.repeat(3)}`,
      ).join("\n\n"),
    };
    chat.messages[3]!.body = "I'll continue from the handoff note.";
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
        RELAY_TEST_DATA: data,
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.locator(".sb-thread", { hasText: "Handoff" }).click();
    const show = page.getByRole("button", { name: "Show note", exact: true });
    await expect(show).toBeVisible();
    await settled(page);
    const fromBottom = () =>
      page.evaluate(() => {
        const e = document.querySelector(".project-messages")!;
        return e.scrollHeight - e.scrollTop - e.clientHeight;
      });
    expect(await fromBottom()).toBeLessThan(2);
    const before = await offsetOf(page, "handoff-2");
    await show.click();
    await settled(page);
    expect(Math.abs((await offsetOf(page, "handoff-2")) - before)).toBeLessThan(
      2,
    );
    await expect(
      page.getByText("Handoff note 0.", { exact: false }),
    ).toBeInViewport();
    await screenshot(page, {
      path: join(tmpdir(), "relay-handoff-note-open.png"),
    });

    // Keyboard activation must hold the same place when closing and reopening.
    await page
      .getByRole("button", { name: "Hide note", exact: true })
      .press("Enter");
    await settled(page);
    expect(Math.abs((await offsetOf(page, "handoff-2")) - before)).toBeLessThan(
      2,
    );
    await show.press("Enter");
    await settled(page);
    expect(Math.abs((await offsetOf(page, "handoff-2")) - before)).toBeLessThan(
      2,
    );
    await page.getByRole("button", { name: "Hide note", exact: true }).click();

    // Opening the note while an answer grows also takes priority over following.
    const prompt = page.getByRole("textbox").last();
    await prompt.fill("fixture stream long");
    await prompt.press("Enter");
    await expect(
      page.getByText("Paragraph 2.", { exact: false }),
    ).toBeVisible();
    await show.evaluate((button) => {
      window.addEventListener(
        "click",
        () => {
          const row = button.closest<HTMLElement>("[data-message-id]")!;
          row.dataset.clickOffset = String(
            row.getBoundingClientRect().top -
              document
                .querySelector(".project-messages")!
                .getBoundingClientRect().top,
          );
        },
        { once: true, capture: true },
      );
    });
    await show.click();
    const streamingBefore = await page
      .locator('[data-message-id="handoff-2"]')
      .evaluate((row) => Number((row as HTMLElement).dataset.clickOffset));
    const drift: number[] = [];
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(50);
      drift.push((await offsetOf(page, "handoff-2")) - streamingBefore);
    }
    expect(Math.max(...drift.map(Math.abs))).toBeLessThan(2);
    await expect(
      page.getByRole("button", { name: "Hide note", exact: true }),
    ).toBeInViewport();
    await screenshot(page, {
      path: join(tmpdir(), "relay-handoff-note-streaming.png"),
    });

    // A reader who returns to the end follows the streaming answer again.
    const box = (await page.locator(".project-messages").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.wheel(0, 20000);
    await expect.poll(fromBottom).toBeLessThan(2);
    const trailing: number[] = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(50);
      trailing.push(await fromBottom());
    }
    expect(Math.max(...trailing)).toBeLessThan(2);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

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
    const agent = await readFile(
      resolve("tests/fixtures/room-agent.cjs"),
      "utf8",
    );
    for (const name of ["codex", "claude"])
      await fakeCli(join(bin, name), agent);
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
        ...pathWith(env, bin),
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
    expectSamePlace(await topOfView(page), reading);

    // Page back from the top: the message being read stays where it was.
    await page.evaluate(() => {
      document.querySelector(".project-messages")!.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    const before = (await topOfView(page))!;
    await page.getByRole("button", { name: "Earlier messages" }).click();
    await page.waitForTimeout(500);
    // Within a pixel: at fractional display scaling both sides round.
    expect(
      Math.abs((await offsetOf(page, before.id!)) - before.offset),
    ).toBeLessThanOrEqual(1);

    // Read among the earlier messages; the thread reopens there too.
    await wheel(page, -3000);
    const earlier = await topOfView(page);
    expect(Number(earlier!.id!.split("-")[1])).toBeLessThan(160);
    await open("Short");
    await open("Long");
    expectSamePlace(await topOfView(page), earlier);
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
    const agent = await readFile(
      resolve("tests/fixtures/room-agent.cjs"),
      "utf8",
    );
    for (const name of ["codex", "claude"])
      await fakeCli(join(bin, name), agent);
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
        ...pathWith(env, bin),
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
    await settled(page);
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

test("folding the composer away and back doesn't move the thread", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-fold-scroll-")),
  );
  const repo = join(root, "project"),
    data = join(root, "data"),
    bin = join(root, "bin");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    await mkdir(bin);
    const agent = await readFile(
      resolve("tests/fixtures/room-agent.cjs"),
      "utf8",
    );
    for (const name of ["codex", "claude"])
      await fakeCli(join(bin, name), agent);
    await mkdir(join(data, "project-chats"), { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    const projectId = randomUUID();
    const chat = thread(projectId, "Folding", 12);
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
        ...pathWith(env, bin),
        RELAY_TEST_DATA: data,
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.locator(".sb-thread", { hasText: "Folding" }).click();
    await expect(page.locator('[data-message-id="folding-11"]')).toBeAttached();
    await settled(page);
    // The composer folds for a reader, not for someone writing in it.
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    const dock = page.locator(".thread-bottom-composer");
    // The room kept under the messages for the composer, every frame.
    await page.evaluate(() => {
      const view = document.querySelector(".project-messages")!;
      const seen: number[] = [];
      Object.assign(window, { paddings: seen });
      const sample = () => {
        seen.push(parseFloat(getComputedStyle(view).paddingBottom));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const scrollTop = () =>
      page.evaluate(
        () => document.querySelector(".project-messages")!.scrollTop,
      );
    // Trackpad steps up until it folds, then back down until it unfolds.
    const step = 12;
    const box = (await page.locator(".project-messages").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, -step);
      await page.waitForTimeout(16);
    }
    await expect(dock).toHaveClass(/collapsed/);
    await settled(page);
    const start = await scrollTop();
    const ahead: number[] = [];
    for (let i = 1; i <= 40; i++) {
      await page.mouse.wheel(0, step);
      await page.waitForTimeout(16);
      ahead.push((await scrollTop()) - start - i * step);
    }
    await expect(dock).not.toHaveClass(/collapsed/);
    await settled(page);

    // The room stays as it was: shrinking or regrowing it mid-fold moves
    // what the reader is looking at.
    const paddings = await page.evaluate(
      () => (window as unknown as { paddings: number[] }).paddings,
    );
    expect(Math.min(...paddings)).toBe(Math.max(...paddings));
    // The thread went only as far as the wheel took it, never pinned ahead.
    expect(Math.max(...ahead)).toBeLessThanOrEqual(1);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
