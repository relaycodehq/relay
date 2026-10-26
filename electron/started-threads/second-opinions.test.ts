import { describe, expect, it } from "vitest";
import type {
  ChatMessage,
  ChatSummary,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import { projectChatSendSchema } from "../../shared/projects";
import { answerAndQuestion, SecondOpinions } from "./second-opinions";

const message = (
  id: string,
  role: ChatMessage["role"],
  body: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role,
  body,
  created: 1,
  provider: "claude",
  status: "complete",
  version: 1,
  ...extra,
});

const lead = (messages: ChatMessage[], extra: Partial<ProjectChat> = {}) =>
  ({
    id: "lead",
    projectId: "acme",
    scope: { kind: "project" },
    title: "Phone bridge on slow networks",
    created: 1,
    updated: 1,
    messages,
    ...extra,
  }) as ProjectChat;

/** ProjectChats as far as second opinions reach, keeping what they were asked to do. */
function fakeChats(threads: ProjectChat[]) {
  const created: {
    workspace?: string;
    startedBy?: unknown;
    start?: unknown;
  }[] = [];
  const sent: { id: string; input: ProjectChatSend }[] = [];
  const renamed: string[] = [];
  const chats = {
    get: async (id: string) => {
      const found = threads.find((t) => t.id === id);
      if (!found) throw new Error("No such thread");
      return found;
    },
    create: async (
      _projectId: string,
      _scope: unknown,
      workspace?: string,
      startedBy?: unknown,
      _branch?: string,
      _links?: unknown,
      start?: unknown,
    ) => {
      created.push({ workspace, startedBy, start });
      return { id: "opinion" } as ChatSummary;
    },
    rename: async (_id: string, title: string) => {
      renamed.push(title);
      return {} as ChatSummary;
    },
    send: async (id: string, input: ProjectChatSend) => {
      sent.push({ id, input });
    },
    files: { image: async () => "data:image/png;base64,iVBORw0KGgo=" },
  };
  return { chats, created, sent, renamed };
}

describe("answerAndQuestion", () => {
  it("takes every part of the reply and the message it answered", () => {
    const chat = lead([
      message("q0", "user", "earlier"),
      message("a0", "assistant", "earlier answer"),
      message("q", "user", "Should we move to WebTransport?"),
      message("a1", "assistant", "Let me look."),
      message("r", "user", "", { resumed: true }),
      message("a2", "assistant", "Fold the read into the ack."),
    ]);
    const found = answerAndQuestion(chat, "a2");
    expect(found?.question?.id).toBe("q");
    expect(found?.reply).toBe("Let me look.\n\nFold the read into the ack.");
  });

  it("leaves side conversations out, and offers nothing on them", () => {
    const chat = lead([
      message("q", "user", "The question"),
      message("btw", "user", "by the way?", { side: true }),
      message("side", "assistant", "aside", { parentId: "btw" }),
      message("a", "assistant", "The answer"),
    ]);
    expect(answerAndQuestion(chat, "a")?.question?.id).toBe("q");
    expect(answerAndQuestion(chat, "side")).toBeUndefined();
  });

  it("offers nothing on an answer that hasn't finished", () => {
    const chat = lead([
      message("q", "user", "The question"),
      message("a", "assistant", "Half", { status: "streaming" }),
    ]);
    expect(answerAndQuestion(chat, "a")).toBeUndefined();
  });
});

describe("SecondOpinions.ask", () => {
  const asked = lead(
    [
      message("q", "user", "@claude Should we move to WebTransport?", {
        images: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "latency.png",
            mimeType: "image/png",
            sizeBytes: 8,
          },
        ],
      }),
      message("a", "assistant", "Yes, but not for the reason it looks like."),
    ],
    { accounts: { codex: "work" } },
  );

  it("starts a read-only thread under the lead with the colleague's answer", async () => {
    const { chats, created, sent, renamed } = fakeChats([asked]);
    await new SecondOpinions(chats).ask("lead", "a", {
      provider: "codex",
      model: "gpt-5.5",
    });
    expect(created).toEqual([
      {
        workspace: "checkout",
        startedBy: { chatId: "lead", agent: "claude", secondOpinionOn: "a" },
        start: undefined,
      },
    ]);
    expect(renamed).toEqual(["Second opinion: Phone bridge on slow networks"]);
    const { id, input } = sent[0]!;
    expect(id).toBe("opinion");
    expect(projectChatSendSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      provider: "codex",
      to: "codex",
      choice: { model: "gpt-5.5" },
      runtimeMode: "read-only",
      account: "work",
      images: [{ name: "latency.png", mimeType: "image/png" }],
      secondOpinion: {
        question: "Should we move to WebTransport?",
        answer: "Yes, but not for the reason it looks like.",
      },
    });
    expect(input.body).toMatch(/^My colleague answered this question/);
    // Who wrote it tilts the review: no agent, model or the user's own work.
    expect(input.body).not.toMatch(/\b(AI|agent|Claude|model|my answer)\b/i);
  });

  it("works in the lead's worktree, so it reads the same files", async () => {
    const inWorktree = {
      ...asked,
      worktree: { path: "/wt/bridge", branch: "relay/bridge" },
    };
    const { chats, created } = fakeChats([inWorktree]);
    await new SecondOpinions(chats).ask("lead", "a", {
      provider: "codex",
      model: "",
    });
    expect(created[0]).toMatchObject({
      workspace: "worktree",
      start: { on: "relay/bridge" },
    });
  });

  it("refuses an answer that isn't finished, before making a thread", async () => {
    const { chats, created } = fakeChats([
      lead([message("a", "assistant", "", { status: "failed" })]),
    ]);
    await expect(
      new SecondOpinions(chats).ask("lead", "a", {
        provider: "codex",
        model: "",
      }),
    ).rejects.toThrow(/finished answer/);
    expect(created).toEqual([]);
  });
});

describe("SecondOpinions.sendBack", () => {
  const opinionId = "00000000-0000-4000-8000-0000000000aa";
  const opinion = (reply: Partial<ChatMessage>) =>
    ({
      ...lead([
        message("p", "user", "My colleague answered…", { provider: "codex" }),
        message("r", "assistant", "Mostly right, but stop after step 1.", {
          provider: "codex",
          ...reply,
        }),
      ]),
      id: opinionId,
      title: "Second opinion: Phone bridge on slow networks",
      startedBy: { chatId: "lead", agent: "claude", secondOpinionOn: "a" },
    }) as ProjectChat;
  const theLead = lead([], {
    lastInput: {
      id: "x",
      body: "",
      provider: "claude",
      to: "claude",
      choice: {
        model: "claude-opus-5-5",
        fast: false,
        reasoningEffort: "high",
      },
      runtimeMode: "approval-required",
      interactionMode: "default",
    },
  });

  it("tells the lead's agent what the opinion said, from that thread", async () => {
    const { chats, sent } = fakeChats([theLead, opinion({})]);
    await new SecondOpinions(chats).sendBack(opinionId);
    const { id, input } = sent[0]!;
    expect(id).toBe("lead");
    expect(projectChatSendSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      provider: "claude",
      choice: { model: "claude-opus-5-5" },
      fromThread: { id: opinionId, child: "finished" },
    });
    expect(input.body).toMatch(/Mostly right, but stop after step 1\.$/);
  });

  it("waits for the opinion to finish", async () => {
    const { chats, sent } = fakeChats([
      theLead,
      opinion({ status: "streaming" }),
    ]);
    await expect(new SecondOpinions(chats).sendBack(opinionId)).rejects.toThrow(
      /hasn't finished/,
    );
    expect(sent).toEqual([]);
  });

  it("doesn't send to a lead that's on another computer", async () => {
    const away = {
      ...theLead,
      sentTo: {
        id: "h",
        computerId: "mini",
        computer: "macmini",
        at: 1,
        state: "away",
      },
    } as ProjectChat;
    const { chats, sent } = fakeChats([away, opinion({})]);
    await expect(new SecondOpinions(chats).sendBack(opinionId)).rejects.toThrow(
      /macmini/,
    );
    expect(sent).toEqual([]);
  });
});
