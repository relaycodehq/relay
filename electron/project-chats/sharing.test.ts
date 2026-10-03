import { describe, it, expect } from "vitest";
import { ChatSharing } from "./sharing";
import { HttpStatusError } from "../../shared/http";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import type { ProjectSharing } from "../projects/project-sharing";

const message = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "user",
  body: id,
  status: "complete",
  created: 1,
  provider: "codex",
  version: 1,
  pending: true,
  ...over,
});

function thread(...messages: ChatMessage[]) {
  const chat = {
    id: "chat",
    projectId: "project",
    title: "Chat",
    scope: { kind: "project" },
    created: 1,
    updated: 1,
    shared: { server: "https://rooms.test", roomId: "chat", memberId: "me" },
    messages,
  } as ProjectChat;
  const core = {
    storage: {
      load: async () => chat,
      save: async () => {},
      persist: async () => {},
    },
    active: { has: () => false },
    emit: () => {},
  } as unknown as ChatCore;
  return { chat, core };
}

function server(send: (message: any) => any) {
  const sent: any[] = [];
  let seq = 0;
  const polls: number[] = [];
  const remote = {
    send: async (_: unknown, messages: ChatMessage[]) => {
      sent.push(...messages);
      return messages.map((m) => ({
        ...send(m),
        id: m.id,
        author: "Me",
        authorId: "me",
        seq: ++seq,
      }));
    },
    poll: async (_: unknown, after: number) => {
      polls.push(after);
      return {
        conversation: { updated: 1 },
        messages: [],
        next: seq,
        more: false,
      };
    },
  } as unknown as ProjectSharing;
  return { remote, sent, polls };
}

const refuse = (status: number, text = "Refused.") =>
  new HttpStatusError(text, status);

describe("ChatSharing.pull with a message the server refuses for good", () => {
  it("keeps the message local, delivers the ones after it and still polls, so the thread neither stalls nor retries it", async () => {
    const { chat, core } = thread(
      message("long"),
      message("next"),
      message("cursor", { provider: "cursor" }),
      message("last"),
    );
    const { remote, sent, polls } = server((m) => {
      if (m.id === "long") throw refuse(400, "Too big.");
      if (m.id === "cursor") throw refuse(400, "Unknown provider.");
    });
    const sharing = new ChatSharing(core, remote, { sync: async () => {} });
    await sharing.pull("chat");
    expect(sent.map((m) => m.id)).toEqual(["long", "next", "cursor", "last"]);
    expect(chat.messages.map((m) => [m.id, m.pending, m.seq])).toEqual([
      ["long", false, undefined],
      ["next", false, 1],
      ["cursor", false, undefined],
      ["last", false, 2],
    ]);
    expect(polls).toHaveLength(1);
    await sharing.pull("chat");
    expect(sent).toHaveLength(4);
  });

  it("sends a reply to a message that was never shared without its parent link", async () => {
    const { chat, core } = thread(
      message("note", { role: "assistant", pending: false }),
      message("shared", { pending: false, seq: 4 }),
      message("reply", { parentId: "note" }),
      message("answer", { role: "assistant", parentId: "shared" }),
    );
    const { remote, sent } = server(() => ({}));
    await new ChatSharing(core, remote, { sync: async () => {} }).pull("chat");
    expect(sent.map((m) => m.parentId ?? null)).toEqual([null, "shared"]);
    expect(chat.messages.find((m) => m.id === "reply")!.parentId).toBe("note");
  });

  it("polls even when delivery fails in passing, and then reports that failure", async () => {
    const { chat, core } = thread(message("a"), message("b"));
    const { remote, sent, polls } = server(() => {
      throw refuse(503);
    });
    const sharing = new ChatSharing(core, remote, { sync: async () => {} });
    await expect(sharing.pull("chat")).rejects.toThrow("Refused.");
    expect(sent.map((m) => m.id)).toEqual(["a"]);
    expect(polls).toHaveLength(1);
    expect(chat.messages.every((m) => m.pending)).toBe(true);
  });
});
