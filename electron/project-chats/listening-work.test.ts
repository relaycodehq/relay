import { afterEach, expect, it, vi } from "vitest";
import type { ChatPending } from "../../shared/projects";
import type { ProjectTask } from "../../shared/tasks";
import type { ChatCore } from "./core";
import { ListeningWork } from "./listening-work";

const fake = vi.hoisted(() => ({
  commands: {} as Record<string, string>,
  running: [] as Partial<ProjectTask>[],
}));

vi.mock("../agents/claude/project", () => ({
  claudeTaskCommand: (_key: string, taskId: string) => fake.commands[taskId],
}));

vi.mock("../terminal/tasks", () => ({
  projectTasks: { list: async () => fake.running },
}));

afterEach(() => vi.useRealTimers());

const task = (id: string): ChatPending => ({
  kind: "task",
  id,
  description: id,
  since: 1,
});

it("finds the background commands that listen, and only the thread's own", async () => {
  vi.useFakeTimers();
  const php = "cd /project && php -S localhost:8000 -t preview";
  fake.commands = { php, tests: "npm test" };
  fake.running = [
    { chatId: "t1", command: php, ports: [] },
    { chatId: "t1", command: "npm test", ports: [] },
    // The same command another thread started, already serving.
    { chatId: "t2", command: "npm test", ports: [9229] },
  ];
  let pending = [task("php"), task("tests")].map((item) => ({
    key: "k",
    chatId: "t1",
    item,
  }));
  let heard!: () => void;
  const chatChanged = vi.fn();
  const core = {
    sessions: {
      pending: () => pending,
      onPending: (listener: () => void) => (heard = listener),
    },
    store: { get: () => ({ chats: [{ id: "t1", projectId: "p" }] }) },
    projects: { root: async () => "/project" },
    storage: { chatChanged },
  } as unknown as ChatCore;
  const listening = new ListeningWork(core);
  heard();
  await vi.advanceTimersByTimeAsync(1000);
  expect(listening.portsOf("php")).toBeUndefined();
  expect(chatChanged).not.toHaveBeenCalled();

  // The server comes up a while after Claude started it.
  fake.running[0].ports = [8000];
  await vi.advanceTimersByTimeAsync(10_000);
  expect(listening.portsOf("php")).toEqual([8000]);
  expect(listening.portsOf("tests")).toBeUndefined();
  expect(chatChanged).toHaveBeenCalledExactlyOnceWith("t1");

  // Ended work is forgotten.
  pending = [];
  heard();
  await vi.advanceTimersByTimeAsync(1000);
  expect(listening.portsOf("php")).toBeUndefined();
});
