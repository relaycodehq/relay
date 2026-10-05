import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import { findExecutable } from "../platform/executables";
import { defaultAISettings } from "../../shared/settings";
import { fakeCli } from "../../tests/fixtures/fake-cli";
vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

let root: string, chats: ProjectChats, projectId: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-goal-chat-")));
  const repo = join(root, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  vi.mocked(findExecutable).mockResolvedValue(
    await fakeCli(
      join(root, "codex"),
      await readFile(resolve("tests/fixtures/codex-goal.cjs"), "utf8"),
    ),
  );
  const store = new Store(join(root, "state"));
  await store.load();
  const projects = new Projects(store);
  projectId = (await projects.add(repo, null)).id;
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
});
afterEach(async () => {
  await chats?.dispose();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});

const input = (body: string) => ({
  id: randomUUID(),
  body,
  to: "codex" as const,
  provider: "codex" as const,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  choice: {
    ...defaultAISettings.questions,
    model: "",
    reasoningEffort: "" as const,
  },
});
const answered = (id: string) =>
  vi.waitFor(
    async () => {
      const chat = await chats.get(id);
      expect(chat.messages.at(-1)?.status).toBe("complete");
      expect(
        chats.list(projectId).find((c) => c.id === id)?.running,
      ).toBeFalsy();
      return chat;
    },
    { timeout: 10_000 },
  );

it("answers a Codex /goal once, across the turns Codex takes, and lists the goal", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex /goal three files exist"));
  const done = await answered(chat.id);
  expect(done.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(done.messages[1]!.body).toBe("Turn 3 done.");
  expect(done.goal).toMatchObject({
    provider: "codex",
    objective: "three files exist",
    status: "complete",
  });
  expect(
    chats.list(projectId).find((c) => c.id === chat.id)?.goal,
  ).toMatchObject({ status: "complete" });
  // A goal that ended shows until the conversation moves on.
  await chats.send(chat.id, input("@codex Thanks"));
  expect((await answered(chat.id)).goal).toBeUndefined();
}, 20_000);

it("pauses a running goal at once instead of queueing the pause behind it", async () => {
  vi.stubEnv("RELAY_GOAL_TURNS", "50");
  vi.stubEnv("RELAY_GOAL_TURN_MS", "300");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex /goal fifty turns"));
  await vi.waitFor(
    async () => expect((await chats.get(chat.id)).goal?.status).toBe("active"),
    { timeout: 10_000 },
  );
  // As the goal row sends it while the thread works.
  await chats.send(chat.id, {
    ...input("@codex /goal pause"),
    delivery: "queue",
  });
  const done = await answered(chat.id);
  expect(done.goal).toMatchObject({ status: "paused" });
  expect(done.queue ?? []).toEqual([]);
  expect(done.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
}, 20_000);
