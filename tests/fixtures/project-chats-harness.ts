import { vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Store } from "../../electron/app/store";
import { Projects } from "../../electron/projects/projects";
import { ProjectChats } from "../../electron/project-chats";
import { findExecutable } from "../../electron/platform/executables";
import { defaultAISettings } from "../../shared/settings";
import type { ChatMessage, ChatSummary } from "../../shared/projects";
import { fakeCli } from "./fake-cli";
export let root: string,
  store: Store,
  projects: Projects,
  chats: ProjectChats,
  projectId: string;
export type ChatEvent = {
  chatId: string;
  message: ChatMessage;
  title?: string;
};
export let events: ChatEvent[];
const eventListeners = new Set<(event: ChatEvent) => void>();
const waitCleanups = new Set<() => void>();
export const recordEvent = (event: ChatEvent) => {
  const captured = structuredClone(event);
  events.push(captured);
  for (const listener of eventListeners) listener(captured);
};
/** Listen to the same pushes the renderer receives; the test deadline bounds a missing event. */
export const waitForChatEvent = (
  chatId: string,
  predicate: (event: ChatEvent) => boolean,
  after = 0,
) => {
  const received = events
    .slice(after)
    .find((event) => event.chatId === chatId && predicate(event));
  if (received) return Promise.resolve(received);
  return new Promise<ChatEvent>((resolve) => {
    const cleanup = () => {
      eventListeners.delete(listener);
      waitCleanups.delete(cleanup);
    };
    const listener = (event: ChatEvent) => {
      if (event.chatId !== chatId || !predicate(event)) return;
      cleanup();
      resolve(event);
    };
    eventListeners.add(listener);
    waitCleanups.add(cleanup);
  });
};
/** Summary writes have their own notification, after the streamed message push. */
export const waitForSummary = (
  chatId: string,
  predicate: (summary: ChatSummary) => boolean,
) =>
  new Promise<ChatSummary>((resolve) => {
    const check = () => {
      const summary = chats.list(projectId).find((chat) => chat.id === chatId);
      if (!summary || !predicate(summary)) return;
      cleanup();
      resolve(summary);
    };
    const unsubscribe = chats.onSummaries(check);
    const cleanup = () => {
      unsubscribe();
      waitCleanups.delete(cleanup);
    };
    waitCleanups.add(cleanup);
    check();
  });
export function useProjectChats() {
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "relay-project-chat-")));
    const repo = join(root, "repo");
    await mkdir(repo);
    execFileSync("git", ["init", "--quiet", repo]);
    const cli = await fakeCli(
      join(root, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
    vi.mocked(findExecutable).mockResolvedValue(cli);
    vi.stubEnv("RELAY_AGENT_CAPTURE", join(root, "capture.jsonl"));
    // Quick turns; a test that watches one run sets its own length.
    vi.stubEnv("RELAY_AGENT_TURN_MS", "20");
    store = new Store(join(root, "state"));
    await store.load();
    projects = new Projects(store);
    projectId = (await projects.add(repo, null)).id;
    events = [];
    chats = new ProjectChats(store, projects, join(root, "chats"), recordEvent);
  });
  afterEach(async () => {
    for (const cleanup of waitCleanups) cleanup();
    await chats?.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // Windows holds a folder a just-stopped agent ran in for a moment.
    await rm(root, { recursive: true, force: true, maxRetries: 20 });
  });
}

/** The capture log, the agent's own calls only unless helper jobs are asked for. */
export const agentCalls = async ({ helpers = false } = {}) =>
  (await readFile(join(root, "capture.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => helpers || !/^\{"cwd":"[^"]*relay-helper-/.test(line))
    .join("\n");
export const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  choice: {
    ...defaultAISettings.questions,
    model: "fixture-model",
    reasoningEffort: "high" as const,
    fast: true,
  },
});
/** Opens the project's chats again, as a restart of Relay does. */
export const restart = (
  onEvent: (event: ChatEvent) => void = recordEvent,
  ...rest: ConstructorParameters<typeof ProjectChats> extends [
    unknown,
    unknown,
    unknown,
    unknown,
    ...infer R,
  ]
    ? R
    : never
) => {
  chats = new ProjectChats(
    store,
    projects,
    join(root, "chats"),
    onEvent,
    ...rest,
  );
  return chats;
};

export const tinyPng =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=";
