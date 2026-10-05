import { expect, test } from "vitest";
import type {
  ChatSummary,
  ProjectChat,
  ProjectChatSend,
  StartedBy,
} from "../../shared/projects";
import { StartedThreads } from ".";

/** Just the thread operations the tools use, over plain records. */
function fakeChats() {
  const chats = new Map<
    string,
    ProjectChat & { running?: boolean; waiting?: boolean }
  >();
  const sent: { id: string; input: ProjectChatSend }[] = [];
  const asked: { id: string; request: unknown }[] = [];
  const copies: { id: string; from: string }[] = [];
  /** What the user picks on the approval card. */
  const answer = { decision: "accept" };
  let next = 100;
  const lead: ProjectChat = {
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "p",
    scope: { kind: "project" },
    title: "Competitor research",
    created: 1,
    updated: 1,
    messages: [],
    accounts: { codex: "work" },
    lastInput: {
      id: "00000000-0000-4000-8000-0000000000aa",
      body: "go",
      provider: "claude",
      to: "claude",
      choice: {
        model: "claude-opus-5-5",
        fast: false,
        reasoningEffort: "high",
      },
      runtimeMode: "auto-accept-edits",
      interactionMode: "default",
    },
  };
  chats.set(lead.id, lead);
  return {
    lead,
    sent,
    chats,
    api: {
      list: (projectId: string) =>
        [...chats.values()].filter(
          (c) => c.projectId === projectId,
        ) as ChatSummary[],
      get: async (id: string) => {
        const chat = chats.get(id);
        if (!chat) throw new Error("No such thread.");
        return structuredClone(chat);
      },
      create: async (
        projectId: string,
        scope: any,
        workspace?: string,
        startedBy?: StartedBy,
      ) => {
        const id = `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
        const chat: ProjectChat = {
          id,
          projectId,
          scope,
          title: "New chat",
          created: 2,
          updated: 2,
          messages: [],
          ...(workspace === "worktree" ? { worktree: {} } : {}),
          ...(startedBy ? { startedBy } : {}),
        };
        chats.set(id, chat);
        return chat;
      },
      send: async (id: string, input: ProjectChatSend) => {
        sent.push({ id, input });
        const chat = chats.get(id)!;
        chat.lastInput = input;
        chat.messages.push({
          id: input.id,
          role: "user",
          body: input.body,
          status: "complete",
          created: 3,
          provider: input.provider,
          version: 1,
        });
      },
      cancel: async () => undefined,
      triage: async (id: string, triage: { kind: string }) => {
        if (triage.kind === "settle") chats.get(id)!.settledAt = Date.now();
      },
      worktreeFrom: async (id: string, from: string) => {
        copies.push({ id, from });
        return 2;
      },
      askInTurn: async (id: string, request: unknown) => {
        asked.push({ id, request });
        return { kind: "approval", decision: answer.decision };
      },
    } as any,
    asked,
    answer,
    copies,
  };
}

const call = (
  threads: StartedThreads,
  chatId: string,
  name: string,
  args: unknown,
) => threads.handle(chatId, name, args, new AbortController().signal);
const parse = (result: { content: { text: string }[] }) =>
  JSON.parse(result.content[0]!.text);

test("starts threads on the lead's agent and settings, each saying who sent it", async () => {
  const { lead, sent, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  const result = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [
        { prompt: "Add a chat width setting" },
        {
          prompt: "Same, in Codex",
          agent: "codex",
          plan: true,
          worktree: false,
        },
      ],
    }),
  );
  expect(result).toMatchObject([
    { title: "Add a chat width setting", agent: "claude", worktree: true },
    { agent: "codex", plan: true, worktree: false },
  ]);
  const [claude, codex] = sent;
  expect(claude!.input).toMatchObject({
    to: "claude",
    choice: { model: "claude-opus-5-5", reasoningEffort: "high" },
    runtimeMode: "auto-accept-edits",
    interactionMode: "default",
    fromThread: { id: lead.id, name: "Claude in Competitor research" },
  });
  // Another agent starts on its own default, signed in as the lead's account for it.
  expect(codex!.input).toMatchObject({
    to: "codex",
    choice: { model: "", reasoningEffort: "" },
    interactionMode: "plan",
    account: "work",
  });
  expect(chats.get(claude!.id)!.startedBy).toEqual({
    chatId: lead.id,
    agent: "claude",
  });
});

test("a lead only sees and drives its own threads", async () => {
  const { lead, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  const stranger = await api.create("p", { kind: "project" });
  chats.get(stranger.id)!.title = "Someone else's";
  const [mine] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "Mine" }],
    }),
  );
  expect(
    parse(await call(threads, lead.id, "list_threads", {})).map(
      (t: any) => t.id,
    ),
  ).toEqual([mine.id]);
  const refused = await call(threads, lead.id, "read_thread", {
    id: stranger.id,
  });
  expect(refused).toMatchObject({ isError: true });
});

test("a started thread can't start threads of its own", async () => {
  const { lead, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "Child" }],
    }),
  );
  const refused = await call(threads, child.id, "start_threads", {
    threads: [{ prompt: "Grandchild" }],
  });
  expect(refused).toMatchObject({ isError: true });
});

test("no more than six of a lead's threads work at once", async () => {
  const { lead, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  await call(threads, lead.id, "start_threads", {
    threads: Array.from({ length: 5 }, (_, i) => ({ prompt: `Task ${i}` })),
  });
  for (const chat of chats.values()) if (chat.startedBy) chat.running = true;
  const refused = await call(threads, lead.id, "start_threads", {
    threads: [{ prompt: "Six" }, { prompt: "Seven" }],
  });
  expect(refused).toMatchObject({ isError: true });
  expect(refused.content[0]!.text).toMatch(/5 of your threads are working/);
});

test("waiting ends once every thread is done or needs the user", async () => {
  const { lead, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [a, b] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "A" }, { prompt: "B" }],
    }),
  );
  chats.get(a.id)!.running = true;
  chats.get(b.id)!.running = true;
  const waiting = call(threads, lead.id, "wait_for_threads", {
    timeoutSeconds: 5,
  });
  setTimeout(() => {
    const done = chats.get(a.id)!;
    done.running = false;
    done.messages.push({
      id: "answer",
      role: "assistant",
      body: "Done, tests pass.",
      status: "complete",
      created: 4,
      provider: "claude",
      version: 1,
    });
    chats.get(b.id)!.waiting = true;
  }, 300);
  const result = parse(await waiting);
  expect(result.timedOut).toBeUndefined();
  expect(
    Object.fromEntries(result.threads.map((t: any) => [t.id, t.status])),
  ).toEqual({
    [a.id]: "done",
    [b.id]: "needs-input",
  });
  expect(result.threads.find((t: any) => t.id === a.id).latest).toBe(
    "Done, tests pass.",
  );
});

test("a message to a started thread goes on its own settings, from the lead", async () => {
  const { lead, sent, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "A", agent: "codex", model: "gpt-5.5" }],
    }),
  );
  await call(threads, lead.id, "send_to_thread", {
    id: child.id,
    message: "Also fix the docs",
    steer: true,
  });
  expect(sent.at(-1)!.input).toMatchObject({
    body: "Also fix the docs",
    to: "codex",
    choice: { model: "gpt-5.5" },
    delivery: "steer",
    fromThread: { id: lead.id },
  });
});

test("starting threads asks the user first, unless the lead has full access", async () => {
  const { lead, sent, asked, answer, api } = fakeChats();
  const threads = new StartedThreads(api);
  answer.decision = "decline";
  const declined = await call(threads, lead.id, "start_threads", {
    threads: [
      { prompt: "Add a chat width setting" },
      { prompt: "B", agent: "codex", plan: true },
    ],
  });
  expect(declined).toMatchObject({ isError: true });
  expect(sent).toEqual([]);
  expect(asked).toEqual([
    {
      id: lead.id,
      request: expect.objectContaining({
        kind: "approval",
        title: "Start 2 threads?",
        detail:
          "1. Claude\nAdd a chat width setting\n\n2. Codex, plans first\nB",
        decisions: ["accept", "decline", "cancel"],
      }),
    },
  ]);

  lead.lastInput!.runtimeMode = "full-access";
  await call(threads, lead.id, "start_threads", { threads: [{ prompt: "C" }] });
  expect(asked).toHaveLength(1);
  expect(sent).toHaveLength(1);
});

test("reading and waiting never ask", async () => {
  const { lead, asked, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "A" }],
    }),
  );
  asked.length = 0;
  await call(threads, lead.id, "list_threads", {});
  await call(threads, lead.id, "read_thread", { id: child.id });
  await call(threads, lead.id, "wait_for_threads", { timeoutSeconds: 1 });
  expect(asked).toEqual([]);
});

test("a message to a started thread asks first too, unless the lead has full access; stopping never asks", async () => {
  const { lead, sent, asked, answer, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "Add a chat width setting" }],
    }),
  );
  chats.get(child.id)!.title = "Chat width";
  asked.length = 0;
  const before = sent.length;

  answer.decision = "decline";
  const declined = await call(threads, lead.id, "send_to_thread", {
    id: child.id,
    message: "Also cover the phone",
    steer: true,
  });
  expect(declined).toMatchObject({ isError: true });
  expect(sent).toHaveLength(before);
  expect(asked.at(-1)).toEqual({
    id: lead.id,
    request: expect.objectContaining({
      title: "Steer “Chat width”?",
      detail: "Also cover the phone",
    }),
  });

  answer.decision = "accept";
  await call(threads, lead.id, "send_to_thread", {
    id: child.id,
    message: "Also cover the phone",
  });
  expect(sent).toHaveLength(before + 1);
  expect(asked.at(-1)!.request).toMatchObject({
    title: "Send to “Chat width”?",
  });

  const asks = asked.length;
  await call(threads, lead.id, "stop_thread", { id: child.id });
  lead.lastInput!.runtimeMode = "full-access";
  await call(threads, lead.id, "send_to_thread", {
    id: child.id,
    message: "Go on",
  });
  expect(asked).toHaveLength(asks);
  expect(sent).toHaveLength(before + 2);
});

test("a worktree starts from the lead's files, uncommitted edits included, unless told otherwise", async () => {
  const { lead, copies, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [copied, clean, inCheckout] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [
        { prompt: "A" },
        { prompt: "B", uncommitted: false },
        { prompt: "C", worktree: false },
      ],
    }),
  );
  expect(copies).toEqual([{ id: copied.id, from: lead.id }]);
  expect(copied.uncommittedFilesCopied).toBe(2);
  expect(clean).toMatchObject({ worktree: true });
  expect(clean.uncommittedFilesCopied).toBeUndefined();
  expect(inCheckout).toMatchObject({ worktree: false });
});

test("settling a started thread waits until it's done and never asks", async () => {
  const { lead, chats, api, asked } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "Branch name" }],
    }),
  );
  const asks = asked.length;
  const thread = chats.get(child.id)!;
  thread.running = true;
  expect(
    await call(threads, lead.id, "settle_thread", { id: child.id }),
  ).toMatchObject({ isError: true });
  expect(thread.settledAt).toBeUndefined();

  thread.running = false;
  thread.messages.push({
    id: "answer",
    role: "assistant",
    body: "Done.",
    status: "complete",
    created: 4,
    provider: "claude",
    version: 1,
  });
  expect(
    await call(threads, lead.id, "settle_thread", { id: child.id }),
  ).toMatchObject({ content: [{ text: "Settled." }] });
  expect(thread.settledAt).toBeDefined();
  expect(asked).toHaveLength(asks);
  expect(
    await call(threads, lead.id, "settle_thread", { id: lead.id }),
  ).toMatchObject({ isError: true });
});
