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
    await live.mirror(chat.id, "handoff", { ...final });
    expect(chat.messages).toEqual([final]);
    expect(emit).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    const next = { ...final, body: "Next answer", version: 3 };
    await live.mirror(chat.id, "handoff", next);
    expect(chat.messages).toEqual([next]);
    expect(emit).toHaveBeenCalledWith({ chatId: chat.id, message: next });
    expect(save).toHaveBeenCalledOnce();
  } finally {
    live.dispose();
  }
});
