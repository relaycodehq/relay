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

let root: string, store: Store, projects: Projects, chats: ProjectChats;
let projectId: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-notes-")));
  const repo = join(root, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  vi.mocked(findExecutable).mockResolvedValue(
    await fakeCli(
      join(root, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    ),
  );
  store = new Store(join(root, "state"));
  await store.load();
  projects = new Projects(store);
  projectId = (await projects.add(repo, null)).id;
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
});
afterEach(async () => {
  await chats?.dispose();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});

const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  choice: {
    ...defaultAISettings.questions,
    model: "fixture-model",
    reasoningEffort: "high" as const,
  },
});

it("keeps notes through a restart, and a fork takes them pointing at its own messages", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex hello"));
  const answer = await vi.waitFor(async () => {
    const last = (await chats.get(chat.id)).messages.at(-1);
    expect(last).toMatchObject({ role: "assistant", status: "complete" });
    return last!;
  });

  const list = await chats.notes.add(chat.id, {
    text: "- one\n- two",
    from: answer.id,
  });
  await chats.notes.add(chat.id, { text: "`npm test`", by: "claude" });
  await chats.notes.tick(chat.id, list.id, 2, true);
  await expect(
    chats.notes.add(chat.id, { text: "x", from: "elsewhere" }),
  ).rejects.toThrow("isn't in the thread");
  // The list tells windows and phones the notes moved.
  const mark = chats.list(projectId).find((c) => c.id === chat.id)?.notesMark;
  expect(mark).toMatch(/^2\./);

  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  const kept = await chats.notes.list(chat.id);
  expect(kept).toMatchObject([
    { id: "n1", text: "- one\n- two", from: answer.id, done: [1] },
    { id: "n2", text: "`npm test`", by: "claude" },
  ]);
  expect(chats.list(projectId).find((c) => c.id === chat.id)?.notesMark).toBe(
    mark,
  );

  const fork = await chats.fork(chat.id, answer.id);
  const forked = await chats.get(fork.id);
  const notes = await chats.notes.list(fork.id);
  expect(notes[0]!.from).toBe(forked.messages.at(-1)!.id);
  expect(notes[0]!.done).toEqual([1]);
  // Ticking the fork's copy leaves the original alone.
  await chats.notes.tick(fork.id, "n1", 1, true);
  expect((await chats.notes.list(chat.id))[0]!.done).toEqual([1]);

  await chats.notes.remove(chat.id, "n1");
  await chats.notes.remove(chat.id, "n2");
  expect(await chats.notes.list(chat.id)).toEqual([]);
  expect(
    chats.list(projectId).find((c) => c.id === chat.id)?.notesMark,
  ).toBeUndefined();
});
