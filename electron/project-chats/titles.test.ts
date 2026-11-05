import { it, expect, vi } from "vitest";
import type { ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { ThreadTitles } from "./titles";

const agentTitle = vi.hoisted(() => ({
  resolve: (_title: string) => {},
}));

vi.mock("../agents/thread-titles", async (original) => ({
  ...(await original<typeof import("../agents/thread-titles")>()),
  regenerateThreadTitle: () =>
    new Promise<string>((resolve) => (agentTitle.resolve = resolve)),
}));

function answered(): ProjectChat {
  return {
    id: "chat",
    projectId: "p",
    title: "Old name",
    scope: { kind: "project" },
    created: 1,
    updated: 1,
    messages: [
      { id: "q", role: "user", body: "Explain", status: "complete" },
      {
        id: "a",
        role: "assistant",
        body: "It works so",
        status: "complete",
        provider: "claude",
      },
    ],
  } as unknown as ProjectChat;
}

function titles(chat: ProjectChat) {
  const core = {
    store: { get: () => ({ chats: [chat] }) },
    storage: { load: async () => chat, save: vi.fn(async () => {}) },
    closing: () => false,
  } as unknown as ChatCore;
  return new ThreadTitles(core);
}

it("keeps a name you typed while the title was being regenerated", async () => {
  const chat = answered();
  const threadTitles = titles(chat);
  const regenerated = threadTitles.regenerate(chat.id);
  await vi.waitFor(() => expect(threadTitles.running()).toHaveLength(1));
  await threadTitles.rename(chat.id, "My own name");
  agentTitle.resolve("Generated name");
  await regenerated.catch(() => {});
  expect(chat.title).toBe("My own name");
  expect(chat.renamed).toBe(true);
});
