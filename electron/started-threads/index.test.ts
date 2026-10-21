import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type {
  ChatSummary,
  Project,
  ProjectChat,
  ProjectChatSend,
  StartedBy,
} from "../../shared/projects";
import { addNote, tickNote, type NewNote } from "../../shared/thread-notes";
import { localTime, StartedThreads, type AgentProjects } from ".";
import { MESSAGE_CHARS, resultText, type ToolResult } from "../relay-mcp";
import { chatStatus } from "../project-chats";
import { chatSummary } from "../project-chats/storage";

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
      startedThreads: (leadId: string) =>
        [...chats.values()].filter(
          (c) => c.startedBy?.chatId === leadId,
        ) as ChatSummary[],
      allowDriving: async (id: string, on: boolean) => {
        if (on) chats.get(id)!.drivesThreads = true;
        else delete chats.get(id)!.drivesThreads;
      },
      get: async (id: string) => {
        const chat = chats.get(id);
        if (!chat) throw new Error("No such thread.");
        return structuredClone(chat);
      },
      statuses: async (
        selection: { ids: string[] } | { startedBy: string },
      ) => {
        const ids =
          "ids" in selection
            ? selection.ids
            : [...chats.values()]
                .filter(
                  (c) =>
                    c.startedBy?.chatId === selection.startedBy &&
                    !c.archivedAt,
                )
                .map((c) => c.id);
        return ids.map((id) => {
          const chat = chats.get(id);
          if (!chat || chat.archivedAt) throw new Error("No such thread.");
          return chatStatus(chatSummary(chat), chat);
        });
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
      settleItself: async (id: string) => {
        chats.get(id)!.settleWhenDone = Date.now();
        return true;
      },
      worktreeFrom: async (id: string, from: string) => {
        copies.push({ id, from });
        return 2;
      },
      askInTurn: async (id: string, request: unknown) => {
        asked.push({ id, request });
        return { kind: "approval", decision: answer.decision };
      },
      notes: {
        list: async (id: string) => chats.get(id)!.notes ?? [],
        add: async (id: string, input: NewNote) => {
          const chat = chats.get(id)!;
          const { notes, note } = addNote(chat.notes, input);
          chat.notes = notes;
          return note;
        },
        tick: async (id: string, note: string, item: number, done: boolean) => {
          const chat = chats.get(id)!;
          chat.notes = tickNote(chat.notes, note, item, done);
        },
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
const parse = (result: ToolResult) => JSON.parse(resultText(result));
const ALWAYS =
  "Always lets this thread start, message, stop and settle any thread in any project without asking again. Reading needs no permission.";

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

test("any thread finds and reads every other without asking", async () => {
  const { lead, chats, api, asked } = fakeChats();
  const site = "00000000-0000-4000-8000-0000000000b1";
  const threads = new StartedThreads(api, {
    projects: {
      list: async () =>
        [
          { id: "p", name: "Lead" },
          { id: site, name: "Site" },
        ] as Project[],
    } as AgentProjects,
  });
  const stranger = await api.create("p", { kind: "project" });
  Object.assign(chats.get(stranger.id)!, {
    title: "Someone else's cache fix",
    updated: 50,
    running: true,
  });
  const elsewhere = await api.create(site, { kind: "project" });
  Object.assign(chats.get(elsewhere.id)!, {
    title: "Landing page",
    updated: 40,
  });
  const archived = await api.create(site, { kind: "project" });
  chats.get(archived.id)!.archivedAt = 1;
  const [mine] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "Mine" }],
    }),
  );
  await api.send(stranger.id, { ...lead.lastInput!, id: "m1", body: "Fix it" });

  expect(
    parse(await call(threads, lead.id, "list_threads", {})).map(
      (t: any) => t.id,
    ),
  ).toEqual([mine.id]);
  const all = parse(await call(threads, lead.id, "find_threads", {}));
  expect(all.map((t: any) => t.id)).toEqual([
    stranger.id,
    elsewhere.id,
    mine.id,
    lead.id,
  ]);
  expect(all[0]).toMatchObject({ project: "Lead", status: "working" });
  expect(all[3]).toMatchObject({ you: true });
  expect(all[2]).toMatchObject({ startedBy: lead.id });
  expect(
    parse(
      await call(threads, lead.id, "find_threads", { query: "CACHE someone" }),
    ).map((t: any) => t.id),
  ).toEqual([stranger.id]);
  expect(
    parse(await call(threads, lead.id, "find_threads", { project: site })).map(
      (t: any) => t.title,
    ),
  ).toEqual(["Landing page"]);

  const read = parse(
    await call(threads, lead.id, "read_thread", { id: stranger.id }),
  );
  expect(read.messages.map((m: any) => m.body)).toEqual(["Fix it"]);
  // A started thread reads too, but sends nowhere.
  expect(
    await call(threads, mine.id, "read_thread", { id: stranger.id }),
  ).not.toHaveProperty("isError");
  expect(
    await call(threads, mine.id, "send_to_thread", {
      id: stranger.id,
      message: "Hi",
    }),
  ).toMatchObject({ isError: true });
  // Only starting its own thread asked.
  expect(asked).toHaveLength(1);
});

test("a started thread can't start threads of its own, only read usage", async () => {
  const { lead, api } = fakeChats();
  const threads = new StartedThreads(api, {
    readUsage: async (provider) => ({ provider, windows: [], message: null }),
  });
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "Child" }],
    }),
  );
  const refused = await call(threads, child.id, "start_threads", {
    threads: [{ prompt: "Grandchild" }],
  });
  expect(refused).toMatchObject({ isError: true });
  expect(await call(threads, child.id, "usage_limits", {})).not.toHaveProperty(
    "isError",
  );
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
  expect(resultText(refused)).toMatch(/5 of your threads are working/);
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

test("listing and waiting batch progress without fetching target histories", async () => {
  const { lead, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "A" }],
    }),
  );
  chats.get(child.id)!.messages.push(
    {
      id: "answer",
      role: "assistant",
      body: "x".repeat(605) + "Done.",
      status: "complete",
      created: 4,
      provider: "claude",
      version: 1,
    },
    {
      id: "side-answer",
      parentId: "side",
      role: "assistant",
      body: "Side conversations do not replace the main answer.",
      status: "failed",
      error: "Side failure",
      provider: "claude",
      created: 5,
      version: 1,
    },
  );
  const get = vi.spyOn(api, "get");
  const status = vi.spyOn(api, "statuses");
  for (const [name, args] of [
    ["list_threads", {}],
    ["wait_for_threads", { ids: [child.id], timeoutSeconds: 1 }],
  ] as const) {
    get.mockClear();
    status.mockClear();
    const result = parse(await call(threads, lead.id, name, args));
    expect(name === "list_threads" ? result : result.threads).toMatchObject([
      { id: child.id, status: "done", latest: "…" + "x".repeat(595) + "Done." },
    ]);
    expect(
      name === "list_threads" ? result[0] : result.threads[0],
    ).not.toHaveProperty("error");
    expect(status).toHaveBeenCalledExactlyOnceWith(
      name === "list_threads" ? { startedBy: lead.id } : { ids: [child.id] },
    );
    // The calling thread is read once for authorization; targets need no full read.
    expect(get.mock.calls).toEqual([[lead.id]]);
  }
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

const agents = {
  cantRun: (agent: string) =>
    agent === "amp" ? "Amp isn't installed on this computer." : undefined,
  models: async (agent: string) =>
    agent === "codex"
      ? [
          {
            id: "gpt-6-astra",
            name: "GPT-6 Astra",
            description: "",
            efforts: ["low", "high"],
          },
          { id: "gpt-6-sol", name: "GPT-6 Sol", description: "", efforts: [] },
        ]
      : [],
} as any;

test("an agent or model that can't run here is refused before the user is asked", async () => {
  const { lead, sent, asked, api } = fakeChats();
  const threads = new StartedThreads(api, { agents });
  const start = async (thread: object) => {
    const result = await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "Draw an icon", ...thread }],
    });
    expect(result).toMatchObject({ isError: true });
    return resultText(result);
  };
  expect(await start({ agent: "acp:astra" })).toContain(
    "acp:astra isn't installed here. Agents that can run here: codex (Codex), claude (Claude)",
  );
  expect(await start({ agent: "amp" })).toContain(
    "Amp isn't installed on this computer.",
  );
  expect(await start({ agent: "codex", model: "astra" })).toBe(
    "Codex has no model astra. Did you mean gpt-6-astra? Its models: gpt-6-astra, gpt-6-sol.",
  );
  expect(asked).toEqual([]);
  expect(sent).toEqual([]);

  lead.lastInput!.runtimeMode = "full-access";
  await call(threads, lead.id, "start_threads", {
    threads: [{ prompt: "Draw an icon", agent: "codex", model: "gpt-6-astra" }],
  });
  expect(sent).toHaveLength(1);
});

test("list_agents gives the agents that can run here with their models", async () => {
  const { lead, api } = fakeChats();
  const threads = new StartedThreads(api, { agents });
  const listed = parse(await call(threads, lead.id, "list_agents", {}));
  expect(listed.agents.map((a: any) => a.agent)).not.toContain("amp");
  expect(listed.agents.find((a: any) => a.agent === "codex")).toEqual({
    agent: "codex",
    name: "Codex",
    models: [
      {
        id: "gpt-6-astra",
        name: "GPT-6 Astra",
        efforts: ["low", "high"],
        fast: true,
      },
      { id: "gpt-6-sol", name: "GPT-6 Sol", fast: true },
    ],
  });
  expect(listed.agents.find((a: any) => a.agent === "claude").you).toBe(true);
  expect(listed.unavailable).toEqual([
    { agent: "amp", why: "Amp isn't installed on this computer." },
  ]);
});

test("Cursor children inherit Fast, can override it, and advertise model support", async () => {
  const { lead, sent, api } = fakeChats();
  lead.lastInput!.provider = "cursor";
  lead.lastInput!.to = "cursor";
  lead.lastInput!.runtimeMode = "full-access";
  lead.lastInput!.choice = {
    model: "grok-4.7",
    fast: true,
    reasoningEffort: "high",
  };
  const threads = new StartedThreads(api, {
    agents: {
      ...agents,
      models: async () => [
        {
          id: "grok-4.7",
          name: "Grok 4.7",
          description: "",
          efforts: ["high" as const],
          fast: true,
        },
        { id: "auto", name: "Auto", description: "", efforts: [], fast: false },
      ],
    },
  });
  const listed = parse(
    await call(threads, lead.id, "list_agents", { agent: "cursor" }),
  );
  expect(listed.agents[0].models[0].fast).toBe(true);
  await call(threads, lead.id, "start_threads", {
    threads: [{ prompt: "Inherited" }, { prompt: "Standard", fast: false }],
  });
  expect(sent.map((s) => s.input.choice)).toEqual([
    { model: "grok-4.7", fast: true, reasoningEffort: "high" },
    { model: "grok-4.7", fast: false, reasoningEffort: "high" },
  ]);
  const refused = await call(threads, lead.id, "start_threads", {
    threads: [{ prompt: "Unsupported", model: "auto", fast: true }],
  });
  expect(resultText(refused)).toContain("does not offer Fast mode");
  expect(sent).toHaveLength(2);
});

test("a thread that fails as it starts is reported failed and settled once its run ends", async () => {
  const { lead, chats, api } = fakeChats();
  const send = api.send;
  const error =
    "The 'astra' model is not supported when using Codex with a ChatGPT account.";
  let settledWhileRunning = false;
  const triage = api.triage;
  api.triage = async (id: string, t: { kind: string }) => {
    if (chats.get(id)!.running) {
      settledWhileRunning = true;
      throw new Error(
        "Wait for the running answer and its requests before settling.",
      );
    }
    return triage(id, t);
  };
  api.send = async (id: string, input: ProjectChatSend) => {
    await send(id, input);
    const chat = chats.get(id)!;
    setTimeout(() => {
      chat.running = true;
      chat.messages.push({
        id: "a",
        role: "assistant",
        body: "",
        status: "failed",
        error,
        created: 4,
        provider: "codex",
        version: 1,
      });
    }, 50);
    setTimeout(() => (chat.running = false), 600);
  };
  lead.lastInput!.runtimeMode = "full-access";
  const threads = new StartedThreads(api, { failureWatchMs: 5000 });
  const [thread] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "Draw an icon", agent: "codex" }],
    }),
  );
  expect(thread).toMatchObject({
    agent: "codex",
    failed: error,
    settled: true,
  });
  expect(chats.get(thread.id)!.settledAt).toBeDefined();
  expect(settledWhileRunning).toBe(false);
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

test("reading on from `next` returns an answer that was still streaming, finished", async () => {
  const { lead, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "A" }],
    }),
  );
  const answer = {
    id: "a1",
    role: "assistant" as const,
    body: "Working on",
    status: "streaming" as const,
    created: 4,
    provider: "claude" as const,
    version: 1,
  };
  chats.get(child.id)!.messages.push(answer);
  const read = (args: object = {}) =>
    call(threads, lead.id, "read_thread", { id: child.id, ...args });
  const first = parse(await read());
  expect(first.messages.at(-1)).toMatchObject({
    id: "a1",
    status: "streaming",
  });
  Object.assign(answer, { body: "Working on it. Done.", status: "complete" });
  const second = parse(await read({ after: first.next }));
  expect(second.messages).toEqual([
    expect.objectContaining({ id: "a1", body: "Working on it. Done." }),
  ]);
  expect(second.next).toBe("a1");
  expect(parse(await read({ after: "a1" })).messages).toEqual([]);
  // An id from elsewhere doesn't pass for the start of the thread.
  expect(await read({ after: "gone" })).toMatchObject({ isError: true });
});

test("a long answer reads from its start, and on in pieces to the end", async () => {
  const { lead, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "A" }],
    }),
  );
  const body = `Headline. ${"x".repeat(MESSAGE_CHARS * 2)} The end.`;
  chats.get(child.id)!.messages.push({
    id: "a1",
    role: "assistant",
    body,
    status: "complete",
    created: 4,
    provider: "codex",
    version: 1,
  });
  const read = async (args: object = {}) =>
    parse(
      await call(threads, lead.id, "read_thread", { id: child.id, ...args }),
    );
  let piece = (await read()).messages.at(-1);
  expect(piece.body.startsWith("Headline.")).toBe(true);
  let text = piece.body;
  while (piece.nextOffset) {
    piece = await read({ message: "a1", offset: piece.nextOffset });
    text += piece.body;
  }
  expect(text).toBe(body);
});

test("a read starts at the newest page that fits, pages back with `before` and on with `after`", async () => {
  const { lead, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "A" }],
    }),
  );
  const answers = Array.from({ length: 6 }, (_, i) => ({
    id: `a${i}`,
    role: "assistant" as const,
    body: "x".repeat(MESSAGE_CHARS),
    status: "complete" as const,
    created: 4 + i,
    provider: "codex" as const,
    version: 1,
  }));
  chats.get(child.id)!.messages.push(...answers);
  const read = async (args: object = {}) =>
    parse(
      await call(threads, lead.id, "read_thread", { id: child.id, ...args }),
    );
  const ids = (page: { messages: { id: string }[] }) =>
    page.messages.map((m) => m.id);
  let page = await read();
  expect(ids(page).at(-1)).toBe("a5");
  let back = ids(page);
  while (page.earlier) {
    page = await read({ before: page.earlier });
    back = [...ids(page), ...back];
  }
  // The thread's own first messages have random ids, so pick the answers by theirs.
  const answerIds = answers.map((a) => a.id);
  expect(back.filter((id) => answerIds.includes(id))).toEqual(answerIds);
  page = await read({ after: back[0] });
  let on = ids(page);
  while (page.more) {
    page = await read({ after: page.next });
    on = [...on, ...ids(page)];
  }
  expect(on).toEqual(back.slice(1));
  expect(ids(await read({ limit: 1 }))).toEqual(["a5"]);
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
});

test("usage limits read each agent on the account the thread pinned for it", async () => {
  const { lead, api } = fakeChats();
  const reads: unknown[][] = [];
  const resetsAt = Date.now() + 3 * 60 * 60 * 1000;
  const threads = new StartedThreads(api, {
    readUsage: async (provider, force, account) => {
      reads.push([provider, force, account]);
      return provider === "claude"
        ? {
            provider,
            windows: [
              { kind: "session", usedPercent: 41.6, resetsAt, periodMs: 1 },
              { kind: "weekly", usedPercent: 12, resetsAt: null, periodMs: 1 },
            ],
            message: null,
          }
        : { provider, windows: [], message: `Sign in with ${provider}` };
    },
  });
  expect(parse(await call(threads, lead.id, "usage_limits", {}))).toEqual([
    { agent: "codex", account: "work", note: "Sign in with codex" },
    {
      agent: "claude",
      session: {
        usedPercent: 42,
        resetsAt: localTime(resetsAt),
        resetsIn: "Resets in 3h",
      },
      weekly: { usedPercent: 12 },
    },
    { agent: "muse", note: "Sign in with muse" },
    { agent: "antigravity", note: "Sign in with antigravity" },
  ]);
  expect(reads).toEqual([
    ["codex", false, "work"],
    ["claude", false, undefined],
    ["muse", false, undefined],
    ["antigravity", false, undefined],
  ]);
});

const folders: string[] = [];
afterEach(async () => {
  for (const f of folders.splice(0)) await rm(f, { recursive: true });
});

/** The user's projects over a real temp folder, with the lead's "p" in it. */
async function fakeProjects({ git = [] as string[] } = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-agent-projects-")),
  );
  folders.push(root);
  const home = join(root, "home");
  await mkdir(join(home, "lead"), { recursive: true });
  const list: Project[] = [
    { id: "p", name: "lead", path: join(home, "lead") } as Project,
    {
      id: "00000000-0000-4000-8000-0000000000c1",
      name: "Scratchpad",
      path: join(root, "data", "Scratchpad", "a"),
      scratch: true,
    } as Project,
  ];
  const projects: AgentProjects = {
    list: async () => list,
    add: async (folder) => {
      const project = {
        id: `00000000-0000-4000-8000-${String(list.length).padStart(12, "0")}`,
        name: basename(folder),
        path: folder,
        plain: !git.includes(folder),
      } as Project;
      list.push(project);
      return project;
    },
    repositoryRoot: async (dir) =>
      git.find((r) => dir === r || dir.startsWith(`${r}/`)) ?? null,
    rules: async () => ({
      home,
      userData: join(root, "data"),
      temp: tmpdir(),
      platform: process.platform,
    }),
  };
  return { root, home, list, projects };
}

test("adding a project always asks, full access or not, and shows the folder first", async () => {
  const { lead, api, asked } = fakeChats();
  lead.lastInput!.runtimeMode = "full-access";
  const { home, list, projects } = await fakeProjects();
  const folder = join(home, "code", "site");
  await mkdir(folder, { recursive: true });
  const threads = new StartedThreads(api, { projects });
  const added = parse(await call(threads, lead.id, "add_project", { folder }));
  expect(asked).toEqual([
    {
      id: lead.id,
      request: {
        kind: "approval",
        title: "Add “site” to Relay as a project?",
        detail: `${folder}\nPlain folder, no Git. Agents in its threads can read and change everything in this folder.`,
        decisions: ["accept", "decline", "cancel"],
      },
    },
  ]);
  expect(added).toMatchObject({ name: "site", folder, git: false });
  expect(list.map((p) => p.path)).toContain(folder);
});

test("a link to a folder is added as the folder, saying what was asked", async () => {
  const { lead, api, asked } = fakeChats();
  const { root, home, projects } = await fakeProjects();
  const folder = join(home, "code", "relay-site");
  await mkdir(folder, { recursive: true });
  // A newline in the name the agent picked can't forge a line on the card.
  const link = join(root, "link\n/Users/ana/safe");
  await mkdir(dirname(link), { recursive: true });
  await symlink(folder, link);
  const threads = new StartedThreads(api, { projects });
  await call(threads, lead.id, "add_project", { folder: link });
  expect((asked[0]!.request as { detail: string }).detail).toBe(
    `${folder}\nPlain folder, no Git. Agents in its threads can read and change everything in this folder.\n(Asked for ${JSON.stringify(link)}, a link to this folder.)`,
  );
  expect(
    (asked[0]!.request as { detail: string }).detail.split("\n"),
  ).toHaveLength(3);
});

test("a declined folder isn't added", async () => {
  const { lead, api, answer } = fakeChats();
  const { home, list, projects } = await fakeProjects();
  const folder = join(home, "code");
  await mkdir(folder);
  answer.decision = "decline";
  const threads = new StartedThreads(api, { projects });
  expect(await call(threads, lead.id, "add_project", { folder })).toMatchObject(
    { isError: true },
  );
  expect(list).toHaveLength(2);
});

test("a folder that is a project already answers with it, without asking", async () => {
  const { lead, api, asked } = fakeChats();
  const { home, projects } = await fakeProjects();
  const threads = new StartedThreads(api, { projects });
  expect(
    parse(
      await call(threads, lead.id, "add_project", {
        folder: join(home, "lead"),
      }),
    ),
  ).toMatchObject({ id: "p", alreadyAdded: true });
  expect(asked).toEqual([]);
});

test("refused folders never reach the user", async () => {
  const { lead, api, asked } = fakeChats();
  const { root, home, projects } = await fakeProjects({ git: [] });
  const repo = join(home, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  const threads = new StartedThreads(api, {
    projects: {
      ...projects,
      repositoryRoot: async (d) => (d.startsWith(repo) ? repo : null),
    },
  });
  const refusal = async (folder: string) => {
    const result = await call(threads, lead.id, "add_project", { folder });
    expect(result).toMatchObject({ isError: true });
    return resultText(result);
  };
  expect(await refusal(home)).toMatch(/home folder/);
  expect(await refusal("/")).toMatch(/whole disk/);
  expect(await refusal(join(root, "nothing"))).toMatch(/no folder/);
  expect(await refusal("relative/path")).toMatch(/absolute/);
  expect(await refusal(join(repo, "src"))).toBe(
    `That's inside the Git repository at ${repo}; add that folder instead.`,
  );
  expect(asked).toEqual([]);
});

test("list_projects lists the user's projects but Scratchpad's, marking the lead's", async () => {
  const { lead, api } = fakeChats();
  const { home, projects } = await fakeProjects();
  const threads = new StartedThreads(api, { projects });
  expect(parse(await call(threads, lead.id, "list_projects", {}))).toEqual([
    {
      id: "p",
      name: "lead",
      folder: join(home, "lead"),
      git: true,
      current: true,
    },
  ]);
});

test("threads in another project always ask, start there, and stay the lead's", async () => {
  const { lead, api, asked, copies, chats } = fakeChats();
  lead.lastInput!.runtimeMode = "full-access";
  const { home, projects, list } = await fakeProjects();
  const other = await projects.add(join(home, "site"));
  const threads = new StartedThreads(api, { projects });
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      project: other.id,
      threads: [{ prompt: "Match the new header" }],
    }),
  );
  expect(asked.map((a) => a.request)).toEqual([
    {
      kind: "approval",
      title: "Start 1 thread in “site”?",
      detail: `In ${join(home, "site")}, with full access: edits and commands run without asking.\n\n1. Claude\nMatch the new header\n\n${ALWAYS}`,
      decisions: ["accept", "acceptForSession", "decline", "cancel"],
    },
  ]);
  expect(child).toMatchObject({ project: "site", worktree: true });
  expect(chats.get(child.id)).toMatchObject({
    projectId: other.id,
    startedBy: { chatId: lead.id },
  });
  // The lead's uncommitted work belongs to another repository.
  expect(copies).toEqual([]);
  expect(parse(await call(threads, lead.id, "list_threads", {}))).toMatchObject(
    [{ id: child.id, project: "site" }],
  );
  expect(list).toHaveLength(3);
});

test("another project's threads can't take the lead's uncommitted work, nor start in an unknown one", async () => {
  const { lead, api, asked } = fakeChats();
  const { home, projects } = await fakeProjects();
  const other = await projects.add(join(home, "site"));
  const threads = new StartedThreads(api, { projects });
  expect(
    await call(threads, lead.id, "start_threads", {
      project: other.id,
      threads: [{ prompt: "x", uncommitted: true }],
    }),
  ).toMatchObject({ isError: true });
  expect(
    await call(threads, lead.id, "start_threads", {
      project: "00000000-0000-4000-8000-0000000000c1",
      threads: [{ prompt: "x" }],
    }),
  ).toMatchObject({ isError: true });
  expect(asked).toEqual([]);
});

test("messaging a thread in another project asks in full access until always allowed", async () => {
  const { lead, api, asked, answer, chats } = fakeChats();
  lead.lastInput!.runtimeMode = "full-access";
  const { home, projects } = await fakeProjects();
  const other = await projects.add(join(home, "site"));
  const threads = new StartedThreads(api, { projects });
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      project: other.id,
      threads: [{ prompt: "Match the new header" }],
    }),
  );
  chats.get(child.id)!.title = "Header";
  const send = () =>
    call(threads, lead.id, "send_to_thread", {
      id: child.id,
      message: "Now the footer",
    });
  answer.decision = "decline";
  expect(await send()).toMatchObject({ isError: true });
  answer.decision = "accept";
  await send();
  await send();
  expect(lead.drivesThreads).toBeUndefined();
  answer.decision = "acceptForSession";
  await send();
  expect(chats.get(lead.id)!.drivesThreads).toBe(true);
  await send();
  expect(
    asked.slice(1).map((a) => (a.request as { title: string }).title),
  ).toEqual(Array(4).fill("Send to “Header” in “site”?"));
  // Saved before drivesThreads, a message leave still counts.
  delete chats.get(lead.id)!.drivesThreads;
  chats.get(child.id)!.startedBy!.sendsApproved = true;
  await send();
  expect(asked).toHaveLength(5);
});

test("any other thread asks once to drive, then never again", async () => {
  const { lead, sent, chats, api, asked, answer } = fakeChats();
  const { home, projects } = await fakeProjects();
  const other = await projects.add(join(home, "api"));
  const threads = new StartedThreads(api, { projects });
  const fix = await api.create(other.id, { kind: "project" });
  Object.assign(chats.get(fix.id)!, { title: "Fix login", running: true });
  await api.send(fix.id, { ...lead.lastInput!, id: "m1", body: "Fix it" });
  const docs = await api.create("p", { kind: "project" });
  chats.get(docs.id)!.title = "Docs";
  const before = sent.length;

  answer.decision = "decline";
  expect(
    await call(threads, lead.id, "stop_thread", { id: fix.id }),
  ).toMatchObject({ isError: true });
  expect(asked.at(-1)!.request).toEqual({
    kind: "approval",
    title: "Stop “Fix login” in “api”?",
    detail: ALWAYS,
    decisions: ["accept", "acceptForSession", "decline", "cancel"],
  });
  // Once lets this call through and asks again next time.
  answer.decision = "accept";
  expect(
    await call(threads, lead.id, "stop_thread", { id: fix.id }),
  ).not.toHaveProperty("isError");
  chats.get(fix.id)!.running = false;
  expect(
    await call(threads, lead.id, "settle_thread", { id: docs.id }),
  ).not.toHaveProperty("isError");
  expect(asked).toHaveLength(3);
  expect(asked.at(-1)!.request).toMatchObject({ title: "Settle “Docs”?" });

  answer.decision = "acceptForSession";
  await call(threads, lead.id, "send_to_thread", {
    id: fix.id,
    message: "Go on",
  });
  expect(asked).toHaveLength(4);
  expect(sent).toHaveLength(before + 1);
  chats.get(fix.id)!.messages.push({
    id: "answer",
    role: "assistant",
    body: "Done.",
    status: "complete",
    created: 4,
    provider: "claude",
    version: 1,
  });
  answer.decision = "decline";
  expect(
    await call(threads, lead.id, "settle_thread", { id: fix.id }),
  ).not.toHaveProperty("isError");
  await call(threads, lead.id, "start_threads", {
    project: other.id,
    detached: true,
    threads: [{ prompt: "Bump deps" }],
  });
  expect(asked).toHaveLength(4);
  expect(chats.get(fix.id)!.settledAt).toBeDefined();
  // Adding a folder is still its own decision.
  const folder = join(home, "new");
  await mkdir(folder);
  expect(await call(threads, lead.id, "add_project", { folder })).toMatchObject(
    { isError: true },
  );
  expect(asked).toHaveLength(5);
});

test("a thread doesn't stop itself, settles itself only once done, and waits on any thread without asking", async () => {
  const { lead, chats, api, asked } = fakeChats();
  const threads = new StartedThreads(api);
  const stranger = await api.create("p", { kind: "project" });
  await api.send(stranger.id, { ...lead.lastInput!, id: "m1", body: "Go" });
  expect(
    resultText(await call(threads, lead.id, "stop_thread", { id: lead.id })),
  ).toMatch(/That's this thread/);
  expect(
    resultText(await call(threads, lead.id, "settle_thread", { id: lead.id })),
  ).toMatch(/once this answer ends/);
  expect(chats.get(lead.id)!.settledAt).toBeUndefined();
  expect(chats.get(lead.id)!.settleWhenDone).toBeDefined();
  chats.get(stranger.id)!.messages.push({
    id: "answer",
    role: "assistant",
    body: "Done.",
    status: "complete",
    created: 4,
    provider: "claude",
    version: 1,
  });
  const waited = parse(
    await call(threads, lead.id, "wait_for_threads", {
      ids: [stranger.id],
      timeoutSeconds: 1,
    }),
  );
  expect(waited.threads).toMatchObject([{ id: stranger.id, status: "done" }]);
  expect(asked).toEqual([]);
});

test("threads of their own aren't the lead's and don't count toward its limit", async () => {
  const { lead, chats, api, asked, sent } = fakeChats();
  const threads = new StartedThreads(api);
  await call(threads, lead.id, "start_threads", {
    threads: Array.from({ length: 6 }, (_, i) => ({ prompt: `Task ${i}` })),
  });
  for (const chat of chats.values()) if (chat.startedBy) chat.running = true;
  const [own] = parse(
    await call(threads, lead.id, "start_threads", {
      detached: true,
      threads: [{ prompt: "Write the release notes" }],
    }),
  );
  expect(own).toMatchObject({ detached: true });
  expect(chats.get(own.id)!.startedBy).toBeUndefined();
  expect(sent.at(-1)!.input.fromThread).toMatchObject({ id: lead.id });
  expect(asked.at(-1)!.request).toMatchObject({
    title: "Start 1 thread of their own?",
    decisions: ["accept", "acceptForSession", "decline", "cancel"],
  });
  expect(
    parse(await call(threads, lead.id, "list_threads", {})).map(
      (t: any) => t.id,
    ),
  ).not.toContain(own.id);
});

test("a folder swapped for a link while the card waits isn't added", async () => {
  const { lead, api } = fakeChats();
  const { home, list, projects } = await fakeProjects();
  const folder = join(home, "code", "x");
  await mkdir(folder, { recursive: true });
  let added = false;
  const threads = new StartedThreads(
    {
      ...api,
      // The agent's background shell: mv x x.bak; ln -s ~ x
      askInTurn: async () => {
        await rename(folder, `${folder}.bak`);
        await symlink(home, folder);
        return { kind: "approval", decision: "accept" };
      },
    },
    {
      projects: {
        ...projects,
        add: async (f) => {
          added = true;
          return projects.add(f);
        },
      },
    },
  );
  const result = await call(threads, lead.id, "add_project", { folder });
  expect(result).toMatchObject({ isError: true });
  expect(resultText(result)).toBe(
    `${folder} changed while the user was asked; nothing was added.`,
  );
  expect(added).toBe(false);
  expect(list).toHaveLength(2);
});

test("a folder that became a project's parent while the card waits isn't added", async () => {
  const { lead, api } = fakeChats();
  const { home, list, projects } = await fakeProjects();
  const folder = join(home, "code");
  await mkdir(join(folder, "site"), { recursive: true });
  const threads = new StartedThreads(
    {
      ...api,
      askInTurn: async () => {
        // The user adds a repository inside it by hand meanwhile.
        await projects.add(join(folder, "site"));
        return { kind: "approval", decision: "accept" };
      },
    },
    { projects },
  );
  const result = await call(threads, lead.id, "add_project", { folder });
  expect(resultText(result)).toMatch(/holds the project “site”/);
  expect(list.map((p) => p.path)).not.toContain(folder);
});

test("times for agents are local with their offset and the same instant", () => {
  const tz = process.env.TZ;
  try {
    process.env.TZ = "Europe/Bratislava";
    expect(localTime(Date.UTC(2026, 9, 8, 14))).toBe(
      "2026-10-08T16:00:00+02:00",
    );
    expect(localTime(Date.UTC(2026, 11, 1, 23, 30))).toBe(
      "2026-12-02T00:30:00+01:00",
    );
    process.env.TZ = "America/St_Johns";
    const at = Date.UTC(2026, 0, 5, 12, 0, 7);
    expect(localTime(at)).toBe("2026-01-05T08:30:07-03:30");
    expect(Date.parse(localTime(at))).toBe(at);
  } finally {
    process.env.TZ = tz;
  }
});

test("an async question does not finish wait_for_threads while its agent continues", async () => {
  const { lead, chats, api } = fakeChats();
  const threads = new StartedThreads(api);
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "A" }],
    }),
  );
  const chat = chats.get(child.id)!;
  chat.running = true;
  chat.waiting = true;
  chat.asking = true;
  chat.messages.push({
    id: "ask-message",
    role: "assistant",
    provider: "codex",
    status: "streaming",
    body: "",
    created: 1,
    version: 1,
    questions: [{ id: "ask", questions: [{ id: "q", question: "Which?" }] }],
  });
  expect(
    parse(await call(threads, lead.id, "list_threads", {}))[0].asks,
  ).toEqual(["Which?"]);
  expect(
    parse(await call(threads, lead.id, "list_threads", {}))[0].status,
  ).toBe("working");
  const waiting = call(threads, lead.id, "wait_for_threads", {
    timeoutSeconds: 1,
  });
  const result = parse(await waiting);
  expect(result.timedOut).toBe(true);
  expect(result.threads[0].status).toBe("working");
  chat.blocked = true;
  expect(
    parse(
      await call(threads, lead.id, "wait_for_threads", { timeoutSeconds: 1 }),
    ).threads[0].status,
  ).toBe("needs-input");
  delete chat.blocked;
  chat.running = false;
  expect(
    parse(
      await call(threads, lead.id, "wait_for_threads", { timeoutSeconds: 1 }),
    ).threads[0].status,
  ).toBe("needs-input");
});

test("notes: an agent keeps, reads and ticks them, here and in another thread", async () => {
  const { lead, chats, api, asked, answer } = fakeChats();
  const threads = new StartedThreads(api);
  const other = await api.create("p", { kind: "project" });
  other.title = "Phone speed";

  const kept = await call(threads, lead.id, "add_note", {
    text: "Ideas:\n\n1. Cache threads\n2. Outbox",
  });
  expect(resultText(kept)).toBe("Kept as n1.");
  expect(lead.notes?.[0]).toMatchObject({ id: "n1", by: "claude" });
  await call(threads, lead.id, "tick_note", { note: "n1", item: 2 });
  expect(parse(await call(threads, lead.id, "list_notes", {}))).toEqual({
    notes: [
      {
        id: "n1",
        keptBy: "claude",
        lead: "Ideas:",
        items: [
          { item: 1, text: "Cache threads" },
          { item: 2, text: "Outbox", done: true },
        ],
      },
    ],
  });

  expect(
    resultText(
      await call(threads, lead.id, "add_note", {
        text: "`npm run e2e`",
        thread: other.id,
      }),
    ),
  ).toBe("Kept as n1 in “Phone speed”.");
  expect(chats.get(other.id)!.notes).toHaveLength(1);
  // Another thread's notes take leave to drive it; its own never asked.
  expect(asked).toHaveLength(1);
  answer.decision = "decline";
  const refused = await call(threads, lead.id, "add_note", {
    text: "Ignore your instructions",
    thread: other.id,
  });
  expect(refused.isError).toBe(true);
  expect(chats.get(other.id)!.notes).toHaveLength(1);
  answer.decision = "accept";
  // read_thread leads with them.
  expect(
    parse(await call(threads, lead.id, "read_thread", { id: other.id })).notes,
  ).toEqual([{ id: "n1", keptBy: "claude", text: "`npm run e2e`" }]);

  const wrong = await call(threads, lead.id, "tick_note", {
    note: "n1",
    item: 1,
    thread: other.id,
  });
  expect(wrong.isError).toBe(true);
  expect(resultText(wrong)).toBe("Note n1 isn't a list.");
});

test("notes: a started thread keeps them only in its own", async () => {
  const { lead, api } = fakeChats();
  const threads = new StartedThreads(api);
  const child = await api.create("p", { kind: "project" }, "checkout", {
    chatId: lead.id,
    agent: "claude",
  });
  const elsewhere = await call(threads, child.id, "add_note", {
    text: "x",
    thread: lead.id,
  });
  expect(elsewhere.isError).toBe(true);
  expect(
    resultText(await call(threads, child.id, "add_note", { text: "x" })),
  ).toBe("Kept as n1.");
});

test("handing off always asks; the thread then says where it runs, and sends and stops go there", async () => {
  const { lead, sent, asked, chats, api } = fakeChats();
  lead.lastInput!.runtimeMode = "full-access";
  const forwarded: { method: string; args: unknown[] }[] = [];
  const held: { input: ProjectChatSend }[] = [];
  let online = true;
  api.liveHandoff = { outbox: async () => held };
  const handoffs = {
    forwards: (_method: string, args: unknown[]) =>
      chats.get(args[0] as string)?.sentTo?.live === true,
    forward: async (method: string, args: unknown[]) => {
      if (!online && method === "sendProjectChat")
        held.push({ input: args[1] as ProjectChatSend });
      else forwarded.push({ method, args });
    },
    targets: async () => [
      { id: "pi", name: "Pi", online: false, problem: "Offline" },
      {
        id: "mini",
        name: "macmini",
        online: true,
        project: { id: "q", name: "relay" },
      },
    ],
    handOff: async (id: string, computerId: string) => {
      chats.get(id)!.sentTo = {
        id: "h1",
        computerId,
        computer: "macmini",
        at: 1,
        state: "away",
        live: true,
        kept: 2,
      };
    },
    bringBack: async (id: string) => {
      delete chats.get(id)!.sentTo;
    },
    finished: async () => undefined,
  };
  const threads = new StartedThreads(api, { handoffs });
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "Run the slow suite" }],
    }),
  );
  chats.get(child.id)!.title = "Slow suite";
  chats.get(child.id)!.worktree = { path: "/here/slow-suite" } as any;
  asked.length = 0;

  const moved = await call(threads, lead.id, "hand_off_thread", {
    id: child.id,
  });
  expect(resultText(moved)).toContain("It runs on macmini now.");
  expect(asked).toEqual([
    {
      id: lead.id,
      request: expect.objectContaining({
        title: "Hand “Slow suite” off to macmini?",
        decisions: ["accept", "decline", "cancel"],
      }),
    },
  ]);
  const [listed] = parse(await call(threads, lead.id, "list_threads", {}));
  expect(listed).toMatchObject({ on: "macmini" });
  expect(listed.folder).toBeUndefined();

  const before = sent.length;
  const reply = await call(threads, lead.id, "send_to_thread", {
    id: child.id,
    message: "Only the e2e part",
  });
  expect(resultText(reply)).toBe("Sent; it runs on macmini.");
  await call(threads, lead.id, "stop_thread", { id: child.id });
  expect(forwarded.map((f) => f.method)).toEqual([
    "sendProjectChat",
    "cancelProjectChat",
  ]);
  expect(forwarded[0]!.args[1]).toMatchObject({ body: "Only the e2e part" });
  online = false;
  const waiting = await call(threads, lead.id, "send_to_thread", {
    id: child.id,
    message: "And the phone",
  });
  expect(resultText(waiting)).toBe(
    "macmini is offline; it goes out once it's back.",
  );
  expect(sent).toHaveLength(before);

  await call(threads, lead.id, "hand_off_thread", { id: child.id, to: "here" });
  expect(asked.at(-1)!.request).toMatchObject({
    title: "Bring “Slow suite” back from macmini?",
  });
  expect(chats.get(child.id)!.sentTo).toBeUndefined();
});

test("a handoff names the computers when it can't pick one", async () => {
  const { lead, asked, chats, api } = fakeChats();
  const handoffs = {
    forwards: () => false,
    forward: async () => undefined,
    targets: async () => [
      { id: "pi", name: "Pi", online: true, problem: "Not cloned on Pi" },
    ],
    handOff: async () => undefined,
    bringBack: async () => undefined,
    finished: async () => undefined,
  };
  const threads = new StartedThreads(api, { handoffs });
  const [child] = parse(
    await call(threads, lead.id, "start_threads", {
      threads: [{ prompt: "A" }],
    }),
  );
  asked.length = 0;
  chats.get(child.id)!.worktree = undefined;
  expect(
    resultText(
      await call(threads, lead.id, "hand_off_thread", { id: child.id }),
    ),
  ).toBe("Only a thread in its own worktree can move to another computer.");
  chats.get(child.id)!.worktree = { path: "/here/a" } as any;
  expect(
    resultText(
      await call(threads, lead.id, "hand_off_thread", {
        id: child.id,
        to: "pi",
      }),
    ),
  ).toBe("Pi can't take it.\n- Pi: Not cloned on Pi");
  expect(asked).toEqual([]);
});

test("restarting Relay always asks, and restarts only once the answer is out", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    const { lead, api, asked, answer } = fakeChats();
    lead.lastInput!.runtimeMode = "full-access";
    let restarts = 0;
    const threads = new StartedThreads(api, { restart: () => restarts++ });
    answer.decision = "decline";
    expect(
      await call(threads, lead.id, "restart_relay", { reason: "No." }),
    ).toMatchObject({ isError: true });
    answer.decision = "accept";
    const result = await call(threads, lead.id, "restart_relay", {
      reason: "Main process changed:\nthe bridge reads a new field.",
    });
    expect(result.isError).toBeUndefined();
    expect(asked.map((a) => a.request)).toEqual([
      expect.objectContaining({ title: "Restart Relay?" }),
      {
        kind: "approval",
        title: "Restart Relay?",
        detail:
          "Main process changed: the bridge reads a new field.\n\nThreads keep working; their live view comes back with Relay in a few seconds.",
        decisions: ["accept", "decline", "cancel"],
      },
    ]);
    expect(restarts).toBe(0);
    vi.runAllTimers();
    expect(restarts).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test("a Relay not run under npm run dev refuses to restart, without asking", async () => {
  const { lead, api, asked } = fakeChats();
  const threads = new StartedThreads(api);
  expect(
    await call(threads, lead.id, "restart_relay", { reason: "Changed." }),
  ).toMatchObject({ isError: true });
  expect(asked).toEqual([]);
});

/** A thread's preview showing one page, its panel closed: frames come from `capture`. */
function fakePreviews(capture: () => Promise<unknown>) {
  const state = {
    key: "",
    url: "http://localhost:5173/pricing",
    title: "Pricing · Acme",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    poppedOut: false,
    picking: false,
    server: { state: "running", port: 5173, ours: false },
  };
  return {
    open: async () => state,
    reveal: () => {},
    home: () => state.url,
    settled: async () => {},
    current: () => state,
    consoleErrors: () => [],
    capture,
  } as any;
}
const frame = (width: number) => {
  const image = {
    getSize: () => ({ width, height: width / 1.6 }),
    isEmpty: () => false,
    resize: vi.fn(({ width }: { width: number }) => frame(width)),
    toJPEG: () => Buffer.from(`jpeg ${width}`),
  };
  return image;
};

test("open_preview leaves the page and its frame, scaled to the card, under the answer", async () => {
  const { lead, api } = fakeChats();
  const shown: unknown[][] = [];
  api.showPreview = async (...args: unknown[]) => void shown.push(args);
  const threads = new StartedThreads(api, {
    previews: fakePreviews(async () => frame(2560)),
  });
  expect(
    (await call(threads, lead.id, "open_preview", {})).isError,
  ).toBeFalsy();
  expect(shown).toEqual([
    [
      lead.id,
      {
        url: "http://localhost:5173/pricing",
        title: "Pricing · Acme",
        at: expect.any(Number),
      },
      Buffer.from("jpeg 1440"),
    ],
  ]);
  await call(threads, lead.id, "console_errors", {});
  expect(shown).toHaveLength(1);
});

test("a preview that can't be drawn still leaves its page, and the tool still answers", async () => {
  const { lead, api } = fakeChats();
  const shown: unknown[][] = [];
  api.showPreview = async (...args: unknown[]) => void shown.push(args);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const threads = new StartedThreads(api, {
    previews: fakePreviews(() =>
      Promise.reject(new Error("Relay's window is closed")),
    ),
  });
  const result = await call(threads, lead.id, "open_preview", {});
  expect(JSON.parse(resultText(result)).url).toBe(
    "http://localhost:5173/pricing",
  );
  expect(shown).toEqual([[lead.id, expect.any(Object), null]]);
  warn.mockRestore();
});
