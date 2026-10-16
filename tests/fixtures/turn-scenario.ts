import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { vi, type Mock } from "vitest";
import { Store } from "../../electron/app/store";
import { Projects } from "../../electron/projects/projects";
import { ProjectChats } from "../../electron/project-chats";
import { ChatSummaryFeed } from "../../electron/project-chats/chat-summaries";
import { defaultAISettings } from "../../shared/settings";
import type { ProjectChatEvent } from "../../shared/events";
import type {
  AgentProvider,
  ChatMessage,
  ChatSummary,
  ProjectChatSend,
} from "../../shared/projects";
import type { NewsCursor, NewsItem } from "../../shared/thread-news";
import { fakeCli } from "./fake-cli";

/**
 * A project with threads, driven the way a person or a phone drives them, for
 * the turn lifecycle scenarios. It checks only what they'd see: whether a
 * thread reads running, what it was news for, what its answers ended as.
 */
export interface Scenario {
  root: string;
  chats: ProjectChats;
  /** News that sounds in the window, in order. */
  news: NewsItem[];
  thread(): Promise<string>;
  send(
    id: string,
    body: string,
    provider?: AgentProvider,
    extra?: Partial<ProjectChatSend>,
  ): Promise<void>;
  summary(id: string): ChatSummary | undefined;
  messages(id: string): Promise<ChatMessage[]>;
  /** Waits for the thread's list entry to read `predicate`. */
  until(
    id: string,
    predicate: (summary: ChatSummary) => boolean,
  ): Promise<ChatSummary>;
  /** Waits for a message pushed to the window to read `predicate`. */
  message(
    id: string,
    predicate: (message: ChatMessage) => boolean,
  ): Promise<ChatMessage>;
  /** Waits until the thread's turns have given it back. */
  ended(id: string): Promise<void>;
  /** The thread's answers whose latest push still said they stream. */
  streaming(id: string): ChatMessage[];
  /** Calls `listener` whenever the thread's list entry may read differently. */
  watch(listener: () => void): () => void;
  /** A phone that can lose its link and come back. */
  phone(): Phone;
  dispose(): Promise<void>;
}

export interface Phone {
  /** News the phone heard live or caught up on, in order. */
  news: NewsItem[];
  drop(): void;
  reconnect(): void;
}

export interface ScenarioOptions {
  /** `findExecutable`, mocked by the test file. */
  findExecutable: Mock;
  /**
   * Plays `provider`'s recorded transcripts from tests/fixtures/replays
   * instead, through replay-agent.cjs; `fault` breaks the agent's last line.
   */
  replay?: {
    provider: AgentProvider;
    scenario: string;
    fault?: "exit" | "close";
  };
  /** More environment for the agents. */
  env?: Record<string, string>;
}

/**
 * What the recorded transcripts ran on: cheap models, low effort. A replay
 * sends the same, since the agent's arguments say which transcript is whose.
 */
export const recordedChoice = (provider: AgentProvider) => ({
  ...defaultAISettings.questions,
  fast: false,
  ...(provider === "claude"
    ? { model: "haiku", reasoningEffort: "" as const }
    : provider === "codex"
      ? { model: "", reasoningEffort: "low" as const }
      : { model: "", reasoningEffort: "" as const }),
});

/** As tests/unit/setup.ts caps a wait. */
const WAIT_MS = 20_000;

export async function startScenario(
  options: ScenarioOptions,
): Promise<Scenario> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-turns-")));
  const repo = join(root, "project");
  await mkdir(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  await writeFile(join(repo, "README.md"), "# Sample\n");
  const cli = await fakeCli(
    join(root, "agent"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  options.findExecutable.mockResolvedValue(cli);
  if (options.replay) {
    const { provider, scenario, fault } = options.replay;
    const dir = resolve("tests/fixtures/replays", provider, scenario);
    const first = (await readFile(join(dir, "01.jsonl"), "utf8")).split(
      "\n",
    )[0];
    const player = await fakeCli(
      join(root, `${provider}-replay`),
      [
        `process.env.RELAY_REPLAY_AGENT = ${JSON.stringify(provider)};`,
        `process.env.RELAY_REPLAY_DIR = ${JSON.stringify(dir)};`,
        fault
          ? `process.env.RELAY_REPLAY_FAULT = ${JSON.stringify(fault)};`
          : "",
        await readFile(resolve("tests/fixtures/replay-agent.cjs"), "utf8"),
      ].join("\n"),
      JSON.parse(first).meta.version,
    );
    options.findExecutable.mockImplementation(async (name: string) =>
      name === provider ? player : cli,
    );
  }
  vi.stubEnv("RELAY_AGENT_CAPTURE", join(root, "capture.jsonl"));
  vi.stubEnv("RELAY_AGENT_TURN_MS", "20");
  for (const [key, value] of Object.entries(options.env ?? {}))
    vi.stubEnv(key, value);
  const store = new Store(join(root, "state"));
  await store.load();
  const projects = new Projects(store);
  const projectId = (await projects.add(repo, null)).id;

  const listeners = new Set<() => void>();
  const pushed: ProjectChatEvent[] = [];
  const latest = new Map<string, Map<string, ChatMessage>>();
  const news: NewsItem[] = [];

  const heard = (event: ProjectChatEvent) => {
    pushed.push(structuredClone(event));
    const m = event.message;
    const thread = latest.get(event.chatId) ?? new Map<string, ChatMessage>();
    thread.set(m.id, structuredClone(m));
    latest.set(event.chatId, thread);
    for (const listener of listeners) listener();
  };

  const chats = new ProjectChats(store, projects, join(root, "chats"), heard);
  // The window's list feed, which the thread list stays in step with.
  const feed = new ChatSummaryFeed(
    (id) => chats.list(id),
    () => {},
  );
  const phones = new Set<(item: NewsItem) => void>();
  const stopNews = chats.onNews((item) => {
    // As shared/sound-cues: an agent's own started thread stays quiet when done.
    if (!(item.kind === "finished" && item.byAgent)) news.push(item);
    for (const phone of phones) phone(item);
    for (const listener of listeners) listener();
  });
  const unsubscribe = chats.onSummaries((id) => {
    feed.changed(id);
    for (const listener of listeners) listener();
  });

  const summary = (id: string) =>
    chats.list(projectId).find((c) => c.id === id);
  /** Settles when `check` has a value; fails after WAIT_MS, so a stuck replay can't pass an `it.fails`. */
  const waitFor = <T>(what: string, check: () => T | undefined) =>
    new Promise<T>((done, fail) => {
      const timer = setTimeout(() => {
        listeners.delete(listener);
        fail(new Error(`Waited ${WAIT_MS}ms for ${what}.`));
      }, WAIT_MS);
      const listener = () => {
        const value = check();
        if (value === undefined) return;
        clearTimeout(timer);
        listeners.delete(listener);
        done(value);
      };
      listeners.add(listener);
      listener();
    });
  const until = (id: string, predicate: (s: ChatSummary) => boolean) =>
    waitFor("the thread's list entry", () => {
      const s = summary(id);
      return s && predicate(s) ? s : undefined;
    });

  const scenario: Scenario = {
    root,
    chats,
    news,
    thread: async () => (await chats.create(projectId, { kind: "project" })).id,
    async send(id, body, provider = "codex", extra = {}) {
      await chats.send(id, {
        id: randomUUID(),
        body: `@${provider} ${body}`,
        provider,
        runtimeMode: "full-access",
        interactionMode: "default",
        choice: {
          ...defaultAISettings.questions,
          model: "fixture-model",
          reasoningEffort: "high",
          fast: true,
        },
        ...extra,
      });
    },
    summary,
    messages: async (id) => (await chats.get(id)).messages,
    until,
    message: (id, predicate) =>
      waitFor(
        "a pushed message",
        () =>
          pushed.find((e) => e.chatId === id && predicate(e.message))?.message,
      ),
    async ended(id) {
      await waitFor("the thread's turns to end", () => {
        const s = summary(id);
        return s && !s.running && !chats.hasActiveProject(projectId)
          ? true
          : undefined;
      });
      // The list the window hears goes out after a short gather.
      feed.flush();
    },
    streaming: (id) =>
      [...(latest.get(id)?.values() ?? [])].filter(
        (m) => m.role === "assistant" && m.status === "streaming",
      ),
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    phone() {
      let away: NewsCursor | undefined;
      const phone: Phone = {
        news: [],
        drop() {
          away = chats.newsSince();
        },
        reconnect() {
          const missed = chats.newsSince(away);
          away = undefined;
          phone.news.push(...(missed.items ?? []));
        },
      };
      phones.add((item) => {
        if (!away) phone.news.push(item);
      });
      return phone;
    },
    async dispose() {
      listeners.clear();
      stopNews();
      unsubscribe();
      feed.dispose();
      await chats.dispose();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true, maxRetries: 20 });
    },
  };
  return scenario;
}
