import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// The sidebar's thread lists come from the desktop's pushes: an idle window
// asks for none, and a change made elsewhere still shows up.
test("keeps thread lists current without asking for them", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-push-")));
  const data = join(root, "data");
  await mkdir(join(data, "project-chats"), { recursive: true });
  const projects = [],
    chats = [];
  for (let p = 0; p < 3; p++) {
    const path = join(root, `project-${p}`);
    await mkdir(path);
    execFileSync("git", ["init", "-q", "-b", "main", path]);
    const projectId = randomUUID();
    projects.push({
      id: projectId,
      path,
      name: `project ${p}`,
      repository: null,
      added: p,
    });
    for (let t = 0; t < 4; t++) {
      const at = Date.now() - 3_600_000 + (p * 4 + t) * 1000;
      const chat = {
        id: randomUUID(),
        projectId,
        title: `Thread ${p}.${t}`,
        scope: { kind: "project" },
        created: at,
        updated: at + 500,
        messages: [
          {
            id: randomUUID(),
            role: "user",
            provider: "claude",
            status: "complete",
            body: "hello",
            created: at,
            version: 1,
          },
        ],
      };
      chats.push(chat);
      await writeFile(
        join(data, "project-chats", chat.id + ".json"),
        JSON.stringify(chat),
      );
    }
  }
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      projects,
      chats: chats.map((c) => ({ ...c, messages: undefined })),
    }),
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
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.getByText("Thread 0.3")).toBeVisible();
    // Counts what the window asks the desktop for, by method.
    await app.evaluate(({ ipcMain }) => {
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<string, (...args: unknown[]) => unknown>;
        }
      )._invokeHandlers;
      const handle = handlers.get("relay:invoke")!;
      const asked: Record<string, number> = {};
      (globalThis as { asked?: typeof asked }).asked = asked;
      handlers.set("relay:invoke", (event, method, args) => {
        asked[method as string] = (asked[method as string] ?? 0) + 1;
        return handle(event, method, args);
      });
    });
    const asked = () =>
      app.evaluate(
        () => (globalThis as { asked?: Record<string, number> }).asked ?? {},
      );
    const lists = (counts: Record<string, number>) =>
      (counts.projectChats ?? 0) + (counts.scratchChats ?? 0);

    // Longer than the 5s the sidebar used to poll at.
    await page.waitForTimeout(6_000);
    expect(lists(await asked())).toBe(0);

    // Renamed behind the sidebar's back: nothing in the window refetches.
    await page.evaluate(
      (id) => window.relay.renameProjectChat(id, "Renamed elsewhere"),
      chats[1]!.id,
    );
    await expect(page.getByText("Renamed elsewhere")).toBeVisible({
      timeout: 2_000,
    });
    expect(lists(await asked())).toBe(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20 });
  }
});
