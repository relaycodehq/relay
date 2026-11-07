import { expect, it, vi } from "vitest";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { LiveHandoff } from "./handoff-live";

it("keeps the reconnect snapshot when an older live push arrives afterward", async () => {
  const chat: ProjectChat = {
    id: "chat",
    projectId: "project",
    title: "Handed off",
    scope: { kind: "project" },
    created: 1,
    updated: 1,
    messages: [],
    sentTo: {
      id: "handoff",
      computerId: "computer",
      computer: "Other computer",
      at: 1,
      state: "away",
      live: true,
      kept: 0,
    },
  };
  const save = vi.fn(async () => {});
  const emit = vi.fn();
  const core = {
    storage: { load: async () => chat, save, chatChanged: vi.fn() },
    emit,
  } as unknown as ChatCore;
  const live = new LiveHandoff(core, () => []);
  const old: ChatMessage = {
    id: "answer",
    role: "assistant",
    provider: "codex",
    body: "Partial",
    status: "streaming",
    created: 1,
    version: 1,
  };
  const final = {
    ...old,
    body: "Final",
    status: "complete" as const,
    version: 2,
  };
  try {
    await live.synced(chat.id, "handoff", [final]);
    save.mockClear();
    emit.mockClear();
    await live.mirror(chat.id, "handoff", old);
    expect(chat.messages).toEqual([final]);
    expect(emit).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    // Copying an attachment locally can rewrite paths without changing its remote version.
    const copied = { ...final, body: "Final with the copied attachment" };
    await live.mirror(chat.id, "handoff", copied);
    expect(chat.messages).toEqual([copied]);
    expect(save).toHaveBeenCalledOnce();
    save.mockClear();
    emit.mockClear();

    const next = { ...final, body: "Next answer", version: 3 };
    await live.mirror(chat.id, "handoff", next);
    expect(chat.messages).toEqual([next]);
    expect(emit).toHaveBeenCalledWith({ chatId: chat.id, message: next });
    expect(save).toHaveBeenCalledOnce();
  } finally {
    live.dispose();
  }
});

function legacyThread() {
  const input = {
    id: "question",
    body: "@codex Keep working",
    provider: "codex" as const,
    choice: {
      model: "gpt-6-sol",
      fast: true,
      reasoningEffort: "high" as const,
    },
    runtimeMode: "read-only" as const,
    interactionMode: "plan" as const,
  };
  const message: ChatMessage = {
    id: input.id,
    role: "user",
    provider: "codex",
    body: input.body,
    status: "complete",
    created: 1,
    version: 3,
  };
  const chat: ProjectChat = {
    id: "chat",
    projectId: "project",
    title: "Older thread",
    scope: { kind: "project" },
    created: 1,
    updated: 2,
    lastInput: input,
    messages: [message],
  };
  const save = vi.fn(async () => {});
  const core = {
    storage: { load: async () => chat, save },
  } as unknown as ChatCore;
  return { chat, message, save, live: new LiveHandoff(core, () => []) };
}

it("exports an older send's settings on its message, including to a follower holding its old version", async () => {
  const { chat, message, save, live } = legacyThread();
  const before = structuredClone(chat);
  const mirrored = await live.writtenHere(chat.id, {
    question: message.version,
  });
  expect(mirrored).toEqual([
    {
      ...before.messages[0],
      sentSettings: {
        provider: "codex",
        choice: before.lastInput!.choice,
        runtimeMode: "read-only",
        interactionMode: "plan",
      },
      version: 4,
    },
  ]);
  expect(save).toHaveBeenCalledExactlyOnceWith(chat);
  expect(chat.lastInput).toEqual(before.lastInput);
  expect(chat.updated).toBe(before.updated);
  expect(await live.writtenHere(chat.id, { question: 4 })).toEqual([
    "question",
  ]);
  expect(message.version).toBe(4);
  expect(save).toHaveBeenCalledOnce();
});

it("preserves a message's own settings rather than overwriting them from lastInput", async () => {
  const { chat, message, save, live } = legacyThread();
  message.sentSettings = {
    provider: "claude",
    choice: { model: "opus", fast: false, reasoningEffort: "max" },
    contextWindow: "200k",
    runtimeMode: "auto",
    interactionMode: "default",
  };
  const before = structuredClone(chat);
  expect(await live.writtenHere(chat.id, { question: 3 })).toEqual([
    "question",
  ]);
  expect(chat).toEqual(before);
  expect(save).not.toHaveBeenCalled();
});

it.each(["note", "missing", "assistant"])(
  "does not invent send settings for a %s",
  async (kind) => {
    const { chat, message, save, live } = legacyThread();
    if (kind === "note") chat.lastInput!.body = "A note without an agent";
    if (kind === "missing") chat.lastInput!.id = "other-question";
    if (kind === "assistant") message.role = "assistant";
    const before = structuredClone(chat);
    expect(await live.writtenHere(chat.id, { question: 3 })).toEqual([
      "question",
    ]);
    expect(chat).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  },
);
