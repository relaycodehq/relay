import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentOptions } from "../types";
import type { AcpProfile } from "./profiles";
import { outputTokens, runAcp } from "./run";
import { disposeAcp, acquireAcpAgent } from "./sessions";
import { readOnlyGitEnv } from "../read-only-git";
import { antigravitySubagents } from "../antigravity";
import { signInAcp } from "./sign-in";

const fixture = join(__dirname, "../../../tests/fixtures/acp-agent.cjs");

type Scenario = Record<string, unknown>;
type Sent = { id?: number; method?: string; params?: any; result?: any };

/** An Antigravity-like profile starting the fixture agent on `scenario`. */
async function agent(scenario: Scenario, profile: Partial<AcpProfile> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-acp-")));
  const log = join(root, "sent.jsonl");
  const acp: AcpProfile = {
    provider: "antigravity",
    name: "Antigravity",
    home: root,
    command: async () => ({
      command: process.execPath,
      args: [fixture],
      env: {
        RELAY_ACP_SCENARIO: JSON.stringify(scenario),
        RELAY_ACP_LOG: log,
      },
    }),
    wishes: ({ runtime }) => [
      { option: "mode", value: runtime === "full-access" ? "yolo" : "default" },
    ],
    install: "",
    ...profile,
  };
  profiles.push(acp);
  const sent = async (): Promise<Sent[]> =>
    (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { acp, root, sent };
}

const profiles: AcpProfile[] = [];

afterEach(() => {
  for (const profile of profiles.splice(0)) disposeAcp(profile);
  vi.unstubAllEnvs();
});

it("shows native fixed choices in full access, preserving duplicate labels and recording readable answers", async () => {
  const id = "interaction_choose";
  const { acp, root, sent } = await agent({
    turn: [
      {
        ask: {
          toolCall: {
            toolCallId: id,
            title: "Which environment?",
            kind: "other",
          },
          options: [
            { optionId: "dev", name: "Same label", kind: "allow_once" },
            { optionId: "prod", name: "Same label", kind: "allow_once" },
          ],
        },
      },
      say("Chosen."),
    ],
  });
  const onRequest = vi.fn(async () => ({
    kind: "question" as const,
    answers: { [id]: ["prod"] },
  }));
  const onActivity = vi.fn();
  await runAcp(
    acp,
    options(root, { runtimeMode: "full-access", onRequest, onActivity }),
  );
  expect(onRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "question",
      questions: [
        expect.objectContaining({
          id,
          allowCustomAnswer: false,
          options: [
            { label: "Same label", value: "dev" },
            { label: "Same label", value: "prod" },
          ],
        }),
      ],
    }),
    expect.anything(),
  );
  expect((await sent()).find((m) => !m.method)?.result).toEqual({
    outcome: { outcome: "selected", optionId: "prod" },
  });
  expect(onActivity).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: "complete",
      questionAnswers: [
        { question: "Which environment?", answer: "Same label" },
      ],
    }),
  );
});

it("never auto-approves a malformed native question, or accepts a free-text answer", async () => {
  for (const answer of ["not an option", "yes"]) {
    const { acp, root, sent } = await agent({
      turn: [
        {
          ask: {
            toolCall: { toolCallId: "interaction_q", title: "Pick one." },
            options: allowOrReject,
          },
        },
      ],
    });
    await runAcp(
      acp,
      options(root, {
        onRequest: async () =>
          answer === "yes"
            ? { kind: "approval", decision: "accept" }
            : { kind: "question", answers: { interaction_q: [answer] } },
      }),
    );
    expect((await sent()).find((m) => !m.method)?.result).toEqual({
      outcome: { outcome: "cancelled" },
    });
  }
  const malformed = await agent({
    turn: [
      {
        ask: {
          toolCall: { toolCallId: "interaction_bad", title: "Pick one." },
          options: [{ optionId: "", kind: "allow_once", name: "Broken" }],
        },
      },
    ],
  });
  const onRequest = vi.fn();
  await runAcp(malformed.acp, options(malformed.root, { onRequest }));
  expect(onRequest).not.toHaveBeenCalled();
  expect((await malformed.sent()).find((m) => !m.method)?.result).toEqual({
    outcome: { outcome: "cancelled" },
  });
});

it("dispatches native compact and plan commands first, keeping context inside the planning request", async () => {
  const { acp, root, sent } = await agent(
    { turn: [say("Done.")] },
    { provider: "opencode", compact: "/compact", plan: "/plan" },
  );
  const context = vi.fn(async () => "Workspace note.");
  await runAcp(acp, options(root, { job: { kind: "compact" }, context }));
  expect(context).not.toHaveBeenCalled();
  const onPlan = vi.fn();
  await runAcp(
    acp,
    options(root, {
      interactionMode: "plan",
      prompt: "Design the API.",
      context,
      onPlan,
    }),
  );
  expect(
    (await sent())
      .filter((m) => m.method === "session/prompt")
      .map((m) => m.params.prompt),
  ).toEqual([
    [{ type: "text", text: "/compact" }],
    [{ type: "text", text: "/plan Workspace note.\n\nDesign the API." }],
  ]);
  expect(onPlan).toHaveBeenLastCalledWith("Done.");
});

it("compacts Antigravity's conversation in place, and leaves out the size from before that it reports", async () => {
  const { acp, root, sent } = await agent(
    {
      turn: [say("Done.")],
      turnByPrefix: {
        "/compact": [
          {
            update: {
              sessionUpdate: "usage_update",
              used: 76_982,
              size: 1_048_576,
            },
          },
        ],
      },
    },
    { provider: "antigravity", compact: "/compact" },
  );
  const onContext = vi.fn();
  const onId = vi.fn(async () => {});
  const session = { key: root, onId };
  await runAcp(acp, options(root, { session }));
  await runAcp(
    acp,
    options(root, {
      job: { kind: "compact" },
      session: { ...session, id: "s1" },
      onContext,
    }),
  );
  expect(onContext).not.toHaveBeenCalled();
  expect(onId).toHaveBeenCalledExactlyOnceWith("s1");
  expect(
    (await sent())
      .filter((m) => m.method === "session/prompt")
      .map((m) => [m.params.sessionId, m.params.prompt[0].text]),
  ).toEqual([
    ["s1", expect.anything()],
    ["s1", "/compact"],
  ]);
});

it("refuses tools while Antigravity compacts", async () => {
  const { acp, root } = await agent(
    {
      turn: [
        {
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "bad",
            title: "Edit a file",
            kind: "edit",
          },
        },
      ],
    },
    { provider: "antigravity", compact: "/compact" },
  );
  await expect(
    runAcp(acp, options(root, { job: { kind: "compact" } })),
  ).rejects.toThrow("text-only");
});

it("updates the live planning checklist, and leaves execution checklists out of proposed plans", async () => {
  const { acp, root } = await agent(
    {
      turn: [
        {
          update: {
            sessionUpdate: "plan",
            entries: [{ content: "Read the API", status: "in_progress" }],
          },
        },
        {
          update: {
            sessionUpdate: "plan",
            entries: [{ content: "Read the API", status: "completed" }],
          },
        },
        say("The proposed plan."),
      ],
    },
    { plan: "/plan" },
  );
  const onPlan = vi.fn(),
    onActivity = vi.fn();
  await runAcp(
    acp,
    options(root, { interactionMode: "plan", onPlan, onActivity }),
  );
  expect(onPlan.mock.calls.map(([text]) => text)).toEqual([
    "- [ ] Read the API (working on it)",
    "- [x] Read the API",
    "The proposed plan.",
  ]);
  expect(onActivity.mock.calls.map(([a]) => a.status)).toEqual([
    "complete",
    "complete",
  ]);
  expect(onActivity.mock.calls.map(([a]) => a.checklist)).toEqual([
    [{ text: "Read the API", state: "now" }],
    [{ text: "Read the API", state: "done" }],
  ]);
  onPlan.mockClear();
  await runAcp(acp, options(root, { onPlan }));
  expect(onPlan).not.toHaveBeenCalled();
});

it("shows Antigravity's update_steps as the plan, once accepted and without skipped steps", async () => {
  const steps = (toolCallId: string, status: string, steps: unknown) => ({
    update: {
      sessionUpdate:
        status === "in_progress" ? "tool_call" : "tool_call_update",
      toolCallId,
      name: "update_steps",
      title: "Run update_steps",
      kind: "other",
      status,
      rawInput: { steps },
    },
  });
  const list = [
    { title: "Write a.txt", status: "done" },
    { title: "Write b.txt", status: "in_progress" },
    { title: "Write c.txt", status: "skipped" },
    { title: "Write d.txt", status: "failed" },
  ];
  const { acp, root } = await agent({
    turn: [
      steps("one", "in_progress", list),
      steps("one", "completed", list),
      steps("two", "in_progress", []),
      steps("two", "failed", []),
      say("Done."),
    ],
  });
  const rows: { id: string; detail?: string; status: string }[] = [];
  await runAcp(acp, options(root, { onActivity: (a) => rows.push(a) }));
  expect(rows.filter((row) => row.id === "antigravity-plan")).toEqual([
    expect.objectContaining({
      label: "Updated progress",
      status: "complete",
      detail:
        "- [x] Write a.txt\n- [ ] Write b.txt (working on it)\n- [ ] Write d.txt (failed)",
      checklist: [
        { text: "Write a.txt", state: "done" },
        { text: "Write b.txt", state: "now" },
        { text: "Write d.txt", state: "failed" },
      ],
    }),
  ]);
  // The refused list is a failed call, and leaves the plan alone.
  expect(rows.filter((row) => row.id !== "antigravity-plan")).toEqual([
    expect.objectContaining({ id: "two", status: "failed" }),
  ]);
});

it("keeps Antigravity's steps out of Plan mode's plan, clears them when none are left, and shows a list it can't read as a call", async () => {
  const steps = (toolCallId: string, rawInput: unknown) => ({
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      name: "update_steps",
      title: "Run update_steps",
      kind: "other",
      status: "completed",
      rawInput,
    },
  });
  const { acp, root } = await agent({
    turn: [
      steps("one", { steps: [{ title: "Look", status: "in_progress" }] }),
      steps("two", { steps: [{ title: "Look", status: "skipped" }] }),
      steps("three", { list: "not the shape" }),
      say("Done."),
    ],
  });
  const onPlan = vi.fn();
  const rows: { id: string; checklist?: unknown }[] = [];
  await runAcp(
    acp,
    options(root, {
      interactionMode: "plan",
      onPlan,
      onActivity: (a) => rows.push(a),
    }),
  );
  expect(onPlan.mock.calls.map(([text]) => text)).toEqual(["Done."]);
  expect(rows.map((row) => [row.id, row.checklist])).toEqual([
    ["antigravity-plan", [{ text: "Look", state: "now" }]],
    ["antigravity-plan", []],
    ["three", undefined],
  ]);
});

it("names the MCP tool Antigravity calls, in the trace and when it asks, going by the call's name alone", async () => {
  const call = (toolCallId: string, name: string, rawInput: object) => ({
    toolCallId,
    name,
    title: `Run ${name}`,
    kind: "other",
    status: "in_progress",
    rawInput,
  });
  const direct = call("direct", "mcp_docs_search_pages", { query: "x" });
  const { acp, root } = await agent({
    turn: [
      { update: { sessionUpdate: "tool_call", ...direct } },
      {
        ask: {
          toolCall: direct,
          options: [{ optionId: "a", name: "Allow", kind: "allow_once" }],
        },
      },
      {
        update: {
          sessionUpdate: "tool_call",
          ...call("proxied", "call_mcp_tool", {
            ServerName: "docs",
            ToolName: "search_pages",
            Arguments: {},
          }),
        },
      },
      {
        update: {
          sessionUpdate: "tool_call",
          ...call("own", "deploy", { ServerName: "web", ToolName: "x" }),
        },
      },
      say("Done."),
    ],
  });
  const rows = new Map<string, { label: string; mcp?: object }>();
  const titles: string[] = [];
  await runAcp(
    acp,
    options(root, {
      runtimeMode: "approval-required",
      onActivity: (a) => rows.set(a.id, a),
      onRequest: async (request) => {
        if (request.kind === "approval") titles.push(request.title);
        return { kind: "approval", decision: "accept" };
      },
    }),
  );
  const mcp = { server: "docs", tool: "search_pages" };
  expect(rows.get("direct")).toMatchObject({
    label: "docs: search_pages",
    mcp,
  });
  expect(rows.get("proxied")).toMatchObject({
    label: "docs: search_pages",
    mcp,
  });
  expect(rows.get("own")).toMatchObject({ label: "Run deploy" });
  expect(rows.get("own")?.mcp).toBeUndefined();
  expect(titles).toEqual(["docs: search_pages"]);
});

it("tracks the subagents Antigravity starts, without claiming they succeeded or can be stopped", async () => {
  const start = (toolCallId: string, name: string) => ({
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      name,
      title: `Run ${name}`,
      kind: "other",
      status: "in_progress",
      rawInput: {
        Prompt: "Reply with the word RED.",
        Role: "Red Reporter",
        TypeName: "self",
      },
    },
  });
  const { acp, root } = await agent({
    turn: [
      start("red", "invoke_subagent"),
      {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "red",
          name: "invoke_subagent",
          status: "completed",
        },
      },
      start("mcp", "mcp_relay_invoke_subagent"),
    ],
  });
  await runAcp(
    acp,
    options(root, { session: { key: "subagents", onId: async () => {} } }),
  );
  const source = antigravitySubagents.get("subagents")!;
  expect(source.list()).toEqual([
    expect.objectContaining({
      id: "red",
      description: "Red Reporter",
      status: "idle",
      canStop: false,
    }),
  ]);
  expect(source.detail("red")?.brief).toBe("Reply with the word RED.");
  await expect(source.stop("red")).rejects.toThrow();
  antigravitySubagents.drop("subagents");
});

it("keeps text-only helper jobs out of the project and refuses attempted tools", async () => {
  const plain = await agent({ turn: [say('{"title":"A title"}')] });
  await runAcp(
    plain.acp,
    options(plain.root, {
      job: { kind: "helper", instructions: "Write a title." },
      session: { key: "must-not-be-used", onId: async () => {} },
      relayTools: { url: "http://localhost:1", token: "fixture" },
    }),
  );
  const opened = (await plain.sent()).find((m) => m.method === "session/new")!;
  expect(opened.params.cwd).not.toBe(plain.root);
  expect(opened.params.mcpServers).toEqual([]);
  expect(
    (await plain.sent()).find((m) => m.method === "session/prompt")?.params
      .prompt[0].text,
  ).toContain("Write a title.\n\nHi");

  const tool = await agent({
    turn: [{ update: { sessionUpdate: "tool_call", ...editing } }, say("done")],
  });
  await expect(
    runAcp(
      tool.acp,
      options(tool.root, { job: { kind: "helper", instructions: "" } }),
    ),
  ).rejects.toThrow("text-only helper");
});

it("restarts the process when a session changes accounts, retaining the account for a subsequent turn", async () => {
  const { acp, root, sent } = await agent(
    { resume: true, sessions: ["s1"] },
    { accountKey: "personal" },
  );
  await runAcp(
    acp,
    options(root, { session: { key: "accounts", onId: async () => {} } }),
  );
  const first = await acquireAcpAgent(acp, "accounts", root);
  first.busy = false;
  await runAcp(
    { ...acp, accountKey: "work" },
    options(root, {
      session: { key: "accounts", id: "s1", onId: async () => {} },
    }),
  );
  expect(first.closed).toBe(true);
  const second = await acquireAcpAgent(
    { ...acp, accountKey: "work" },
    "accounts",
    root,
  );
  expect(second).not.toBe(first);
  second.busy = false;
  expect((await sent()).filter((m) => m.method === "initialize")).toHaveLength(
    2,
  );
  await runAcp(
    { ...acp, accountKey: "work", credentialsRevision: "new-login" },
    options(root, {
      session: { key: "accounts", id: "s1", onId: async () => {} },
    }),
  );
  expect(second.closed).toBe(true);
  expect((await sent()).filter((m) => m.method === "initialize")).toHaveLength(
    3,
  );
});

it("restarts a thread's process when it switches to Read only and back, so it runs with the read-only settings", async () => {
  const { acp, root, sent } = await agent(
    { resume: true, sessions: ["s1"], captureEnvKeys: ["READ_ONLY_RULES"] },
    {
      provider: "amp",
      readOnlyEnv: async () => ({ env: { READ_ONLY_RULES: "on" } }),
    },
  );
  const session = { key: "switch", id: "s1", onId: async () => {} };
  const turn = (readOnly: boolean) =>
    runAcp(
      acp,
      options(root, {
        runtimeMode: "approval-required",
        ...(readOnly ? { readOnly } : {}),
        session,
      }),
    );
  await turn(false);
  await turn(true);
  await turn(false);
  expect(
    (await sent()).flatMap((m: any) =>
      m.environment ? [m.environment.READ_ONLY_RULES] : [],
    ),
  ).toEqual([null, "on", null]);
});

it("restarts an idle thread's process when its Relay tools change, so its session hears an advisor", async () => {
  const { acp, root, sent } = await agent({ resume: true, sessions: ["s1"] });
  const session = { key: "tools", id: "s1", onId: async () => {} };
  const turn = (url: string) =>
    runAcp(
      acp,
      options(root, {
        session,
        relayTools: { url, token: "t", renders: "auto" },
      }),
    );
  await turn("http://127.0.0.1:1/mcp");
  await turn("http://127.0.0.1:1/mcp");
  await turn("http://127.0.0.1:1/mcp?advisor=on");
  const opened = (await sent()).filter(
    (m) => m.method === "session/resume" || m.method === "session/new",
  );
  expect(opened.map((m) => m.params.mcpServers[0].url)).toEqual([
    "http://127.0.0.1:1/mcp",
    "http://127.0.0.1:1/mcp?advisor=on",
  ]);
});

it("keeps the process a restart cut a turn off in when the thread's mode now differs, so the turn can be picked up", async () => {
  const { acp, root } = await agent({});
  const running = await acquireAcpAgent(acp, "adopt", root);
  running.busy = false;
  const picked = await acquireAcpAgent(acp, "adopt", root, {
    readOnly: true,
    keepMode: true,
  });
  expect(picked).toBe(running);
  picked.busy = false;
  const next = await acquireAcpAgent(acp, "adopt", root, { readOnly: true });
  expect(next).not.toBe(running);
});

it("resumes a thread switched to Read only and back in a process with that mode's git settings", async () => {
  const readOnlyEnv = readOnlyGitEnv(process.env);
  const { acp, root, sent } = await agent({
    resume: true,
    sessions: ["s1"],
    captureEnvKeys: Object.keys(readOnlyEnv),
  });
  const session = { key: "switch-git", id: "s1", onId: async () => {} };
  const turn = (readOnly: boolean) =>
    runAcp(
      acp,
      options(root, {
        runtimeMode: "approval-required",
        // What turnOptions adds for a Read only turn.
        ...(readOnly ? { readOnly, env: readOnlyEnv } : {}),
        session,
      }),
    );
  await turn(false);
  await turn(true);
  await turn(false);
  const said = await sent();
  const set = (environment: Record<string, string | null>) =>
    Object.values(environment).every((value) => value !== null);
  expect(
    said.flatMap((m: any) => (m.environment ? [set(m.environment)] : [])),
  ).toEqual([false, true, false]);
  expect(
    said
      .filter((m: any) => m.method === "session/resume")
      .map((m: any) => m.params.sessionId),
  ).toEqual(["s1", "s1", "s1"]);
});

it("does not merge a cleared ambient credential back into an account's process environment", async () => {
  vi.stubEnv("GEMINI_API_KEY", "inherited-fixture-key");
  const clean = { ...process.env } as Record<string, string>;
  delete clean.GEMINI_API_KEY;
  const { acp, root, sent } = await agent(
    { captureEnvKeys: ["GEMINI_API_KEY"] },
    { environment: clean },
  );
  await runAcp(acp, options(root));
  expect((await sent()).find((m: any) => m.environment)).toEqual({
    environment: { GEMINI_API_KEY: null },
  });
});

const options = (
  cwd: string,
  more: Partial<AgentOptions> = {},
): AgentOptions => ({
  job: { kind: "prompt" },
  cwd,
  prompt: "Hi",
  choice: { model: "", reasoningEffort: "", fast: false },
  runtimeMode: "full-access",
  interactionMode: "default",
  signal: new AbortController().signal,
  onText() {},
  ...more,
});

const say = (text: string) => ({
  update: {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  },
});

it("classifies prompt-time authentication refusals so the thread offers sign-in; leaves other failures alone", async () => {
  const auth = await agent(
    {
      promptError: {
        code: -32000,
        message: "Authentication required: provider authentication required",
      },
    },
    { provider: "opencode", name: "OpenCode" },
  );
  await expect(runAcp(auth.acp, options(auth.root))).rejects.toMatchObject({
    kind: "signedOut",
    provider: "opencode",
  });
  for (const code of [-32603, -32001]) {
    const failed = await agent({
      promptError: { code, message: "Provider request failed" },
    });
    await expect(
      runAcp(failed.acp, options(failed.root)),
    ).rejects.toMatchObject({ name: "AcpRequestError", code });
  }
});

it("starts a fresh process after a session refused for sign-in, so a login made since is used", async () => {
  let loggedIn = false;
  const launched: boolean[] = [];
  const { acp, root, sent } = await agent(
    {},
    { provider: "opencode", name: "OpenCode" },
  );
  const command = acp.command;
  acp.command = async (...args) => {
    const launch = await command(...args);
    launched.push(loggedIn);
    const scenario = { signIn: "cli", signedIn: loggedIn };
    return {
      ...launch,
      env: { ...launch.env, RELAY_ACP_SCENARIO: JSON.stringify(scenario) },
    };
  };
  const session = { key: "signed-out", onId: async () => {} };

  await expect(runAcp(acp, options(root, { session }))).rejects.toMatchObject({
    kind: "signedOut",
  });
  loggedIn = true;
  await expect(runAcp(acp, options(root, { session }))).resolves.toBe("");

  expect(launched).toEqual([false, true]);
  expect(
    (await sent()).filter((m) => m.method === "session/prompt"),
  ).toHaveLength(1);
});

const editing = {
  toolCallId: "t1",
  title: "Edit a.ts",
  kind: "edit",
  status: "pending",
  content: [{ type: "diff", path: "/p/a.ts", oldText: "a", newText: "b" }],
};

const allowOrReject = [
  { optionId: "yes", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Always", kind: "allow_always" },
  { optionId: "no", name: "Reject", kind: "reject_once" },
];

const modeOption = {
  id: "mode",
  name: "Mode",
  category: "mode",
  type: "select",
  currentValue: "default",
  options: [
    { value: "default", name: "Default" },
    { value: "yolo", name: "YOLO" },
  ],
};

it("splits text before a tool call into commentary and reports edits, cost and settings", async () => {
  const { acp, root, sent } = await agent({
    configOptions: [modeOption],
    turn: [
      say("Let me look."),
      { update: { sessionUpdate: "tool_call", ...editing } },
      {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
        },
      },
      {
        update: {
          sessionUpdate: "usage_update",
          used: 900,
          size: 1000,
          cost: { amount: 0.5, currency: "USD" },
        },
      },
      {
        update: {
          sessionUpdate: "usage_update",
          used: 950,
          size: 1000,
          cost: { amount: 0.75, currency: "USD" },
        },
      },
      say("Done."),
    ],
    // Antigravity 1.5's own report: outputTokens already holds the 19 thinking.
    usage: {
      inputTokens: 2181,
      cachedReadTokens: 12119,
      outputTokens: 23,
      thoughtTokens: 19,
      totalTokens: 14323,
    },
  });
  const commentary: [string, string | null][] = [];
  const activities: unknown[] = [];
  const edits: string[][] = [];
  const costs: number[] = [];
  const onUsage = vi.fn();
  const answer = await runAcp(
    acp,
    options(root, {
      onCommentary: (id, text) => commentary.push([id, text]),
      onActivity: (a) => activities.push(a),
      onEdit: (paths) => edits.push(paths),
      onCost: (usd) => costs.push(usd),
      onUsage,
    }),
  );

  expect(answer).toBe("Done.");
  expect(commentary).toEqual([["antigravity-0", "Let me look."]]);
  expect(activities.at(-1)).toMatchObject({ id: "t1", status: "complete" });
  expect(edits[0]).toEqual(["/p/a.ts"]);
  // A new session starts at $0, so its first report is all this turn's.
  expect(costs).toEqual([0.5, 0.25]);
  expect(onUsage.mock.calls[0][0].tokens).toMatchObject({
    input: 2181,
    cacheRead: 12119,
    output: 23,
  });
  const methods = (await sent()).map((m) => m.method);
  expect(methods).toContain("session/set_config_option");
  expect(methods).not.toContain("session/cancel");
  const prompt = (await sent()).find((m) => m.method === "session/prompt");
  expect(prompt?.params.prompt).toEqual([{ type: "text", text: "Hi" }]);
});

it.each([
  ["Gemini picked", "gemini-4-neon", "gemini-4-neon", true],
  ["Gemini on Default", "", "gemini-4-neon", true],
  ["another model", "claude-opus", "claude-opus", false],
])(
  "gives Antigravity's context an hour of prompt cache only for Gemini (%s)",
  async (_, picked, running, cached) => {
    const modelOption = {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: running,
      options: [
        { value: "gemini-4-neon", name: "Gemini 4 Neon" },
        { value: "claude-opus", name: "Claude Opus" },
      ],
    };
    const { acp, root } = await agent({
      configOptions: [modelOption],
      turn: [
        { update: { sessionUpdate: "usage_update", used: 900, size: 1000 } },
        say("Done."),
      ],
    });
    const onContext = vi.fn();
    const choice = { model: picked, reasoningEffort: "" as const, fast: false };
    await runAcp(acp, options(root, { choice, onContext }));
    const context = onContext.mock.calls.at(-1)?.[0];
    expect(context).toMatchObject({ usedTokens: 900, maxTokens: 1000 });
    expect(context.cache?.ttlMs).toBe(cached ? 60 * 60_000 : undefined);
  },
);

it.each([true, false])(
  "gives an agent that doesn't advertise HTTP MCP Relay's tools only when its profile takes them (%s)",
  async (takesHttpMcp) => {
    const { acp, root, sent } = await agent(
      { hidesHttpMcp: true, turn: [say("Done.")] },
      { takesHttpMcp },
    );
    const relayTools = { url: "http://127.0.0.1:1/mcp", token: "t" };
    await runAcp(acp, options(root, { relayTools }));
    const opened = (await sent()).find((m) => m.method === "session/new");
    expect(opened?.params.mcpServers).toHaveLength(takesHttpMcp ? 1 : 0);
  },
);

it("starts a new paragraph after Antigravity updated its steps", async () => {
  const steps = {
    sessionUpdate: "tool_call",
    toolCallId: "steps",
    title: "update_steps",
    name: "update_steps",
    status: "completed",
    rawInput: { steps: [{ title: "Look", status: "done" }] },
  };
  const { acp, root } = await agent({
    turn: [say("I'll plan this."), { update: steps }, say("Done")],
  });
  const answer = await runAcp(acp, options(root));
  expect(answer).toBe("I'll plan this.\n\nDone");
});

it("adds thinking to the output only when the agent's total leaves it out", () => {
  const usage = { inputTokens: 10, outputTokens: 2, thoughtTokens: 3 };
  expect(outputTokens({ ...usage, totalTokens: 15 })).toBe(5);
  expect(outputTokens({ ...usage, totalTokens: 12 })).toBe(2);
  expect(outputTokens(usage)).toBe(5);
  // Some count what came from the cache as input, some beside it.
  const cached = { ...usage, cachedReadTokens: 4 };
  for (const totalTokens of [15, 19])
    expect(outputTokens({ ...cached, totalTokens })).toBe(5);
  for (const totalTokens of [12, 16])
    expect(outputTokens({ ...cached, totalTokens })).toBe(2);
});

it("asks the user when the mode does, and answers with the option they picked", async () => {
  const { acp, root, sent } = await agent({
    turn: [
      {
        ask: {
          toolCall: { ...editing, rawInput: { command: "rm -rf build" } },
          options: allowOrReject,
        },
      },
      say("ok"),
    ],
  });
  const onRequest = vi.fn(async () => ({
    kind: "approval" as const,
    decision: "acceptForSession" as const,
  }));
  await runAcp(
    acp,
    options(root, { runtimeMode: "approval-required", onRequest }),
  );

  expect(onRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Edit a.ts",
      detail: "rm -rf build",
      decisions: ["accept", "acceptForSession", "decline"],
    }),
    expect.anything(),
  );
  const reply = (await sent()).find((m) => m.method === undefined && m.result);
  expect(reply?.result).toEqual({
    outcome: { outcome: "selected", optionId: "always" },
  });
});

it("shows Antigravity's CommandLine in approval details", async () => {
  const { acp, root } = await agent({
    turn: [
      {
        ask: {
          toolCall: {
            toolCallId: "cmd_1",
            name: "run_command",
            kind: "execute",
            title: "Run command",
            rawInput: { CommandLine: "npm test", WaitMsBeforeAsync: 5000 },
          },
          options: allowOrReject,
        },
      },
      say("ok"),
    ],
  });
  const onRequest = vi.fn(async () => ({
    kind: "approval" as const,
    decision: "accept" as const,
  }));
  await runAcp(
    acp,
    options(root, { runtimeMode: "approval-required", onRequest }),
  );
  expect(onRequest).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Run command", detail: "npm test" }),
    expect.anything(),
  );
});

it("fails an Antigravity turn on a mid-turn Google error even after tool calls ran", async () => {
  const { acp, root } = await agent(
    {
      turn: [
        {
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "read_1",
            kind: "read",
            title: "Read a.ts",
            status: "completed",
          },
        },
        say("⚠ RESOURCE_EXHAUSTED (code 429): Quota exceeded"),
      ],
    },
    { failure: (await import("../antigravity")).antigravityFailure },
  );
  const onText = vi.fn();
  await expect(runAcp(acp, options(root, { onText }))).rejects.toThrow(
    "Antigravity: RESOURCE_EXHAUSTED (code 429): Quota exceeded",
  );
  expect(onText).toHaveBeenLastCalledWith("");
});

it("offers no Always when the agent has several, rather than picking the broadest", async () => {
  // Gemini CLI's options for an MCP tool: the whole server first, then the tool.
  const { acp, root } = await agent({
    turn: [
      {
        ask: {
          toolCall: { ...editing, kind: "other", title: "query (db MCP)" },
          options: [
            {
              optionId: "proceed_always_server",
              name: 'Allow all "db" server tools for this session',
              kind: "allow_always",
            },
            {
              optionId: "proceed_always_tool",
              name: 'Allow tool "query" for this session',
              kind: "allow_always",
            },
            { optionId: "proceed_once", name: "Allow", kind: "allow_once" },
            { optionId: "cancel", name: "Reject", kind: "reject_once" },
          ],
        },
      },
      say("ok"),
    ],
  });
  const onRequest = vi.fn(async () => ({
    kind: "approval" as const,
    decision: "accept" as const,
  }));
  await runAcp(
    acp,
    options(root, { runtimeMode: "approval-required", onRequest }),
  );

  expect(onRequest).toHaveBeenCalledWith(
    expect.objectContaining({ decisions: ["accept", "decline"] }),
    expect.anything(),
  );
});

it("answers on the user's behalf where the mode decides, without asking", async () => {
  const onRequest = vi.fn();
  const answered = async (more: Partial<AgentOptions>) => {
    const { acp, root, sent } = await agent({
      turn: [{ ask: { toolCall: editing, options: allowOrReject } }, say("ok")],
    });
    await runAcp(acp, options(root, { onRequest, ...more }));
    return (await sent()).find((m) => m.method === undefined)?.result.outcome
      .optionId;
  };

  expect(await answered({ runtimeMode: "full-access" })).toBe("yes");
  expect(await answered({ runtimeMode: "auto-accept-edits" })).toBe("yes");
  expect(await answered({ runtimeMode: "full-access", readOnly: true })).toBe(
    "no",
  );
  expect(
    await answered({ runtimeMode: "approval-required", onRequest: undefined }),
  ).toBe("no");
  expect(onRequest).not.toHaveBeenCalled();
});

it("cancels the agent's turn when the user stops it", async () => {
  const { acp, root, sent } = await agent({
    turn: [say("Working…"), { waitCancel: true }],
  });
  const stop = new AbortController();
  const running = runAcp(
    acp,
    options(root, {
      signal: stop.signal,
      onText: (text) => text && stop.abort(),
    }),
  );

  await expect(running).rejects.toThrow("Cancelled by you.");
  expect((await sent()).some((m) => m.method === "session/cancel")).toBe(true);
});

it("calls a signed-out agent signed out without signing it in, or starting it when its files say so", async () => {
  const refusing = await agent({
    signIn: "oauth-personal",
    turn: [say("Hello")],
  });
  await expect(runAcp(refusing.acp, options(refusing.root))).rejects.toThrow(
    "Antigravity is signed out",
  );
  expect((await refusing.sent()).map((m) => m.method)).not.toContain(
    "authenticate",
  );

  const known = await agent(
    { turn: [say("Hello")] },
    { account: async () => ({ signedIn: false }) },
  );
  await expect(runAcp(known.acp, options(known.root))).rejects.toThrow(
    "Antigravity is signed out",
  );
  expect(await known.sent()).toEqual([]);
});

it("signs in from Relay the way the agent offers, and nothing else", async () => {
  const able = await agent(
    { signIn: "oauth-personal" },
    { authMethod: async () => "oauth-personal" },
  );
  await signInAcp(able.acp);
  expect(
    (await able.sent()).find((m) => m.method === "authenticate")?.params,
  ).toEqual({
    methodId: "oauth-personal",
  });

  const unable = await agent(
    { signIn: "oauth-personal" },
    { authMethod: async () => "vertex-ai" },
  );
  await expect(signInAcp(unable.acp)).rejects.toThrow(
    "can't sign in from Relay",
  );
});

it("leaves a sign-in that needs a key to the agent's CLI, however the agent marks it", async () => {
  // Qwen Code offers only an OpenAI key, typed under _meta; asking it to authenticate fails with "Internal error".
  const { acp, sent } = await agent({
    signIn: "openai",
    signInMetaType: "terminal",
  });
  await expect(signInAcp(acp)).rejects.toThrow("can't sign in from Relay");
  expect((await sent()).map((m) => m.method)).not.toContain("authenticate");
});

it("picks up the thread's session, and starts over with a note when it is gone", async () => {
  const { acp, root, sent } = await agent({
    resume: true,
    sessions: ["kept"],
    turn: [say("ok")],
  });
  const onId = vi.fn(async () => {});
  const onCommentary = vi.fn();
  await runAcp(
    acp,
    options(root, { session: { key: "a", id: "kept", onId }, onCommentary }),
  );
  expect(onId).not.toHaveBeenCalled();
  expect(onCommentary).not.toHaveBeenCalled();

  await runAcp(
    acp,
    options(root, { session: { key: "b", id: "gone", onId }, onCommentary }),
  );
  expect(onId).toHaveBeenCalledWith("s1");
  expect(onCommentary).toHaveBeenCalledWith(
    "antigravity-lost",
    expect.stringContaining("new one"),
  );
  const opened = (await sent()).filter(
    (m) => m.method?.startsWith("session/") && m.method !== "session/prompt",
  );
  expect(opened.map((m) => [m.method, m.params.sessionId])).toEqual([
    ["session/resume", "kept"],
    ["session/resume", "gone"],
    ["session/new", undefined],
  ]);
});

it("charges each turn what it added when the agent reports the session's total once a turn ends", async () => {
  const { acp, root } = await agent({
    resume: true,
    sessions: ["old"],
    spend: 0.25,
    spent: { old: 3 },
  });
  const costs: number[] = [];
  const turn = (key: string, id?: string) =>
    runAcp(
      acp,
      options(root, {
        session: { key, id, onId: async () => {} },
        onCost: (usd) => costs.push(usd),
      }),
    );

  await turn("new");
  await turn("new", "s1");
  expect(costs).toEqual([0.25, 0.25]);

  // A session picked up again ran up $3 Relay can't tell from this turn, so its first report only sets the mark.
  await turn("old", "old");
  await turn("old", "old");
  expect(costs).toEqual([0.25, 0.25, 0.25]);
});

it("fails a turn whose only answer is the agent reporting an error", async () => {
  const { acp, root } = await agent(
    { turn: [say("Error: You need to log in.")] },
    { failure: (answer) => /^Error: (.+)/s.exec(answer)?.[1] },
  );
  const onText = vi.fn();
  await expect(runAcp(acp, options(root, { onText }))).rejects.toThrow(
    "Antigravity: You need to log in.",
  );
  expect(onText).toHaveBeenLastCalledWith("");
});

/** OpenCode's question tool as a form: a choice and a multiselect, each with a field for the user's own words. */
const openCodeQuestions = {
  mode: "form",
  message: "Questions",
  toolCallId: "call_ask",
  requestedSchema: {
    type: "object",
    properties: {
      q0: {
        type: "string",
        title: "Database",
        description: "Which database?",
        oneOf: [
          { const: "Postgres", title: "Postgres" },
          { const: "SQLite", title: "SQLite", description: "One file" },
        ],
      },
      q0_custom: { type: "string", title: "Database (other)" },
      q1: {
        type: "array",
        title: "Pages",
        description: "Which pages?",
        items: { anyOf: [{ const: "Home", title: "Home" }] },
      },
      q1_custom: { type: "string", title: "Pages (other)" },
    },
    required: [],
  },
};

const askCall = (status: string) => ({
  update: {
    sessionUpdate: status === "pending" ? "tool_call" : "tool_call_update",
    toolCallId: "call_ask",
    title: "question",
    kind: "other",
    status,
  },
});

it("asks OpenCode's questions on the question card and fills its form with the answers", async () => {
  const { acp, root, sent } = await agent(
    {
      turn: [
        askCall("pending"),
        { elicit: openCodeQuestions },
        askCall("completed"),
        say("Thanks."),
      ],
    },
    { provider: "opencode", name: "OpenCode" },
  );
  const onRequest = vi.fn(async () => ({
    kind: "question" as const,
    answers: { q0: ["SQLite"], q1: ["Home", "Blog"] },
  }));
  const onActivity = vi.fn();
  await runAcp(acp, options(root, { onRequest, onActivity }));

  const messages = await sent();
  expect(
    messages.find((m) => m.method === "initialize")?.params.clientCapabilities
      .elicitation,
  ).toEqual({ form: {} });
  expect(onRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "question",
      questions: [
        {
          id: "q0",
          header: "Database",
          question: "Which database?",
          allowCustomAnswer: true,
          options: [
            { label: "Postgres", value: "Postgres" },
            { label: "SQLite", value: "SQLite", description: "One file" },
          ],
        },
        {
          id: "q1",
          header: "Pages",
          question: "Which pages?",
          multiple: true,
          allowCustomAnswer: true,
          options: [{ label: "Home", value: "Home" }],
        },
      ],
    }),
    expect.anything(),
  );
  expect(messages.find((m) => !m.method)?.result).toEqual({
    action: "accept",
    content: { q0: "SQLite", q1: ["Home"], q1_custom: "Blog" },
  });
  expect(onActivity).toHaveBeenLastCalledWith(
    expect.objectContaining({
      id: "call_ask",
      status: "complete",
      label: "request_user_input",
      questionAnswers: [
        { question: "Which database?", answer: "SQLite" },
        { question: "Which pages?", answer: "Home, Blog" },
      ],
    }),
  );
});

it("cancels a form the card can't show, or one asked with nobody to answer", async () => {
  const unshowable = {
    ...openCodeQuestions,
    requestedSchema: {
      properties: { files: { type: "array", items: { type: "string" } } },
    },
  };
  for (const [elicit, more] of [
    [unshowable, {}],
    [openCodeQuestions, { job: { kind: "helper" } }],
    [openCodeQuestions, { onRequest: undefined }],
  ] as const) {
    const { acp, root, sent } = await agent(
      { turn: [{ elicit }, say("Guessing.")] },
      { provider: "opencode", name: "OpenCode" },
    );
    const onRequest = vi.fn();
    await runAcp(
      acp,
      options(root, { onRequest, ...(more as Partial<AgentOptions>) }),
    );
    expect(onRequest).not.toHaveBeenCalled();
    expect((await sent()).find((m) => !m.method)?.result).toEqual({
      action: "cancel",
    });
  }
});
