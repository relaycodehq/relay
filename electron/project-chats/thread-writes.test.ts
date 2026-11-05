import { it, expect, vi } from "vitest";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../../shared/projects";
import { Store } from "../app/store";
import { ChatStorage } from "./storage";
import {
  chats,
  projectId,
  input,
  restart,
  root,
  useProjectChats,
} from "../../tests/fixtures/project-chats-harness";

const written: { file: string; bytes: number }[] = [];

/** Runs after each write lands, as if Relay died right then. */
const afterWrite = {
  copy: undefined as ((file: string) => Promise<void>) | undefined,
};

vi.mock("../util/atomic-write", async (importOriginal) => {
  const real = await importOriginal<typeof import("../util/atomic-write")>();
  return {
    ...real,
    writeFileAtomic: (...args: Parameters<typeof real.writeFileAtomic>) => {
      written.push({ file: basename(args[0]), bytes: args[1].length });
      return real
        .writeFileAtomic(...args)
        .then(() => afterWrite.copy?.(args[0]));
    },
  };
});

vi.mock("../platform/executables");

useProjectChats();

/** A long thread's earlier turns, about 5MB of them. */
const earlierTurns = (): ChatMessage[] =>
  Array.from({ length: 2000 }, (_, i) => ({
    id: randomUUID(),
    role: i % 2 ? "assistant" : "user",
    body: "x".repeat(2500),
    status: "complete",
    created: i,
    version: 1,
    provider: "codex",
  }));

/** A thread with a long history, as a restart finds it. */
async function longThread() {
  const made = await chats.create(projectId, { kind: "project" });
  await chats.dispose();
  const file = join(root, "chats", `${made.id}.json`);
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.messages = earlierTurns();
  await writeFile(file, JSON.stringify(saved));
  restart();
  return made;
}

it("rewrites a long thread's file whole only at the end of a turn and the session's start", async () => {
  const made = await longThread();
  written.length = 0;

  await chats.send(made.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () => {
    const thread = await chats.get(made.id);
    expect(thread.messages.at(-1)?.status).toBe("complete");
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });

  const threadFile = written.filter((w) => w.file === `${made.id}.json`);
  const liveFile = written.filter((w) => w.file === `${made.id}.live.json`);
  // Was 4: the sent message and the answer's start each rewrote it too.
  expect(threadFile).toHaveLength(2);
  // Those two, and a checkpoint a second while the answer streams, however long it takes.
  expect(liveFile.length).toBeGreaterThanOrEqual(2);
  for (const { bytes } of liveFile)
    expect(bytes).toBeLessThan(threadFile[0].bytes / 20);
});

it("keeps the sent message through a crash before the turn's end saves the thread whole", async () => {
  const made = await longThread();
  const crashed = await mkdtemp(join(tmpdir(), "relay-crashed-"));
  let copied = false;
  afterWrite.copy = async (file) => {
    if (copied || basename(file) !== `${made.id}.live.json`) return;
    copied = true;
    // Relay's data as a crash right after the sent message's checkpoint leaves it.
    await cp(dirname(dirname(file)), crashed, { recursive: true });
  };
  try {
    await chats.send(made.id, input("@codex Explain the cache guard"));
    await vi.waitFor(() => expect(copied).toBe(true));
  } finally {
    afterWrite.copy = undefined;
  }

  const reopened = new Store(join(crashed, "state"));
  await reopened.load();
  const storage = new ChatStorage(
    reopened,
    join(crashed, "chats"),
    () => false,
  );
  const thread = await storage.load(made.id);
  expect(thread.messages.map((m) => [m.role, m.body])).toContainEqual([
    "user",
    "@codex Explain the cache guard",
  ]);
});
