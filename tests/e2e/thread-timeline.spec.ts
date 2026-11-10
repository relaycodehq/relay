import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

const TURNS = 12;

/** A finished thread of long answers, so every turn is taller than the view. */
function thread(projectId: string): ProjectChat {
  const start = Date.now() - 3_600_000;
  const answer = Array.from(
    { length: 30 },
    (_, p) =>
      `Paragraph ${p} of a long answer, long enough to wrap a line or two in the thread's column.`,
  ).join("\n\n");
  const messages: ChatMessage[] = Array.from({ length: TURNS * 2 }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 ? "assistant" : "user",
    provider: "codex",
    status: "complete",
    body: i % 2 ? answer : `Question ${i / 2}?`,
    created: start + i * 60_000,
    ended: start + i * 60_000 + 5_000,
    version: 1,
  }));
  return {
    id: randomUUID(),
    projectId,
    title: "Rail",
    scope: { kind: "project" },
    created: start,
    updated: start + TURNS * 120_000,
    messages,
  };
}

async function openRailThread(run: (page: Page) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-rail-")));
  const repo = join(root, "project"),
    data = join(root, "data"),
    bin = join(root, "bin");
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
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    await mkdir(join(data, "project-chats"), { recursive: true });
    const projectId = randomUUID();
    const chat = thread(projectId);
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
    const env = relayEnv();
    const app = await electron.launch({
      env: { ...env, ...pathWith(env, bin), RELAY_TEST_DATA: data },
    });
    try {
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.locator(".sb-thread", { hasText: "Rail" }).click();
      await page
        .locator(".thread-timeline-rail")
        .waitFor({ state: "attached" });
      await expect(page.locator(".thread-timeline-rail > i")).toHaveCount(
        TURNS,
      );
      await run(page);
    } finally {
      await app.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const view = (page: Page) =>
  page.locator(".project-messages").evaluate((v) => ({
    top: v.scrollTop,
    toEnd: v.scrollHeight - v.scrollTop - v.clientHeight,
  }));

/** Where tick `i` is drawn on the screen. */
const tick = (page: Page, i: number) =>
  page
    .locator(".thread-timeline-rail > i")
    .nth(i)
    .evaluate((t) => {
      const box = t.getBoundingClientRect();
      return { x: box.left + 3, y: box.top + box.height / 2 };
    });

test("dragging along the prompt rail scrolls the thread while the button is down", async () => {
  await openRailThread(async (page) => {
    const first = await tick(page, 0);
    const last = await tick(page, TURNS - 1);
    await page.mouse.move(first.x, first.y, { steps: 3 });
    await page.mouse.down();
    const tops: number[] = [];
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      // Halfway along, drift right off the rail's strip: the drag keeps going.
      const x = i > steps / 2 ? first.x + 200 : first.x;
      await page.mouse.move(x, first.y + ((last.y - first.y) * i) / steps);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      tops.push((await view(page)).top);
    }
    await expect(page.locator(".thread-timeline[data-scrubbing]")).toHaveCount(
      1,
    );
    // Moving down the rail only ever moves the thread down, a little at a time.
    const steadyTops = tops.slice(2);
    for (let i = 1; i < steadyTops.length; i++)
      expect(steadyTops[i]).toBeGreaterThanOrEqual(steadyTops[i - 1]! - 2);
    expect(new Set(tops).size).toBeGreaterThan(steps / 2);
    expect(tops.at(-1)!).toBeGreaterThan(tops[2]! + 2000);

    // On past the last tick, the drag runs through the last answer to the end.
    await page.mouse.move(first.x, last.y + 40, { steps: 4 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect.poll(async () => (await view(page)).toEnd).toBeLessThan(2);
    await page.mouse.up();
    await expect(page.locator(".thread-timeline[data-scrubbing]")).toHaveCount(
      0,
    );
  });
});

test("a press on a tick without moving still brings its prompt to the top", async () => {
  await openRailThread(async (page) => {
    const third = await tick(page, 2);
    await page.mouse.move(third.x, third.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    const prompt = page.locator('[data-message-id="m-4"]');
    await expect
      .poll(() =>
        prompt.evaluate((m) => {
          const view = m.closest(".project-messages")!;
          return Math.round(
            m.getBoundingClientRect().top - view.getBoundingClientRect().top,
          );
        }),
      )
      .toBe(12);
  });
});
