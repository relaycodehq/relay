import { expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  claudePending,
  listClaudeModels,
  runClaudeProject,
  stopClaudeTask,
  wakeupTime,
} from "../../electron/rooms/claude-project";
import type { AgentActivity, ContextUsage } from "../../shared/projects";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("../../electron/executables", () => ({
  findExecutable: async (name: string) => `/usr/bin/${name}`,
}));

const session_id = "session";
const answer = (text: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  session_id,
  message: { id: "msg", content: [{ type: "text", text }], usage: {} },
});
const result = (text: string, origin?: { kind: string }) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
  session_id,
  ...(origin ? { origin } : {}),
});
const lifecycle = (command_uuid: string, state: string) => ({
  type: "command_lifecycle",
  command_uuid,
  state,
  session_id,
});

/** Claude as the CLI answers one prompt, given the frames it writes for it. */
function claude(frames: (prompt: string) => object[]) {
  vi.mocked(query).mockImplementation(({ prompt }) => {
    const input = (prompt as AsyncIterable<{ uuid: string }>)[
      Symbol.asyncIterator
    ]();
    return Object.assign(
      (async function* () {
        const sent = await input.next();
        yield* frames(sent.value.uuid);
        await new Promise(() => {});
      })(),
      {
        close() {},
        // As the CLI reports it for its default model.
        getContextUsage: async () => ({ rawMaxTokens: 1_000_000 }),
      },
    ) as unknown as ReturnType<typeof query>;
  });
}

const run = () =>
  runClaudeProject({
    cwd: "/project",
    prompt: "Reply with just the word banana.",
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    session: { key: crypto.randomUUID(), id: session_id, async onId() {} },
  });

it("skips the result a resumed session reports for a leftover background command", async () => {
  // Frame order the CLI wrote when resumed with a stopped `sleep` still on record.
  claude((uuid) => [
    { type: "system", subtype: "task_notification", status: "stopped" },
    { type: "system", subtype: "init", session_id },
    result("", { kind: "task-notification" }),
    lifecycle(uuid, "queued"),
    lifecycle(uuid, "started"),
    answer("banana"),
    result("banana"),
  ]);
  await expect(run()).resolves.toBe("banana");
});

it("skips any result that lands while the prompt is still queued", async () => {
  claude((uuid) => [
    lifecycle(uuid, "queued"),
    answer("A background task finished."),
    result("A background task finished."),
    lifecycle(uuid, "started"),
    answer("banana"),
    result("banana"),
  ]);
  await expect(run()).resolves.toBe("banana");
});

it("measures a fresh session's context against the window Claude reports", async () => {
  claude((uuid) => [
    lifecycle(uuid, "started"),
    {
      ...answer("banana"),
      message: {
        id: "msg",
        content: [{ type: "text", text: "banana" }],
        usage: { input_tokens: 150_000 },
      },
    },
    result("banana"),
  ]);
  const seen: ContextUsage[] = [];
  await runClaudeProject({
    cwd: "/project",
    prompt: "Reply with just the word banana.",
    choice: {} as never,
    // The default model, Opus, has a 1M window without a `[1m]` suffix.
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    onContext: (usage) => seen.push(usage),
    session: { key: crypto.randomUUID(), id: session_id, async onId() {} },
  });
  expect(seen).toEqual([{ usedTokens: 150_000, maxTokens: 1_000_000 }]);
});

it("still reports an empty answer to the prompt itself", async () => {
  claude((uuid) => [
    lifecycle(uuid, "queued"),
    lifecycle(uuid, "started"),
    result(""),
  ]);
  await expect(run()).rejects.toThrow("Claude returned an empty answer.");
});

it("lists the background work and wake-ups Claude leaves running", async () => {
  const stopTask = vi.fn(async () => {});
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  let options!: NonNullable<Parameters<typeof query>[0]["options"]>;
  const tasks = (...list: object[]) => ({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: list,
    session_id,
  });
  vi.mocked(query).mockImplementation((params) => {
    options = params.options!;
    const input = (params.prompt as AsyncIterable<{ uuid: string }>)[
      Symbol.asyncIterator
    ]();
    return Object.assign(
      (async function* () {
        const sent = await input.next();
        yield lifecycle(sent.value.uuid, "started");
        yield tasks(
          { task_id: "ab", task_type: "local_bash", description: "Run A/B" },
          {
            task_id: "watch",
            task_type: "monitor",
            description: "Watch logs",
            ambient: true,
          },
        );
        await options.hooks!.Stop![0].hooks[0](
          {
            hook_event_name: "Stop",
            session_crons: [
              {
                id: "later",
                schedule: "30 19 23 9 *",
                recurring: false,
                prompt: "Compare the runs",
              },
            ],
          } as never,
          undefined,
          { signal: new AbortController().signal },
        );
        yield answer("Running it.");
        yield result("Running it.");
        await finished;
        // The command ended; Claude's next turn starts from here.
        yield tasks();
        await new Promise(() => {});
      })(),
      { close() {}, stopTask, getContextUsage: async () => ({}) },
    ) as unknown as ReturnType<typeof query>;
  });
  const key = crypto.randomUUID();
  await runClaudeProject({
    cwd: "/project",
    prompt: "Run the A/B.",
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    session: { key, id: session_id, async onId() {} },
  });
  expect(claudePending(key)).toEqual([
    {
      kind: "task",
      id: "ab",
      description: "Run A/B",
      since: expect.any(Number),
    },
    {
      kind: "wakeup",
      id: "later",
      prompt: "Compare the runs",
      recurring: false,
      at: wakeupTime("30 19 23 9 *"),
    },
  ]);
  await stopClaudeTask(key, "ab");
  expect(stopTask).toHaveBeenCalledWith("ab");
  await expect(stopClaudeTask(key, "later")).rejects.toThrow(
    "That work has already finished.",
  );
  finish();
  await vi.waitFor(() =>
    expect(claudePending(key).map((p) => p.id)).toEqual(["later"]),
  );
});

it("reads a one-shot wake-up's fire time from its cron", () => {
  const now = new Date(2026, 8, 23, 19, 11).getTime();
  expect(wakeupTime("30 19 23 9 *", now)).toBe(
    new Date(2026, 8, 23, 19, 30).getTime(),
  );
  // Early January, scheduled in late December: next year.
  expect(wakeupTime("5 0 2 1 *", new Date(2026, 11, 31).getTime())).toBe(
    new Date(2027, 0, 2, 0, 5).getTime(),
  );
  expect(wakeupTime("*/5 * * * *", now)).toBeUndefined();
});

it("nests a subagent's calls under its agent call and reports its progress", async () => {
  const call = (
    id: string,
    name: string,
    input: object,
    parent: string | null,
  ) => ({
    type: "assistant",
    parent_tool_use_id: parent,
    session_id,
    message: {
      id: `msg-${id}`,
      content: [{ type: "tool_use", id, name, input }],
      usage: {},
    },
  });
  const done = (id: string, text: string, parent: string | null) => ({
    type: "user",
    parent_tool_use_id: parent,
    session_id,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: text }],
    },
  });
  const progress = (summary?: string, uses = 1) => ({
    type: "system",
    subtype: "task_progress",
    task_id: "task",
    tool_use_id: "agent",
    description: "Explore auth",
    usage: { total_tokens: 10, tool_uses: uses, duration_ms: 5 },
    last_tool_name: "Read",
    ...(summary ? { summary } : {}),
    session_id,
  });
  claude((uuid) => [
    lifecycle(uuid, "started"),
    call("agent", "Agent", { description: "Explore auth" }, null),
    call("read", "Read", { file_path: "/project/auth.ts" }, "agent"),
    progress(),
    progress("Reading the auth module"),
    // Each later call reports again, without the summary.
    progress(undefined, 2),
    done("read", "export {}", "agent"),
    done("agent", "Auth lives in auth.ts.", null),
    progress("Too late"),
    answer("banana"),
    result("banana"),
  ]);
  const seen: AgentActivity[] = [];
  await runClaudeProject({
    cwd: "/project",
    prompt: "Where is auth?",
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    onActivity: (a) => seen.push({ ...a }),
    session: { key: crypto.randomUUID(), id: session_id, async onId() {} },
  });
  expect(seen.filter((a) => a.id === "read").map((a) => a.parentId)).toEqual([
    "agent",
    "agent",
  ]);
  const agent = seen.filter((a) => a.id === "agent");
  expect(agent.map((a) => [a.status, a.progress])).toEqual([
    ["running", undefined],
    ["running", "Using Read · 1 tool"],
    ["running", "Reading the auth module · 1 tool"],
    ["running", "Reading the auth module · 2 tools"],
    ["complete", undefined],
  ]);
  expect(agent.at(-1)).toMatchObject({ detail: "Auth lives in auth.ts." });
  expect(agent.every((a) => !a.parentId)).toBe(true);
});

it("asks Claude for its models again once the user signs in", async () => {
  // Signed out, the CLI still lists the models built into it.
  const cli = (tokenSource: string, models: string[]) =>
    vi.mocked(query).mockImplementation(
      () =>
        ({
          accountInfo: async () => ({ tokenSource, apiProvider: "firstParty" }),
          supportedModels: async () =>
            models.map((value) => ({ value, displayName: value })),
          close() {},
        }) as unknown as ReturnType<typeof query>,
    );
  cli("none", ["opus[1m]"]);
  await expect(listClaudeModels()).rejects.toThrow("Sign in to Claude");
  cli("claude.ai", ["opus", "claude-opus-5"]);
  expect((await listClaudeModels()).map((m) => m.id)).toEqual([
    "opus",
    "claude-opus-5",
  ]);
});
